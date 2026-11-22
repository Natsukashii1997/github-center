// 涨星榜专用的落盘（#114 从 src/store.js 拆出，路径和格式不变）：
// 每个窗口这一期的全部已核数候选（#10），和快照一样只写一次；每天的全站 Star 事件合计（只用来挑候选和自检，近 7/30 天复用）。
import { join } from 'node:path';
import { readJson, writeAtomic, writeOnce } from '../store.js';

const candidatesPath = (window, day) => join('candidates', window, `${day}.json`);
// 涨星榜每个窗口这一期全部已核数的候选（#10 分类榜在里面按分类重新取前 20），和快照一样只写一次。
export const publishCandidates = (dataDir, window, file) => writeOnce(dataDir, candidatesPath(window, file.statDay), JSON.stringify(file));
export const readCandidates = (dataDir, window, day) => readJson(join(dataDir, candidatesPath(window, day)));

export const readEvents = (dataDir, day) => readJson(join(dataDir, 'events', `${day}.json`));
export const saveEvents = (dataDir, day, events) => writeAtomic(join(dataDir, 'events', `${day}.json`), JSON.stringify(events) + '\n');
