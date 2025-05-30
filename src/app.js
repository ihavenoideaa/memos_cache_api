const express = require('express');
const axios = require('axios');
const cors = require('cors');

const { 
    statsDataHandle,
    delay
} = require('./function');


const app = express();
const baseUrl = 'https://127.0.0.1:<memos_server_port>/api/v1/memos'; 


const allowedOrigins = [
    'http://*.example_domain.com',
    'https://*.example_domain.com'
];

const corsOptions = {
    origin: function (origin, callback) {
        if (!origin) {
            // 服务器端发起的请求没有 origin 字段，允许通过
            return callback(null, true);
        }
        const isAllowed = allowedOrigins.some(pattern => {
        if (pattern.includes('*')) {
            const regexPattern = pattern.replace('*', '[^.]+');
            const regex = new RegExp(regexPattern);
            return regex.test(origin);
        }
        return pattern === origin;
        });

        if (isAllowed) {
        callback(null, true);
        } else {
        callback(new Error('Not allowed by CORS'));
        callback(null, false);
        }
    },
    methods: 'GET, POST, PUT, DELETE, PATCH',
    allowedHeaders: '*'
};

app.use(cors(corsOptions));

// 初始化缓存
const cache = {};
const cachedPageSizes = [];
const userCache = {};
const userNameList = [];
const MAX_CACHED_PAGE_SIZES = 3;
const MAX_USER_CACHE = 5;
const CACHE_EXPIRATION_TIME = 24 * 60 * 60 * 1000; // 缓存过期时间，单位：毫秒
var tagCache = {};
var statsCache = {};
let isHandleStats = false;


// 更新过期缓存
function cleanExpiredCache() {
    setInterval(() => {
        Object.keys(cache).forEach(pageSize => {
            if (Date.now() - cache[pageSize]["timestamp"] > CACHE_EXPIRATION_TIME) {
                delete cache[pageSize];
                const updateUrl = `${baseUrl}?pageSize=${pageSize}`;
                updateCache(updateUrl);
                console.log(`更新过期缓存: ${pageSize}`);
            }

            if (Object.keys(cache[pageSize]).length === 0) {
                delete cache[pageSize];
                const index = cachedPageSizes.indexOf(pageSize);
                if (index > -1) {
                    cachedPageSizes.splice(index, 1);
                }
                console.log(`删除空的 pageSize 缓存: ${pageSize}`);
            }
        });
    }, CACHE_EXPIRATION_TIME / 2);
}


// 从 URL 获取数据并更新缓存
async function updateCache(url) {
    try {
        const response = await axios.get(url, { timeout: 5000 });
        const data = response.data;
        const urlObj = new URL(url);
        const pageSize = urlObj.searchParams.get('pageSize');
        const currentPageToken = urlObj.searchParams.get('pageToken') || 'init';
        
        let tmpStats = {};
        let tmpTags = {}
        statsDataHandle(data.memos, tmpStats, tmpTags, isHandleStats, 1);
        
        // 如果 pageSize 不在已缓存列表中
        if (!cachedPageSizes.includes(pageSize)) {
            // 若超过最大缓存数量，删除最旧的 pageSize 对应的缓存
            if (cachedPageSizes.length >= MAX_CACHED_PAGE_SIZES) {
                const oldestPageSize = cachedPageSizes.shift();
                console.log("超过最大缓存数量，删除旧缓存的 cache[pageSize: %s]", oldestPageSize);
                delete cache[oldestPageSize];
            }
            cachedPageSizes.push(pageSize);
        }
        
        // 将 pageSize 作为键，内部再以 pageToken 为键存储数据
        if (!cache[pageSize]) {
            cache[pageSize] = {};
        }
        cache[pageSize][currentPageToken] = { ...data };
        cache[pageSize]["timestamp"] = Date.now();
        
        let nextUrl = url;
        let nextPageToken = data.nextPageToken;
        while (nextPageToken) {
            const nextUrlObj = new URL(nextUrl);
            nextUrlObj.searchParams.set('pageToken', nextPageToken);
            nextUrl = nextUrlObj.toString();
            const nextResponse = await axios.get(nextUrl, { timeout: 8000 });
            const nextData = nextResponse.data;
            
            if (!cache[pageSize]) {
                cache[pageSize] = {};
            }
            cache[pageSize][nextPageToken] = { ...nextData };   // 存入缓存

            nextPageToken = nextData.nextPageToken; // 更新 nextPageToken

            statsDataHandle(nextData.memos, tmpStats, tmpTags, isHandleStats, nextPageToken ? 2 : 3);
        }


        if(!isHandleStats) {
            isHandleStats = true;   // 处理完成，不重复处理
            statsCache = tmpStats;
            tagCache = tmpTags;
        }

        return data;
    } catch (error) {
        console.error(`获取Memos:${url}数据时出错:`, error.message);
        return null;
    }
}

