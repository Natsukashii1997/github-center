// #28：周报。涨星榜近 7 天最新一期前 10（末位并列一起列出），一句话取项目资料里的 line、没有退回 what；
// 数据不是最新、可能不完整、更新失败照实写；按统计日只写一次。只读本地文件，不碰网络。
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { buildWeekly, weeklyMarkdown, weeklyCard, readWeekly } from '../src/weekly/index.js';

const DAY = '2026-11-01';
const put = (dir, path, obj) => { mkdirSync(join(dir, path, '..'), { recursive: true }); writeFileSync(join(dir, path), JSON.stringify(obj)); };
const entry = (rank, id, fullName, gain) => ({ rank, projectId: id, fullName, gain, total: gain * 10 });
const snapshot = (statDay, entries, extra = {}) => ({
  window: 'd7', statDay, from: '2026-10-26', generatedAt: '2026-11-02T02:30:00.000Z', runId: `rank_d7_${statDay}`,
  check: { passed: true, missProbability: 1e-9, threshold: 30, recordRatio: 0.01, expectedRecords: 60 }, incomplete: false,
  candidates: { total: 300, failed: [] }, entries, ...extra,
});
// 第 10 名两个并列（都列出），第 12 名不列。
const D7 = [
  entry(1, 1, 'acme/rocket', 12000), entry(2, 2, 'acme/notes', 8000), entry(3, 3, 'acme/old', 7000),
  ...[4, 5, 6, 7, 8, 9].map((r) => entry(r, r, `acme/p${r}`, 7000 - r * 500)),
  entry(10, 10, 'acme/tie-a', 1000), entry(10, 11, 'acme/tie-b', 1000), entry(12, 12, 'acme/p12', 900),
];
const profile = (id, fullName, generated, hash = 'h') => ({ projectId: id, fullName, material: { hash, skills: [] }, generated: { materialHash: 'h', conditions: [], ...generated } });

function dataDir({ day = DAY, extra = {}, status } = {}) {
  const dir = mkdtempSync(join(tmpdir(), 'gc-weekly-'));
  put(dir, 'snapshots/d7/2026-10-25.json', snapshot('2026-10-25', [entry(1, 99, 'acme/last-week', 50)]));
  put(dir, `snapshots/d7/${day}.json`, snapshot(day, D7, extra));
  if (status) put(dir, 'status.json', status);
  // rocket 有一句话；notes 只有旧版资料生成的 what（没有 line）；old 的简介依据的是旧资料（写“简介生成中”）。
  put(dir, 'profiles/1.json', profile(1, 'acme/rocket', { what: 'acme/rocket 把脚本打包成命令行工具。', line: '把脚本一键变成\n命令行工具' }));
  put(dir, 'profiles/2.json', profile(2, 'acme/notes', { what: '一个本地优先的笔记应用。' }));
  put(dir, 'profiles/3.json', profile(3, 'acme/old', { what: '旧简介', line: '旧一句话' }, 'h-new'));
  return dir;
}
const build = (dir, at = '2026-11-02T10:40:00Z') => buildWeekly({ dataDir: dir, now: () => new Date(at) });

test('取近 7 天最新一期前 10，末位并列一起列出；一句话取 line，没有就用 what，资料没对上先用上一次的（#52）', () => {
  const dir = dataDir();
  const r = build(dir);
  assert.equal(r.status, 'published');
  const { weekly } = r;
  assert.deepEqual([weekly.statDay, weekly.from, weekly.stale, weekly.notes], [DAY, '2026-10-26', false, []]);
  assert.equal(weekly.entries.length, 11);
  assert.deepEqual(weekly.entries.slice(-3).map((e) => [e.rank, e.repo, e.tie]), [[9, 'acme/p9', false], [10, 'acme/tie-a', true], [10, 'acme/tie-b', true]]);
  assert.ok(!weekly.entries.some((e) => e.repo === 'acme/p12'));
  assert.deepEqual(weekly.entries.slice(0, 3).map((e) => e.line), ['把脚本一键变成\n命令行工具', '一个本地优先的笔记应用。', '旧一句话']);
  assert.deepEqual(readWeekly(dir, DAY), weekly);
});

