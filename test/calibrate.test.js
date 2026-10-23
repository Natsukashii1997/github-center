// #4：与严格方案逐日校准。严格实验的结果用临时目录里的假文件代替，格式照它的 results/<任务>/result.json。
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync, chmodSync, statSync, readdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { readStrictResult, strictDays, compare, clues, report } from '../src/ranking/calibrate.js';

const day = '2026-10-22';
const tmp = (p) => mkdtempSync(join(tmpdir(), p));
const fastSnapshot = (entries, extra = {}) => ({ statDay: day, runId: 'run1', generatedAt: '2026-10-23T08:40:00.000Z', check: { passed: false, threshold: 1 }, candidates: { failed: [] }, ...extra, entries: entries.map(([rank, projectId, fullName, gain]) => ({ rank, projectId, fullName, gain, total: 0, evidence: { history: { date: 'Fri, 23 Oct 2026 08:33:34 GMT' } } })) });
function strictDir(rows, job = 'day2', dir = tmp('gc-strict-'), finishedAt = '2026-10-23T20:00:00+00:00') {
  mkdirSync(join(dir, 'results', job), { recursive: true });
  writeFileSync(join(dir, 'results', job, 'result.json'), JSON.stringify({ job_id: job, statistical_day_label: day, finished_at: finishedAt, top20_plus_ties: rows.map(([id, repo, value]) => ({ job, id, repo, value, checked: 1792750000 })) }));
  return dir;
}
const base = [[1, 11, 'a/one', 900], [2, 22, 'b/two', 500], [3, 33, 'c/three', 300]];

test('一致：名单和数字都相同', () => {
  const dir = strictDir(base.map(([, id, repo, v]) => [id, repo, v]));
  const { result } = readStrictResult(dir, day);
  const diff = compare({ fast: fastSnapshot(base), strict: result });
  assert.equal(diff.verdict, '一致');
  assert.deepEqual([diff.missing, diff.extra, diff.numbers], [[], [], []]);
  assert.match(report({ diff, fast: fastSnapshot(base), strictPath: 'x', missingWithClues: [] }), /结论：\*\*一致\*\*，名单和数字都与严格方案相同/);
});

test('名单不同：列出漏掉的和多出来的，并给出排查线索（事件记录次数、是否进了候选、核数失败）', () => {
  const dir = strictDir([[11, 'a/one', 900], [22, 'b/two', 500], [44, 'd/four', 400], [55, 'e/five', 350], [66, 'f/six', 320]]);
  const fast = fastSnapshot(base, { candidates: { failed: [{ name: 'f/six', reason: '503' }] } });
  const diff = compare({ fast, strict: readStrictResult(dir, day).result });
  assert.equal(diff.verdict, '名单不同');
  assert.deepEqual(diff.missing.map((m) => m.fullName), ['d/four', 'e/five', 'f/six']);
  assert.deepEqual(diff.extra.map((m) => m.fullName), ['c/three']);
  // 快速方法的数据目录：当天事件数据里 d/four 记了 1 次（达到门槛 1，进了候选）、e/five 没记到；f/six 只有名字、核数失败。
  const dataDir = tmp('gc-data-');
  mkdirSync(join(dataDir, 'events'), { recursive: true });
  writeFileSync(join(dataDir, 'events', `${day}.json`), JSON.stringify({ rows: [{ id: 44, name: 'd/four', events: 1 }, { id: null, name: 'F/Six', events: 2 }] }));
  const missingWithClues = clues({ diff, fast, dataDir });
  assert.deepEqual(missingWithClues.map((m) => [m.fullName, m.records, m.candidate]), [['d/four', 1, '是'], ['e/five', 0, '否'], ['f/six', 2, '核数失败']]);
  const text = report({ diff, fast, strictPath: 'x', missingWithClues });
  assert.match(text, /结论：\*\*名单不同\*\*。不一致视为缺陷/);
  assert.match(text, /\|d\/four\|400\|1\|是（核数后没排进前 20，查核数）\|/);
  assert.match(text, /\|e\/five\|350\|0\|否（查事件漏记和候选门槛/);
  assert.match(text, /\|f\/six\|320\|2\|进了，但官方核数失败\|/);
  assert.match(text, /第 20 名（含并列）新增 300.*候选门槛 1 次事件记录/);
  assert.match(text, /严格方案：x（只读），第 20 名（含并列）新增 320/);
  assert.match(text, /\|c\/three\|300\|/);
});

