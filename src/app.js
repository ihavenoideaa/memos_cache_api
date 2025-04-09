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
const memosStats = {};

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
        
        let memosCount = 0;
        memosCount += data.memos.length;

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
        
        // 使用循环替代递归
        let nextUrl = url;
        let nextPageToken = data.nextPageToken;
        while (nextPageToken) {
            const nextUrlObj = new URL(nextUrl);
            nextUrlObj.searchParams.set('pageToken', nextPageToken);
            nextUrl = nextUrlObj.toString();
            const nextResponse = await axios.get(nextUrl, { timeout: 5000 });
            const nextData = nextResponse.data;
            nextPageToken = nextData.nextPageToken;
            const nextPageSize = nextUrlObj.searchParams.get('pageSize');
            const nextCurrentPageToken = nextUrlObj.searchParams.get('pageToken');

            memosCount += nextData.memos.length;
            
            if (!cache[nextPageSize]) {
                cache[nextPageSize] = {};
            }
            cache[nextPageSize][nextCurrentPageToken] = { ...nextData };
        }

        memosStats["total"] = memosCount;

        return data;
    } catch (error) {
        console.error('获取数据时出错:', error);
        return null;
    }
}

// 刷新全部缓存
async function refreshCache() {
    Object.keys(cache).forEach(pageSize => {
        delete cache[pageSize];
        const updateUrl = `${baseUrl}?pageSize=${pageSize}`;
        updateCache(updateUrl);
    });
}

// 获取缓存数据的 API 端点
app.get('/data', async (req, res) => {
    const { pageSize = 10, pageToken = 'init' } = req.query;
    
    const targetUrl = `${baseUrl}?pageSize=${pageSize}${pageToken === "init" ? '' : `&pageToken=${pageToken}`}`;

    const pageSizeCache = cache[pageSize];
    const cachedData = pageSizeCache && (pageSizeCache[pageToken] || (pageToken == "" && pageSizeCache["init"]));
    if (cachedData) {
        res.json(cachedData);
    } else {
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
    const { update } = req.body;
    if (update === 'true') {
        refreshCache();
        console.log("/updates 刷新缓存")
        res.json({message: '更新成功'});
    } else {
        res.json({ message: '未提供有效的更新参数' });
    }
});

app.get('/total', async (req, res) => {
    res.json(memosStats);
});

const port = 3000;
app.listen(port, () => {
    console.log(`服务器运行在端口 ${port}`);

    updateCache(`${baseUrl}?pageSize=20`); 
    cleanExpiredCache();
});