test('飞书消息：标题带日期区间，每个项目写名次、近 7 天新增、总 Star、本机项目页和 GitHub 链接、一句话', () => {
  const dir = dataDir();
  const r = build(dir);
  assert.equal(r.feishuPath, `weekly/${DAY}.feishu.md`);
  const text = readFileSync(join(dir, r.feishuPath), 'utf8');
  assert.equal(text, weeklyMarkdown(r.weekly));
  assert.match(text, /^## GitHub 本周涨星前 10 · 10 月 26 日–11 月 1 日\n\n涨星榜近 7 天，数据截至 11 月 1 日（GitHub 统计日，美国太平洋时间），11 月 2 日 18:40（北京时间）生成。\n\n\*\*1\. /);
  assert.ok(text.includes('**1. [acme/rocket](http://127.0.0.1:5310/p/acme/rocket)**　近 7 天 +12,000　总 Star 120,000　[GitHub](https://github.com/acme/rocket)\n把脚本一键变成 命令行工具\n'));
  assert.ok(text.includes('[GitHub](https://github.com/acme/notes)\n一个本地优先的笔记应用。\n'));
  assert.ok(text.includes('[GitHub](https://github.com/acme/old)\n旧一句话\n'));
  assert.ok(text.includes('**10. [acme/tie-b](http://127.0.0.1:5310/p/acme/tie-b)**（并列）　近 7 天 +1,000'));
  assert.ok(!text.includes('**提示**'));
  assert.ok(!text.includes('acme/p12'));
  // 从没生成过一句话（#52）：给 GitHub 上的描述，也没有就只列名字和数字，不写“生成中”。
  const bare = { ...r.weekly, entries: [{ ...r.weekly.entries[0], line: null, desc: 'Ship scripts\nas CLIs' }, { ...r.weekly.entries[1], line: null, desc: null }] };
  const md = weeklyMarkdown(bare);
  assert.ok(md.includes('[GitHub](https://github.com/acme/rocket)\nGitHub 上的描述：Ship scripts as CLIs\n'));
  assert.ok(md.includes('[GitHub](https://github.com/acme/notes)\n\n数字来自'));
  assert.doesNotMatch(md, /生成中/);
});

test('数据不是最新：没有失败记录时写明最近一期应是哪天、下面是哪天的数据', () => {
  const r = build(dataDir(), '2026-11-04T10:40:00Z');
  assert.equal(r.weekly.stale, true);
  assert.deepEqual(r.weekly.notes, [{ title: '不是最新数据', text: '最近一期应是 11 月 3 日，还没出；下面是 11 月 1 日的数据。' }]);
  assert.ok(weeklyMarkdown(r.weekly).includes('\n\n**提示**\n- 不是最新数据：最近一期应是 11 月 3 日，还没出；下面是 11 月 1 日的数据。\n'));
});

test('更新失败写原因（不再另写不是最新）；可能不完整写明原因', () => {
  const dir = dataDir({
    extra: { incomplete: true, check: { passed: false, missProbability: 1.1e-4, threshold: 1, recordRatio: 0.011, expectedRecords: 9 } },
    status: { boards: { d7: { day: '2026-11-02', at: '2026-11-03T10:10:00.000Z', status: 'failed', error: 'GH Archive 第 3 小时下载失败' } } },
  });
  const { weekly } = build(dir, '2026-11-03T10:40:00Z');
  assert.deepEqual(weekly.notes.map((n) => n.title), ['更新失败', '可能不完整']);
  assert.match(weekly.notes[0].text, /^11 月 2 日的更新失败：GH Archive 第 3 小时下载失败。下面是上次成功的 11 月 1 日数据。$/);
  assert.match(weekly.notes[1].text, /自检未通过.*名次可能有出入。$/);
  assert.equal(weekly.incomplete, true);
});

test('按统计日只写一次：再跑不重写；消息文件中途没写成就照已有周报补上，已有的不动；没有近 7 天榜单不生成', () => {
  const dir = dataDir();
  const first = build(dir);
  const again = build(dir, '2026-11-05T00:00:00Z');
  assert.deepEqual([again.status, again.statDay, again.weekly], ['exists', DAY, undefined]);
  assert.deepEqual(readWeekly(dir, DAY), first.weekly);
  rmSync(join(dir, first.feishuPath));
  rmSync(join(dir, first.cardPath));
  build(dir);
  assert.equal(readFileSync(join(dir, first.feishuPath), 'utf8'), weeklyMarkdown(first.weekly));
  assert.deepEqual(JSON.parse(readFileSync(join(dir, first.cardPath), 'utf8')), weeklyCard(first.weekly));
  writeFileSync(join(dir, first.feishuPath), '已经交给机器人的版本');
  build(dir);
  assert.equal(readFileSync(join(dir, first.feishuPath), 'utf8'), '已经交给机器人的版本');
  assert.equal(build(mkdtempSync(join(tmpdir(), 'gc-weekly-'))).status, 'missing');
});

// #59：飞书卡片（B 版排行榜，卡片 JSON 2.0）。横幅图由猛鬼兽插在最前面，这里不含图片。
const texts = (els) => els.flatMap((el) => (el.tag === 'column_set' ? el.columns.flatMap((c) => texts(c.elements)) : [el.content ?? el.text?.content ?? '']));

test('飞书卡片：橙色标题栏带日期区间；前 3 名灰底带奖牌和总 Star，其余三列；整行点开 GitHub；并列、新项目、按钮和来源都在', () => {
  const dir = dataDir();
  const r = build(dir);
  assert.equal(r.cardPath, `weekly/${DAY}.card.json`);
  const card = JSON.parse(readFileSync(join(dir, r.cardPath), 'utf8'));
  assert.deepEqual(card, weeklyCard(r.weekly));
  assert.equal(card.schema, '2.0');
  assert.deepEqual([card.header.template, card.header.title.content, card.header.subtitle.content, card.header.text_tag_list[0].text.content],
    ['orange', '🏆 GitHub 本周涨星榜', '10 月 26 日–11 月 1 日 · 近 7 天新增 Star', 'TOP 10']);
  assert.equal(card.config.summary.content, 'GitHub 本周涨星前 10 · 10 月 26 日–11 月 1 日');

  const els = card.body.elements;
  const rows = els.filter((e) => e.tag === 'column_set' && e.action);
  assert.equal(rows.length, 11);
  assert.deepEqual(rows.map((e) => e.action.multi_url.url).slice(0, 2), ['https://github.com/acme/rocket', 'https://github.com/acme/notes']);
  assert.deepEqual(rows.map((e) => e.background_style ?? null).slice(0, 4), ['grey-100', 'grey-100', 'grey-100', null]);
  assert.deepEqual(texts([rows[0]]), ['🥇', '**acme/rocket**\n<font color=\'grey\'>把脚本一键变成 命令行工具</font>', "<font color='orange'>**+12,000**</font>\n<font color='grey'>总 12 万</font>"]);
  assert.deepEqual(texts([rows[3]]), ["<font color='grey'>**4**</font>", '**acme/p4**', "<font color='orange'>**+5,000**</font>"]);
  assert.ok(texts([rows[10]])[1].startsWith('**acme/tie-b**（并列）'));
  assert.ok(!JSON.stringify(card).includes('acme/p12'));
  assert.ok(!JSON.stringify(card).includes('新项目'));

  const buttons = els.find((e) => e.tag === 'column_set' && !e.action).columns.map((c) => c.elements[0]);
  assert.deepEqual(buttons.map((b) => [b.text.content, b.behaviors[0].default_url]), [
    ['GitHub 周趋势', 'https://github.com/trending?since=weekly'],
    ['完整涨星榜（电脑）', 'http://127.0.0.1:5310/stars?w=d7'],
    ['我的收藏（电脑）', 'http://127.0.0.1:5310/favorites'],
  ]);
  assert.equal(els.at(-2).tag, 'hr');
  assert.match(els.at(-1).content, /^来自 Github·Tidings · 数据截至 11 月 1 日（GitHub 统计日，美国太平洋时间），11 月 2 日 18:40（北京时间）生成。/);
});

test('飞书卡片：有提示先列提示；新项目打标签；没有一句话用 GitHub 描述或只列名字；Markdown 符号转义；没有项目写明', () => {
  const r = build(dataDir(), '2026-11-04T10:40:00Z');
  const base = r.weekly.entries[0];
  const w = { ...r.weekly, entries: [
    { ...base, repo: 'a_b/x*y', gain: 9000, total: 9500, line: null, desc: 'Ship <scripts>\nfast' },
    { ...base, rank: 2, repo: 'acme/bare', line: null, desc: null },
  ] };
  const els = weeklyCard(w).body.elements;
  assert.equal(els[0].content, "<font color='orange'>**⚠️ 提示**</font>\n- 不是最新数据：最近一期应是 11 月 3 日，还没出；下面是 11 月 1 日的数据。");
  assert.equal(texts([els[1]])[1], "**a&#95;b/x&#42;y** <text_tag color='red'>新项目</text_tag>\n<font color='grey'>GitHub 上的描述：Ship &#60;scripts&#62; fast</font>");
  assert.equal(texts([els[2]])[1], '**acme/bare**');
  assert.equal(weeklyCard({ ...w, notes: [], entries: [] }).body.elements[0].content, '这一期没有核出项目。');
  // 提示的标题和正文也转义；失败原因里的换行并成一行，免得断开提示列表。
  const note = weeklyCard({ ...w, notes: [{ title: '更新_失败', text: 'GH Archive [3]\n`下载` 失败 & 重试' }] }).body.elements[0].content;
  assert.equal(note.split('\n')[1], '- 更新&#95;失败：GH Archive &#91;3&#93; &#96;下载&#96; 失败 &#38; 重试');
  // 前 3 名并列：都是灰底，奖牌按名次给。
  const tied = weeklyCard({ ...w, notes: [], entries: [{ ...base, rank: 3, tie: true }, { ...base, rank: 3, tie: true, repo: 'acme/twin' }] }).body.elements;
  assert.deepEqual(tied.slice(0, 2).map((e) => [e.background_style, e.columns[0].elements[0].content]), [['grey-100', '🥉'], ['grey-100', '🥉']]);
  assert.match(texts([tied[1]])[1], /^\*\*acme\/twin\*\*（并列）/);
});