test('数字不同：名单一样但新增数不同，列出两边数字和取数时间', () => {
  const dir = strictDir([[11, 'a/one', 900], [22, 'b/two', 498], [33, 'c/three', 300]]);
  const diff = compare({ fast: fastSnapshot(base), strict: readStrictResult(dir, day).result });
  assert.equal(diff.verdict, '数字不同');
  assert.deepEqual(diff.numbers.map((n) => [n.fullName, n.fast, n.strict]), [['b/two', 500, 498]]);
  assert.equal(diff.numbers[0].fastAt, '2026-10-23T08:33:34.000Z');
  assert.match(report({ diff, fast: fastSnapshot(base), strictPath: 'x', missingWithClues: [] }), /\|b\/two\|500\|498\|2026-10-23T08:33:34.000Z\|/);
});

test('自检上线之前的快照没有候选门槛：按那次运行有没有存它的官方星数历史判断是否进了候选', () => {
  const fast = fastSnapshot(base, { check: undefined, candidates: { total: 302 } });
  const diff = compare({ fast, strict: readStrictResult(strictDir([[11, 'a/one', 900], [22, 'b/two', 500], [33, 'c/three', 300], [44, 'd/four', 300]]), day).result });
  const dataDir = tmp('gc-data-');
  mkdirSync(join(dataDir, 'runs', 'run1', 'raw', 'history'), { recursive: true });
  writeFileSync(join(dataDir, 'runs', 'run1', 'raw', 'history', '44.json'), '[]');
  assert.deepEqual(clues({ diff, fast, dataDir }).map((m) => [m.fullName, m.records, m.candidate]), [['d/four', null, '是']]);
  assert.match(report({ diff, fast, strictPath: 'x', missingWithClues: clues({ diff, fast, dataDir }) }), /生成于自检上线之前.*\n[\s\S]*\|d\/four\|300\|（当天事件数据未存）\|是/);
});

test('同一统计日有几份严格结果时取最后完成的那份；列出已有结果的统计日', () => {
  const dir = strictDir([[11, 'a/one', 1]], 'old', tmp('gc-strict-'), '2026-10-23T01:00:00+00:00');
  strictDir([[11, 'a/one', 2]], 'new', dir, '2026-10-23T05:00:00+00:00');
  assert.equal(readStrictResult(dir, day).result.job_id, 'new');
  assert.deepEqual(strictDays(dir), [day]);
});

test('只读严格实验目录：目录设为只读也能读，读完不留任何新文件、不改动原文件', () => {
  const dir = strictDir(base.map(([, id, repo, v]) => [id, repo, v]));
  const file = join(dir, 'results', 'day2', 'result.json');
  const before = statSync(file).mtimeMs;
  for (const p of [join(dir, 'results', 'day2'), join(dir, 'results'), dir]) chmodSync(p, 0o555);
  try {
    assert.equal(readStrictResult(dir, day).result.job_id, 'day2');
    assert.equal(readStrictResult(dir, '2026-10-21'), null);
    assert.deepEqual(readdirSync(join(dir, 'results', 'day2')), ['result.json']);
    assert.equal(statSync(file).mtimeMs, before);
  } finally {
    for (const p of [dir, join(dir, 'results'), join(dir, 'results', 'day2')]) chmodSync(p, 0o755);
  }
});

test('严格方案还没有结果时返回空', () => {
  assert.equal(readStrictResult(tmp('gc-strict-'), day), null);
});
