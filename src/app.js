const express = require('express');
const axios = require('axios');
const cors = require('cors');

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
const MAX_CACHED_PAGE_SIZES = 3;
const CACHE_EXPIRATION_TIME = 24 * 60 * 60 * 1000; // 缓存过期时间，单位：毫秒
var memosStats = {};


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

function statsDataHandle(memos, memoCount, tagCountMap, photoCount) {
    memoCount += memos.length;
    memos.forEach(memo => {
        memo.tags.forEach(tag => {
            tagCountMap.set(tag, (tagCountMap.get(tag) || 0) + 1);

            // 统计随手拍照片数量
            if(tag == photoTag) {
                memo.resources.forEach(item => {
                    if(item.type.startsWith('image')) {
                        photoCount++;
                    }
                });
                memo.nodes.forEach(node => {
                    if (node.type === 'PARAGRAPH') {
                        node.paragraphNode.children.forEach(child => {
                            if (child.type === 'IMAGE') {
                                photoCount++;
                            }
                        });
                    }
                });
            }
        });
    });
    return { memoCount, tagCountMap, photoCount };
}

// 从 URL 获取数据并更新缓存
async function updateCache(url) {
    try {
        let memoCount = 0;
        let tagCountMap = new Map();
        let photoCount = 0;
        
        const response = await axios.get(url, { timeout: 5000 });
        const data = response.data;
        const urlObj = new URL(url);
        const pageSize = urlObj.searchParams.get('pageSize');
        const currentPageToken = urlObj.searchParams.get('pageToken') || 'init';
        
        ({ memoCount, tagCountMap, photoCount } = statsDataHandle(data.memos, memoCount, tagCountMap, photoCount));

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
            const nextResponse = await axios.get(nextUrl, { timeout: 5000 });
            const nextData = nextResponse.data;
            
            if (!cache[pageSize]) {
                cache[pageSize] = {};
            }
            cache[pageSize][nextPageToken] = { ...nextData };   // 存入缓存

            ({ memoCount, tagCountMap, photoCount } = statsDataHandle(nextData.memos, memoCount, tagCountMap, photoCount));
            
            nextPageToken = nextData.nextPageToken; // 更新 nextPageToken
        }

        const tagObj = Object.fromEntries(tagCountMap);
        const sortedTags = Object.entries(tagObj).sort((a, b) => b[1] - a[1]);
        const sortedTagObj = Object.fromEntries(sortedTags);

        memosStats = {
            total: memoCount,
            tags: sortedTagObj,
            tagTotal: tagCountMap.size,
            photoToal: photoCount,
            timestamp: Date.now()
        };

        return data;
    } catch (error) {
        console.error('获取数据时出错:', error.message);
        return null;
    }
}


function delay(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
}

// 刷新全部缓存
async function refreshCache() {
    for (const pageSize in cache) {
        console.log(pageSize)
        delete cache[pageSize];
        const updateUrl = `${baseUrl}?pageSize=${pageSize}`;
        await updateCache(updateUrl);
        console.log("刷新成功")
        await delay(2000);
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
        res.json(memosStats.tags);
    }
    else if (req.params.type == "total") {
        res.json({"total": memosStats.total,
                "tagTotal": memosStats.tagTotal,
                "photoTotal": memosStats.photoTotal
            })
    }
    else {
        res.json(memosStats);
    }
});

async function preloadPage() {  // 预加载
    const preloadPageSizes = [10, 15, 20];
    for (const pageSize of preloadPageSizes) {
        await updateCache(`${baseUrl}?pageSize=${pageSize}`);
        await delay(2000); 
    }
}

const port = 3000;
app.listen(port, () => {
    console.log(`服务器运行在端口 ${port}`);
    preloadPage();
    cleanExpiredCache();
});
