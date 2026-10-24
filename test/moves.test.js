// 名次变化与连续上榜（#17）：和上一期比名次、连续期数、起始期与缺期；首页行和项目页名次胶囊带上它们。
// 项目页维护信号（#18）的数据也在这里测（取数在 profiles.test.js）。
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, readFileSync, writeFileSync, utimesSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { rankHistory, markRows, prevDay, NO_PREV, streakText } from '../src/ranking/moves.js';
import { saveProfile } from '../src/profiles/store.js';
import { visit } from './helpers/web.js';

const put = (dir, path, obj) => {
  mkdirSync(join(dir, path, '..'), { recursive: true });
  writeFileSync(join(dir, path), JSON.stringify(obj));
};
const dataOf = (body) => JSON.parse(body.match(/<script type="application\/json" id="gc-data">([^<]*)<\/script>/)[1]);
const e = (rank, id) => ({ rank, projectId: id, fullName: `o/p${id}` });
const snap = (dir, w, day, entries) => put(dir, `snapshots/${w}/${day}.json`, { window: w, statDay: day, entries });
const tmp = () => mkdtempSync(join(tmpdir(), 'gc-moves-'));
const none = () => null;

test('前一个统计日', () => {
  assert.equal(prevDay('2026-10-23'), '2026-10-22');
  assert.equal(prevDay('2026-11-01'), '2026-10-31');
});

test('和上一期比：升、降、持平、新进（上一期不在前 20 含并列）', () => {
  const dir = tmp();
  snap(dir, 'd1', '2026-10-22', [e(1, 1), e(2, 2), e(3, 3), e(3, 4), e(20, 9)]);
  const today = [e(1, 1), e(2, 3), e(3, 2), e(3, 5), e(7, 9)];
  snap(dir, 'd1', '2026-10-23', today);
  const mv = rankHistory(dir, none).moves('d1', null, '2026-10-23');
  assert.deepEqual(today.map(mv), [{ kind: 'flat' }, { kind: 'up', n: 1 }, { kind: 'down', n: 1 }, { kind: 'new' }, { kind: 'up', n: 13 }]);
});

test('上一期缺、或还没到起始期（近 1 天 10-23，近 7/30 天和分类榜 10-24）时不标', () => {
  const dir = tmp();
  snap(dir, 'd1', '2026-10-21', [e(1, 1)]);
  snap(dir, 'd1', '2026-10-22', [e(1, 1)]);
  snap(dir, 'd7', '2026-10-22', [e(1, 1)]);
  snap(dir, 'd7', '2026-10-23', [e(1, 1)]);
  snap(dir, 'd1', '2026-10-25', [e(1, 1)]);
  const h = rankHistory(dir, none);
  assert.equal(h.moves('d1', null, '2026-10-22'), null);
  assert.equal(h.moves('d7', null, '2026-10-23'), null);
  assert.equal(h.moves('d1', null, '2026-10-25'), null, '10-24 那期缺');
  const notes = [];
  const rows = [{ repo: 'o/p1' }];
  markRows(h, { w: 'd7', day: '2026-10-23', rows, raw: [e(1, 1)], notes });
  assert.deepEqual(notes, [NO_PREV]);
  assert.equal(rows[0].mv, undefined);
});

test('连续期数：第 1 优先、N≥2 才写、中间缺一期断开、最早只数到起始期的上一期', () => {
  const dir = tmp();
  for (const day of ['2026-10-20', '2026-10-21', '2026-10-22', '2026-10-23', '2026-10-24']) snap(dir, 'd1', day, [e(1, 1), e(2, 2)]);
  snap(dir, 'd1', '2026-10-25', [e(1, 2), e(2, 1)]);
  snap(dir, 'd1', '2026-10-27', [e(1, 2), e(3, 3)]);
  const h = rankHistory(dir, none);
  // 10-21 及更早不算（近 1 天起始期 10-23，最早数到 10-22）。
  assert.equal(streakText(h.streak('d1', null, '2026-10-24', e(1, 1))), '连续 3 期第 1');
  assert.equal(streakText(h.streak('d1', null, '2026-10-25', e(1, 2))), '连续 4 期前 20');
  assert.equal(streakText(h.streak('d1', null, '2026-10-25', e(2, 1))), '连续 4 期前 20');
  assert.equal(h.streak('d1', null, '2026-10-22', e(1, 1)), null, '只有一期');
  assert.equal(h.streak('d1', null, '2026-10-27', e(1, 2)), null, '10-26 缺一期，断开重算');
});

