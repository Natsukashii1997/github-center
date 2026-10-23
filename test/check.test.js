// 每日自检的算法：记录比例、应有记录次数、漏失概率、降低候选门槛与完整性下限（#10）。
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { selfCheck, lowerThreshold, completenessFloor, MAX_MISS } from '../src/ranking/check.js';

const close = (a, b) => assert.ok(Math.abs(a - b) <= 1e-9 * Math.max(1, Math.abs(b)), `${a} ≈ ${b}`);

test('2026-10-22 真实数字：记录比例约 1.1%，第 20 名 +823 应有约 9 次记录，门槛 1 时漏失概率约万分之一', () => {
  const entries = [{ gain: 39696 - 823, records: 434 }, { gain: 823, records: 5 }];
  const c = selfCheck({ entries, threshold: 1 });
  close(c.recordRatio, 439 / 39696);
  close(c.expectedRecords, 823 * 439 / 39696);
  close(c.missProbability, Math.exp(-c.expectedRecords)); // P(X ≤ 0)
  assert.ok(c.missProbability > 1e-4 && c.missProbability < 2e-4);
  assert.equal(c.passed, false);
  // 门槛 2（前 300 名的事件次数）时还要加上 P(X = 1)，约千分之一。
  close(selfCheck({ entries, threshold: 2 }).missProbability, Math.exp(-c.expectedRecords) * (1 + c.expectedRecords));
});

test('应有记录次数多时，门槛远低于它就通过；λ 很大也不下溢', () => {
  const c = selfCheck({ entries: [{ gain: 1000, records: 500 }, { gain: 120, records: 60 }], threshold: 20 });
  assert.equal(c.expectedRecords, 60); // 560 / 1120 = 50%，× 第 20 名的 120
  assert.equal(c.passed, true);
  assert.ok(c.missProbability < MAX_MISS && c.missProbability > 0);
  const big = selfCheck({ entries: [{ gain: 100000, records: 2000 }], threshold: 1500 });
  assert.equal(big.passed, true);
  assert.ok(Number.isFinite(big.missProbability));
});

test('降低门槛：取漏失概率仍小于百万分之一的最高门槛', () => {
  const t = lowerThreshold({ expectedRecords: 60, threshold: 750 });
  const at = (x) => selfCheck({ entries: [{ gain: 120, records: 60 }], threshold: x }).missProbability;
  assert.ok(at(t) < MAX_MISS);
  assert.ok(at(t + 1) >= MAX_MISS);
  assert.ok(t > 20 && t < 40);
});

test('怎么降都不够时降到 1；降低后的门槛总比原来低', () => {
  assert.equal(lowerThreshold({ expectedRecords: 9.1, threshold: 2 }), 1);
  assert.equal(lowerThreshold({ expectedRecords: 9.1, threshold: 300 }), 1);
  assert.equal(lowerThreshold({ expectedRecords: 60, threshold: 2 }), 1);
});

test('没有上榜项目时不算通过', () => {
  assert.equal(selfCheck({ entries: [], threshold: 1 }).passed, false);
});

// 逐个涨星数试：漏失概率第一次小于百万分之一的那个。
function bruteFloor(recordRatio, threshold) {
  for (let g = 1; ; g++) if (selfCheck({ entries: [{ gain: g, records: recordRatio * g }], threshold }).missProbability < MAX_MISS) return g;
}

test('完整性下限：涨星至少这么多时漏失概率才小于百万分之一，少 1 个就不够', () => {
  for (const [ratio, threshold] of [[439 / 39696, 1], [4564 / 309070, 2], [15612 / 940370, 5], [0.5, 1], [0.5, 436]]) {
    const floor = completenessFloor({ recordRatio: ratio, threshold });
    assert.equal(floor, bruteFloor(ratio, threshold), `比例 ${ratio}、门槛 ${threshold}`);
  }
  // 2026-10-22 近 1 天：比例约 1.1%、门槛 1，下限 +1,250，第 20 名 +823 在下限以下。
  assert.equal(completenessFloor({ recordRatio: 439 / 39696, threshold: 1 }), 1250);
});

test('完整性下限随候选门槛升高；记录比例为 0 时估计不了，没有下限', () => {
  const at = (threshold) => completenessFloor({ recordRatio: 0.0148, threshold });
  assert.ok(at(1) < at(2) && at(2) < at(5));
  assert.equal(completenessFloor({ recordRatio: 0, threshold: 1 }), null);
});