// 刷新全部缓存
async function refreshCache() {
    isHandleStats = false;
    for (const pageSize in cache) {
        console.log(pageSize)
        delete cache[pageSize];
        const updateUrl = `${baseUrl}?pageSize=${pageSize}`;
        await updateCache(updateUrl);
        console.log("刷新成功")
        await delay(2000);
    }

    for (const user in userCache) {
        delete userCache[user];
        await updateUserCache();
        await delay(500);
    }
}



async function updateUserCache(username) {
    try {
        const targetUrl = `${memosUrl}/api/v1/${username}`;
        const response = await axios.get(targetUrl, { timeout: 5000 });
        const data = response.data;
        if (!userNameList.includes(username)) {
            if (userNameList.length >= MAX_USER_CACHE) {
                const oldestName = userNameList.shift();
                console.log("超过最大缓存数量，删除旧缓存的 userCache[username: %s]", oldestName);
                delete userCache[oldestName];
            }
            userNameList.push(username);
        }

        userCache[username] = { ...data };
        return data;
    } catch (error) {
        console.error(`获取User:${username}数据时出错:`, error.message);
        return null;
    }
}

// 获取缓存数据的 API 端点
app.get('/data', async (req, res) => {
    const { pageSize = 10, pageToken = 'init' } = req.query;
    
    const pageSizeCache = cache[pageSize];
    const cachedData = pageSizeCache && (pageSizeCache[pageToken] || (pageToken == "" && pageSizeCache["init"]));
    if (cachedData) {
        res.json(cachedData);
    } else {
        const targetUrl = `${baseUrl}?pageSize=${pageSize}${pageToken === "init" ? '' : `&pageToken=${pageToken}`}`;
        const newData = await updateCache(targetUrl);

        console.log(`pageSize:${pageSize} 缓存存储成功`);

        if (newData) {
            res.json(newData);
        } else {
            res.status(503).send('缓存数据不可用，请稍后再试');
        }
    }
});

app.get('/refresh', async (req, res) => {
    refreshCache();
    console.log("/refresh 刷新缓存")
    res.json({message: '刷新成功'});
});

app.post('/updates', async (req, res) => {
    const { update } = req.query;
    if (update === 'true') {
        refreshCache();
        console.log("/updates 刷新缓存")
        res.json({message: '更新成功'});
    } else {
        res.json({ message: '未提供有效的更新参数' });
    }
});

app.get('/stats/:type', async (req, res) => {
    if(req.params.type == "tags") {
        res.json(statsCache.tags);
    }
    else if (req.params.type == "total") {
        res.json({"total": statsCache.total,
                "tagTotal": statsCache.tagTotal,
                "photoTotal": statsCache.photoTotal
            })
    }
    else if (req.params.type == "timeData") {
        res.json(statsCache.timeStats)
    }
    else {
        res.json(statsCache);
    }
});

// 根据标签获取
app.get('/tag', async (req, res) => {
    const { tagName } = req.query;
    if (tagName && tagName.trim()!== '') {
        const tagNameCache = tagCache[tagName];
        if(tagNameCache) {
            res.json(tagNameCache);
        }
        else {
            res.status(404).json({ message: '未找到该标签' });  
        }
    } else {
        res.status(400).json({ message: '参数错误' });
    }
});

// 根据标签获取
app.get('/users', async (req, res) => {
    const { username } = req.query;
    if (username != undefined && username.trim()!== '') {
        const userNameCache = userCache[username];
        if(userNameCache) {
            res.json(userCache);
        }
        else {
            const newData = await updateUserCache(username);
            res.json(newData);
        }
    } else {
        res.status(400).json({ message: '参数错误' });
    }
});

async function preload() {  // 预加载
    const preloadPageSizes = [10, 15, 20];
    for (const pageSize of preloadPageSizes) {
        await updateCache(`${baseUrl}?pageSize=${pageSize}`);
        await delay(2000); 
    }

    const preloadUserName = ["users/1"];
    for (const user of preloadUserName) {
        await updateUserCache(user);
        await delay(500);
    }
}

const port = 3000;
app.listen(port, () => {
    console.log(`服务器运行在端口 ${port}`);
    preload();
    cleanExpiredCache();
});
