const photoTag = '随手拍';

function statsDataHandle(memos, tmpStats, tmpTags, isHandleStats, status = 2) {
    if(isHandleStats) {
        return {};   // 已经处理过了
    }
    if (status == 1) {  // 初始化
        tmpStats["total"] = 0;
        tmpStats["tags"] = new Map();
        tmpStats["tagTotal"] = 0;
        tmpStats["linkTotal"] = 0;
        tmpStats["photoTotal"] = 0;
        tmpStats["timeStats"] = {"timeList":[]};
        tmpStats["codeTotal"] = 0;
        tmpStats["taskTotal"] = 0;
        tmpStats["incompleteTaskTotal"] = 0;

        tmpTags["isCode"] = {"memos":[]};
        tmpTags["isLink"] = {"memos":[]};
        tmpTags["isTask"] = {"memos":[]};
        tmpTags["isIncompleteTask"] = {"memos":[]};        
    }

    tmpStats.total += memos.length;
    memos.forEach(memo => {
        memo.tags.forEach(tag => {
            tmpStats.tags.set(tag, (tmpStats.tags.get(tag) || 0) + 1);
            // 统计标签数据
            if(!tmpTags[tag]) {
                tmpTags[tag] = {"memos":[]};
            }
            tmpTags[tag].memos.push(memo);

            // 统计随手拍照片数量
            if(tag == photoTag) {
                memo.resources.forEach(item => {
                    if(item.type.startsWith('image')) {
                        tmpStats.photoTotal++;
                    }
                });
                memo.nodes.forEach(node => {
                    if (node.type === 'PARAGRAPH') {
                        node.paragraphNode.children.forEach(child => {
                            if (child.type === 'IMAGE') {
                                tmpStats.photoTotal++;
                            }
                        });
                    }
                });
            }
        });

        // 统计时间数据
        tmpStats.timeStats.timeList.unshift(memo.createTime)
        // 统计类型数据
        if(memo.property.hasCode === true) {
            tmpStats.codeTotal += 1;
            tmpTags.isCode.memos.push(memo);
        }
        if(memo.property.hasLink === true) {
            tmpStats.linkTotal += 1;
            tmpTags.isLink.memos.push(memo);
        }
        if(memo.property.hasTaskList === true) {
            tmpStats.taskTotal += 1;
            tmpTags.isTask.memos.push(memo);
        }
        if(memo.property.hasIncompleteTasks === true) {
            tmpStats.incompleteTaskTotal += 1;
            tmpTags.isIncompleteTask.memos.push(memo);
        }
    });

    const sortedEntries = [...tmpStats.tags.entries()].sort((a, b) => b[1] - a[1]);
    tmpStats.tags = new Map(sortedEntries);
    if(status == 3) {   // 最后一次处理
        tmpStats.tagTotal = tmpStats.tags.size;
        delete tmpStats.tags;
        tmpStats.tags = Object.fromEntries(sortedEntries);

    }
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