test('分类榜按这一期的候选和现在的分类重算往期，从 10-24 起标', () => {
  const dir = tmp();
  const cand = (day, items) => put(dir, `candidates/d1/${day}.json`, { statDay: day, check: { completenessFloor: 1 }, items: items.map(([id, gain]) => ({ id, fullName: `o/p${id}`, gain })) });
  cand('2026-10-23', [[1, 50], [2, 40], [3, 30]]);
  cand('2026-10-24', [[2, 60], [1, 50], [4, 45]]);
  const find = (x) => (x.id === 3 ? null : { categories: ['Skill'] });
  const h = rankHistory(dir, find);
  assert.equal(h.moves('d1', 'Skill', '2026-10-23'), null);
  const mv = h.moves('d1', 'Skill', '2026-10-24');
  assert.deepEqual(mv({ id: 2, rank: 1 }), { kind: 'up', n: 1 });
  assert.deepEqual(mv({ id: 1, rank: 2 }), { kind: 'down', n: 1 });
  assert.deepEqual(mv({ id: 4, rank: 3 }), { kind: 'new' });
  assert.equal(streakText(h.streak('d1', 'Skill', '2026-10-24', { id: 1 })), '连续 2 期前 20');
});

// 网站：近 1 天 10-22、10-23 两期（#2 的快照素材改出第二期）。
const fixture = new URL('./fixtures/snapshot-d1-2026-10-22.json', import.meta.url);
function twoDays() {
  const dir = tmp();
  const base = JSON.parse(readFileSync(fixture, 'utf8'));
  put(dir, 'snapshots/d1/2026-10-22.json', base);
  const [a, b, c, ...rest] = base.entries;
  const last = rest.pop();
  const entries = [a, { ...c, rank: 2 }, { ...b, rank: 3 }, ...rest, { ...last, projectId: 42, fullName: 'new/one' }];
  put(dir, 'snapshots/d1/2026-10-23.json', { ...base, statDay: '2026-10-23', from: '2026-10-23', runId: '2026-10-23_r', generatedAt: '2026-10-24T02:00:00Z', entries });
  return dir;
}

test('首页：涨星榜每行带名次变化，阅读卡用的行带连续期数', async () => {
  const { body } = await visit(twoDays());
  const d1 = dataOf(body).windows.d1;
  assert.ok(!d1.notes.some((n) => n.title === '没有上一期'));
  const by = Object.fromEntries(d1.entries.map((r) => [r.repo, r]));
  assert.deepEqual(by['php/php-src'].mv, { kind: 'flat' });
  assert.equal(by['php/php-src'].streak, '连续 2 期第 1');
  assert.deepEqual(by['DietrichGebert/ponytail'].mv, { kind: 'up', n: 1 });
  assert.deepEqual(by['anthropics/knowledge-work-plugins'].mv, { kind: 'down', n: 1 });
  assert.equal(by['anthropics/knowledge-work-plugins'].streak, '连续 2 期前 20');
  assert.deepEqual(by['new/one'].mv, { kind: 'new' });
  assert.equal(by['new/one'].streak, undefined);
});

test('项目页：名次胶囊带名次变化和连续期数；维护信号查不到写未知，有资料按资料写', async () => {
  const dir = twoDays();
  let page = dataOf((await visit(dir, 'p/php/php-src')).body).page;
  assert.deepEqual(page.ranks.map(({ w, rank, mv, streak }) => [w, rank, mv, streak]), [['d1', 1, { kind: 'flat' }, '连续 2 期第 1']]);
  assert.deepEqual(page.maint, { pushed: null, release: { state: 'unknown' } });
  const release = { state: 'ok', tag: 'php-8.4.14', publishedAt: '2026-10-20T09:00:00Z', url: 'https://github.com/php/php-src/releases/tag/php-8.4.14' };
  saveProfile(dir, { projectId: 1903522, fullName: 'php/php-src', pushedAt: '2026-10-23T05:00:00Z', release });
  page = dataOf((await visit(dir, 'p/php/php-src')).body).page;
  assert.deepEqual(page.maint, { pushed: '2026-10-23', release });
  saveProfile(dir, { projectId: 1903522, fullName: 'php/php-src', pushedAt: '2026-10-23T05:00:00Z', release: { state: 'none' } });
  assert.deepEqual(dataOf((await visit(dir, 'p/php/php-src')).body).page.maint.release, { state: 'none' });
});

test('读过的快照留在内存里，文件被重写（修改时间变了）就重读', () => {
  const dir = tmp();
  snap(dir, 'd1', '2026-10-22', [e(1, 1)]);
  snap(dir, 'd1', '2026-10-23', [e(1, 1)]);
  assert.deepEqual(rankHistory(dir, none).moves('d1', null, '2026-10-23')(e(1, 1)), { kind: 'flat' });
  snap(dir, 'd1', '2026-10-22', [e(1, 2), e(2, 1)]);
  utimesSync(join(dir, 'snapshots/d1/2026-10-22.json'), new Date(), new Date(Date.now() + 5000));
  assert.deepEqual(rankHistory(dir, none).moves('d1', null, '2026-10-23')(e(1, 1)), { kind: 'up', n: 1 });
});
