// 涨星榜出榜：全站事件数据和官方热门榜找候选，GitHub 官方星数历史核数，每日自检，存成不可变快照（ADR 0001）。
export { rankDay } from './rank-day.js';
export { readLatestSnapshot, readStatus, recordStatus } from './store.js';
export { lastEndedDay, WINDOWS } from './stat-day.js';
