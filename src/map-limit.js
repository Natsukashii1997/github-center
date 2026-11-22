// 并发工具：最多 n 个同时跑 fn(item, i)，结果按 items 原顺序返回（#114 从 ranking/rank-day.js 搬来，出榜、补资料、精选榜、分享页、重试都用）。
export async function mapLimit(items, n, fn) {
  const out = new Array(items.length);
  let next = 0;
  await Promise.all(Array.from({ length: Math.min(n, items.length) }, async () => {
    while (next < items.length) {
      const i = next++;
      out[i] = await fn(items[i], i);
    }
  }));
  return out;
}
