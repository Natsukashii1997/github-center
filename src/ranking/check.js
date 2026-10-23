// 每日自检（#3）：估计榜单有没有漏掉项目。
// 事件数据只记下一部分 Star，记录比例按已核数的上榜项目总体估计：事件记录次数合计 ÷ 官方新增合计。
// 一个涨星数和第 20 名一样多的项目，应有的记录次数约为 比例 × 第 20 名涨星数；
// 它的记录次数低于候选门槛（因而没进候选）的概率就是漏失概率，按泊松分布算（每个 Star 独立被记下是二项分布，左尾比泊松更薄，所以这样估偏保守）。
export const MAX_MISS = 1e-6;

// 泊松分布 P(X ≤ k)，在对数里累加，λ 很大时也不下溢。
function poissonAtMost(lambda, k) {
  if (k < 0) return 0;
  if (lambda <= 0) return 1;
  let log = -lambda;
  let sum = log;
  for (let i = 1; i <= k; i++) {
    log += Math.log(lambda) - Math.log(i);
    sum = Math.max(sum, log) + Math.log1p(Math.exp(-Math.abs(sum - log)));
  }
  return Math.min(1, Math.exp(sum));
}

// entries：上榜项目（含 gain 官方新增、records 事件记录次数）；threshold：记录次数达到它的项目都已进候选。
export function selfCheck({ entries, threshold }) {
  const gains = entries.reduce((s, e) => s + e.gain, 0);
  if (!entries.length || !gains) return { passed: false, missProbability: 1, threshold, recordRatio: 0, expectedRecords: 0 };
  const recordRatio = entries.reduce((s, e) => s + e.records, 0) / gains;
  const expectedRecords = recordRatio * entries.at(-1).gain;
  const missProbability = poissonAtMost(expectedRecords, threshold - 1);
  return { passed: missProbability < MAX_MISS, missProbability, threshold, recordRatio, expectedRecords };
}

// 自检不过时该把候选门槛降到多少：漏失概率仍小于百万分之一的最高门槛；怎么降都不够时降到 1（当天有记录的项目全部核数）。
export function lowerThreshold({ expectedRecords, threshold }) {
  let t = 1;
  while (t + 1 < threshold && poissonAtMost(expectedRecords, t) < MAX_MISS) t++;
  return t;
}
