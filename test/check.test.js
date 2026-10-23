// 每日自检的算法：记录比例、应有记录次数、漏失概率与降低候选门槛。
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { selfCheck, lowerThreshold, MAX_MISS } from '../src/ranking/check.js';

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
