// 当轮重试（#52）：榜单面向所有人，补资料、归类失败不留到第二天。第一遍跑完后只把失败的再跑，最多 3 轮，
// 轮间等 1、3、5 分钟（Codex 偶发断线、限流多半过一会儿就好），重试时 2 个同时跑，免得再被限流。
import { mapLimit } from './ranking/rank-day.js';

export const RETRY_WAITS_MS = [60_000, 180_000, 300_000];
const RETRY_CONCURRENCY = 2;
const pause = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

// items 逐个交给 attempt（不抛错，失败写在结果里），isFailed(结果) 为真的再试。返回和 items 一一对应的最终结果和重试了几轮。
export async function withRetries(items, { concurrency, attempt, isFailed, sleep = pause, waits = RETRY_WAITS_MS }) {
  const results = await mapLimit(items, concurrency, attempt);
  let rounds = 0;
  for (const ms of waits) {
    const todo = results.flatMap((r, i) => (isFailed(r) ? [i] : []));
    if (!todo.length) break;
    await sleep(ms);
    rounds++;
    const again = await mapLimit(todo, RETRY_CONCURRENCY, (i) => attempt(items[i]));
    todo.forEach((i, k) => { results[i] = again[k]; });
  }
  return { results, rounds };
}
