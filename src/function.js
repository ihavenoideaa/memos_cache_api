const photoTag = '随手拍';

function statsDataHandle(memos, tmpStats, isHandleStats, isFirst = false) {
    if(isHandleStats) {
        return {};   // 已经处理过了
    }
    if (isFirst) {  // 初始化
        tmpStats = {
            memoCount: 0,
            tagCountMap: new Map(),
            photoCount: 0,
            timeStats: {"timeList":[]},
            incompleteTasksCount: 0,
            taskMemosCount: 0,
            codeMemosCount: 0,
            linkMemosCount: 0
        };
    }

    tmpStats.memoCount += memos.length;
    memos.forEach(memo => {
        memo.tags.forEach(tag => {
            tmpStats.tagCountMap.set(tag, (tmpStats.tagCountMap.get(tag) || 0) + 1);

            // 统计随手拍照片数量
            if(tag == photoTag) {
                memo.resources.forEach(item => {
                    if(item.type.startsWith('image')) {
                        tmpStats.photoCount++;
                    }
                });
                memo.nodes.forEach(node => {
                    if (node.type === 'PARAGRAPH') {
                        node.paragraphNode.children.forEach(child => {
                            if (child.type === 'IMAGE') {
                                tmpStats.photoCount++;
                            }
                        });
                    }
                });
            }
        });

        // 统计时间数据
        tmpStats.timeStats["timeList"].push(memo.createTime)
        // 统计类型数据
        tmpStats.incompleteTasksCount += memo.property.hasIncompleteTasks === true ? 1 : 0;
        tmpStats.taskMemosCount += memo.property.hasTaskList === true ? 1 : 0;
        tmpStats.codeMemosCount += memo.property.hasCode === true ? 1 : 0;
        tmpStats.linkMemosCount += memo.property.hasLink === true ? 1 : 0;
    });

    const sortedEntries = [...tmpStats.tagCountMap.entries()].sort((a, b) => b[1] - a[1]);
    tmpStats.tagCountMap = new Map(sortedEntries);

    return tmpStats;
}

function delay(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
}

// 导出函数
module.exports = {
    statsDataHandle,
    delay
};