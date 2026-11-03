// #11：日报。三个窗口各前 10（末位并列一起列出），同一项目只介绍一次；背景只写所在窗口内的官方正式版本，没有就不写；
// 概览只按榜单数字拼。上游只回放假的 Release 接口，不碰真实网络。
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync, existsSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { buildDaily, readLatestDaily, feishuMarkdown } from '../src/daily/index.js';
import { visit } from './helpers/web.js';

const DAY = '2026-10-22';
const put = (dir, path, obj) => { mkdirSync(join(dir, path, '..'), { recursive: true }); writeFileSync(join(dir, path), JSON.stringify(obj)); };
const entry = (rank, id, fullName, gain) => ({ rank, projectId: id, fullName, gain, total: gain * 10 });
const snapshot = (window, statDay, entries, extra = {}) => ({
  window, statDay, from: statDay, generatedAt: '2026-10-23T02:30:00.000Z', runId: `rank_${window}_${statDay}`,
  check: { passed: true, missProbability: 1e-9, threshold: 30, recordRatio: 0.01, expectedRecords: 60 }, incomplete: false,
  candidates: { total: 300, failed: [] }, entries, ...extra,
});
// 近 1 天：第 10 名两个并列（都列出），第 12 名不列；近 7、30 天里有和近 1 天、近 7 天重复的项目。
const D1 = [
  entry(1, 1, 'acme/rocket', 900), entry(2, 2, 'acme/notes', 800),
  ...[3, 4, 5, 6, 7, 8, 9].map((r) => entry(r, r, `acme/p${r}`, 800 - r * 50)),
  entry(10, 10, 'acme/tie-a', 100), entry(10, 11, 'acme/tie-b', 100), entry(12, 12, 'acme/p12', 90),
];
const D7 = [entry(1, 1, 'acme/rocket', 5000), entry(2, 20, 'acme/weekly', 4000), entry(3, 2, 'acme/notes', 3000)];
const D30 = [entry(1, 30, 'acme/monthly', 20000), entry(2, 1, 'acme/rocket', 15000), entry(3, 20, 'acme/weekly', 9000)];

function dataDir({ d7 = true, d30Day = DAY, status } = {}) {
  const dir = mkdtempSync(join(tmpdir(), 'gc-daily-'));
  put(dir, `snapshots/d1/${DAY}.json`, snapshot('d1', DAY, D1));
  if (d7) put(dir, `snapshots/d7/${DAY}.json`, snapshot('d7', DAY, D7, { from: '2026-10-16', incomplete: true, check: { passed: false, missProbability: 1.1e-4, threshold: 1, recordRatio: 0.011, expectedRecords: 9 } }));
  put(dir, `snapshots/d30/${d30Day}.json`, snapshot('d30', d30Day, D30, { from: '2026-09-23' }));
  if (status) put(dir, 'status.json', status);
  // 资料：acme/rocket 有对得上当前资料的简介；acme/notes 的简介依据的是旧资料（页面显示“简介生成中”）。
  put(dir, 'profiles/1.json', { projectId: 1, fullName: 'acme/rocket', material: { hash: 'h1', skills: [] }, generated: { materialHash: 'h1', what: 'acme/rocket 把脚本打包成命令行工具。', problem: '省去手写安装脚本。', conditions: [] } });
  put(dir, 'profiles/2.json', { projectId: 2, fullName: 'acme/notes', material: { hash: 'h2-new', skills: [] }, generated: { materialHash: 'h2-old', what: '旧简介', problem: '旧', conditions: [] } });
  return dir;
}

// 假的 Release 接口：acme/rocket 有草稿、预发布、窗口外的版本和一个当天的正式版；acme/weekly 在近 7 天窗口第一天发了一个；
// acme/notes 接口出错，acme/p3 查不到（404），其余都没有 Release。
const rel = (tag, at, extra = {}) => ({ tag_name: tag, name: tag, draft: false, prerelease: false, published_at: at, html_url: `https://github.com/acme/x/releases/tag/${tag}`, ...extra });
const RELEASES = {
  1: [rel('v2.0.1', '2026-10-23T01:00:00Z'), rel('v2.1.0-beta', '2026-10-22T09:00:00Z', { prerelease: true }), rel('v2.2.0', '2026-10-22T10:00:00Z', { draft: true }),
    rel('v2.0.0', '2026-10-22T05:00:00Z'), rel('v1.9.0', '2026-10-21T23:00:00Z')],
  20: [rel('w1', '2026-10-16T00:00:01Z'), rel('w0', '2026-10-15T23:59:00Z')],
};
function fakeGitHub() {
  const calls = [];
  async function fetch(input) {
    const url = String(input);
    calls.push(url);
    const m = url.match(/^https:\/\/api\.github\.com\/repositories\/(\d+)\/releases\?per_page=100$/);
    if (!m) throw new Error(`未录制的请求：${url}`);
    if (m[1] === '2') return new Response('Service Unavailable', { status: 503 });
    if (m[1] === '3') return new Response('{"message":"Not Found"}', { status: 404 });
    return new Response(JSON.stringify(RELEASES[m[1]] ?? []), { headers: { 'content-type': 'application/json' } });
  }
  return { fetch, calls };
}
const build = (dir, up = fakeGitHub()) => buildDaily({ dataDir: dir, fetch: up.fetch, token: 't', now: () => new Date('2026-10-23T02:40:00Z'), sleep: async () => {} });

test('三个窗口各前 10，末位并列一起列出；同一项目只介绍一次，后面再出现记下第一次出现的位置', async () => {
  const dir = dataDir();
  const up = fakeGitHub();
  const r = await build(dir, up);
  assert.equal(r.status, 'published');
  const { windows, projects } = r.daily;
  assert.deepEqual(windows.d1.entries.map((e) => [e.rank, e.repo, e.tie]).slice(-3), [[9, 'acme/p9', false], [10, 'acme/tie-a', true], [10, 'acme/tie-b', true]]);
  assert.equal(windows.d1.entries.length, 11);
  assert.ok(!windows.d1.entries.some((e) => e.repo === 'acme/p12'));
  assert.deepEqual(windows.d7.entries.map((e) => [e.repo, e.first]), [
    ['acme/rocket', { w: 'd1', rank: 1, repo: 'acme/rocket' }], ['acme/weekly', null], ['acme/notes', { w: 'd1', rank: 2, repo: 'acme/notes' }],
  ]);
  assert.deepEqual(windows.d30.entries.map((e) => [e.repo, e.first?.w ?? null]), [['acme/monthly', null], ['acme/rocket', 'd1'], ['acme/weekly', 'd7']]);
  // 每个项目只记一份（介绍、背景都只有一份），记下它上了哪几个窗口；每个项目只查一次 Release。
  assert.equal(Object.keys(projects).length, 13);
  assert.deepEqual(projects['acme/rocket'].windows, ['d1', 'd7', 'd30']);
  assert.deepEqual([projects['acme/weekly'].w, projects['acme/weekly'].windows], ['d7', ['d7', 'd30']]);
  assert.equal(new Set(up.calls).size, 13);
  assert.equal(up.calls.length, 13 + 2); // acme/notes 的 503 重试了两次
  assert.equal(r.daily.requests, 13 + 2);
  assert.deepEqual(readLatestDaily(dir), JSON.parse(JSON.stringify(r.daily)));
});

test('背景只写项目所在窗口内的官方正式版本（跳过草稿、预发布和窗口外的），附官方链接；原始响应存下来', async () => {
  const dir = dataDir();
  const { projects } = (await build(dir)).daily;
  assert.deepEqual(projects['acme/rocket'].release, { tag: 'v2.0.0', publishedAt: '2026-10-22T05:00:00Z', url: 'https://github.com/acme/x/releases/tag/v2.0.0' });
  // 近 7 天窗口是 10 月 16 日到 22 日（UTC），第一天发的算，前一天发的不算。
  assert.equal(projects['acme/weekly'].release.tag, 'w1');
  assert.deepEqual([projects['acme/monthly'].lookup, projects['acme/monthly'].release], ['ok', null]);
  assert.ok(existsSync(join(dir, projects['acme/rocket'].evidence.path)));
  // 简介取对得上当前资料的那份；依据旧资料的不用（显示“简介生成中”）。
  assert.equal(projects['acme/rocket'].what, 'acme/rocket 把脚本打包成命令行工具。');
  assert.deepEqual([projects['acme/notes'].what, projects['acme/notes'].problem], [null, null]);
});

test('没有证据时不写原因：概览只用榜单数字；Release 查不到的如实写明，不当作没发', async () => {
  const dir = dataDir();
  const { daily } = await build(dir);
  assert.equal(daily.overview, '10 月 22 日，近 1 天第 1 名是 acme/rocket（+900），近 7 天第 1 名 acme/rocket（+5,000），近 30 天第 1 名 acme/monthly（+20,000）。'
    + '三个榜的前 10 共 13 个项目，其中 3 个不止上了一个榜。2 个项目在所在时间窗口内发了正式版本。');
  for (const p of ['acme/p4', 'acme/monthly', 'acme/notes']) assert.equal(daily.projects[p].release, null, p);
  assert.deepEqual([daily.projects['acme/notes'].lookup, daily.projects['acme/p3'].lookup], ['error', 'missing']);
  assert.deepEqual(daily.notes.find((n) => n.title === '版本发布没查全'), { icon: 'warn', title: '版本发布没查全', text: '2 个项目的官方 Release 没查全（acme/notes、acme/p3），这几个项目没写版本发布。' });
  assert.doesNotMatch(JSON.stringify(daily), /因为|由于|得益于|爆火|走红|火了|原因/);

  // 一个版本也没查到时，概览不说“发了”；有查不到的，只说“查到的项目”没发；一个都没查成（上游故障）就不说没发。
  const quiet = dataDir();
  const none = { fetch: async () => new Response('[]'), calls: [] };
  assert.match((await build(quiet, none)).daily.overview, /这些项目在所在时间窗口内都没有发正式版本。$/);
  const down = { fetch: async () => new Response('Service Unavailable', { status: 503 }), calls: [] };
  const outage = (await build(dataDir(), down)).daily;
  assert.match(outage.overview, /。官方 Release 这次都没查全，没写版本发布。$/);
  assert.doesNotMatch(outage.overview, /没有发/);
});

test('Release 一页读满、最早的一个还在窗口内又没有正式版本：记为没查全，不说没发；读到窗口起点之前才算查完', async () => {
  // acme/rocket（近 1 天，窗口 10 月 22 日）：当天 100 个预发布版，读满一页；acme/monthly（近 30 天，窗口从 9 月 23 日起）：
  // 99 个预发布版，第 100 个是窗口前的正式版，说明已经读过了窗口起点。
  const many = (n, at) => Array.from({ length: n }, (_, i) => rel(`n${i}`, at, { prerelease: true, created_at: at }));
  const pages = { 1: many(100, '2026-10-22T08:00:00Z'), 30: [...many(99, '2026-10-20T08:00:00Z'), rel('v1.0.0', '2026-09-01T00:00:00Z', { created_at: '2026-09-01T00:00:00Z' })] };
  const up = { fetch: async (u) => new Response(JSON.stringify(pages[String(u).match(/repositories\/(\d+)\/releases\?per_page=100$/)[1]] ?? [])), calls: [] };
  const { daily } = await build(dataDir(), up);
  assert.deepEqual([daily.projects['acme/rocket'].lookup, daily.projects['acme/rocket'].release], ['partial', null]);
  assert.deepEqual([daily.projects['acme/monthly'].lookup, daily.projects['acme/monthly'].release], ['ok', null]);
  assert.equal(daily.notes.find((n) => n.title === '版本发布没查全').text, '1 个项目的官方 Release 没查全（acme/rocket），这几个项目没写版本发布。');
  assert.match(daily.overview, /查到的项目在所在时间窗口内都没有发正式版本。$/);
});

test('按统计日只写一次：再跑不重写、不再请求上游；还没有近 1 天的榜单就不生成', async () => {
  const dir = dataDir();
  await build(dir);
  const again = fakeGitHub();
  const r = await build(dir, again);
  assert.deepEqual([r.status, r.statDay, again.calls.length], ['exists', DAY, 0]);
  const empty = mkdtempSync(join(tmpdir(), 'gc-daily-'));
  assert.equal((await build(empty)).status, 'missing');
  assert.equal(readLatestDaily(empty), null);
});

test('某个窗口当天没出：用更早的一期并写明（更新失败写原因）；可能不完整、还没有榜单都写在提示条里', async () => {
  const dir = dataDir({ d7: false, d30Day: '2026-10-21', status: { boards: { d30: { day: DAY, at: '2026-10-23T02:10:00.000Z', status: 'failed', error: 'GH Archive 第 3 小时下载失败' } } } });
  const { daily } = await build(dir);
  assert.deepEqual([daily.windows.d30.statDay, daily.windows.d7.entries], ['2026-10-21', []]);
  assert.deepEqual(daily.notes.map((n) => n.title), ['近 7 天还没有榜单', '近 30 天更新失败', '版本发布没查全']);
  assert.equal(daily.notes[1].text, '10 月 22 日的更新失败：GH Archive 第 3 小时下载失败。下面是上次成功的 10 月 21 日数据。');
  assert.match(daily.overview, /^10 月 22 日，近 1 天第 1 名是 acme\/rocket（\+900），近 30 天（10 月 21 日的数据）第 1 名 acme\/monthly（\+20,000）。两个榜的前 10/);
  // 飞书消息里没有榜单的窗口，写法同日报页。
  assert.ok(feishuMarkdown(daily).includes('#### 近 7 天前 10\n\n还没有近 7 天的榜单。\n'));
  // 近 7 天自检未通过：提示条同网站。
  const partial = (await build(dataDir())).daily;
  assert.equal(partial.notes[0].title, '近 7 天可能不完整');
});

test('飞书消息内容：同一份日报写成 Markdown 文件（本仓库不发送）；同一项目只介绍一次，项目链到本机项目页并附 GitHub 链接', async () => {
  const dir = dataDir();
  const r = await build(dir);
  assert.equal(r.feishuPath, `daily/${DAY}.feishu.md`);
  const text = readFileSync(join(dir, r.feishuPath), 'utf8');
  assert.equal(text, feishuMarkdown(r.daily));
  assert.match(text, /^## GitHub 快速中心日报 · 10 月 22 日\n\n统计日 10 月 22 日（UTC），10 月 23 日 10:40（北京时间）生成。\n\n10 月 22 日，近 1 天第 1 名是 acme\/rocket/);
  assert.ok(text.includes(r.daily.overview));
  for (const n of r.daily.notes) assert.ok(text.includes(`- ${n.title}：${n.text}`), n.title);
  // 第一次出现：名次、本机项目页、新增、GitHub 链接、简介（干什么、能解决什么问题，同日报页）、有就写版本发布。
  assert.ok(text.includes('**1. [acme/rocket](http://127.0.0.1:5310/p/acme/rocket?from=daily)**　+900　[GitHub](https://github.com/acme/rocket)\nacme/rocket 把脚本打包成命令行工具。 省去手写安装脚本。\n版本发布：10 月 22 日 [v2.0.0](https://github.com/acme/x/releases/tag/v2.0.0)'));
  assert.equal(text.split('acme/rocket 把脚本打包成命令行工具。').length, 2, '简介只出现一次');
  // 再出现：只写名次、新增和“见上”。
  assert.ok(text.includes('**1. [acme/rocket](http://127.0.0.1:5310/p/acme/rocket?from=daily)**　+5,000　见上（近 1 天第 1 名）'));
  assert.ok(text.includes('**3. [acme/weekly](http://127.0.0.1:5310/p/acme/weekly?from=daily)**　+9,000　见上（近 7 天第 2 名）'));
  assert.ok(text.includes('**10. [acme/tie-a](http://127.0.0.1:5310/p/acme/tie-a?from=daily)**（并列）　+100'));
  // 没有版本发布的不写背景；简介没生成好的写“简介生成中”。
  assert.equal(text.match(/^版本发布：/gm).length, 2);
  assert.match(text, /\[GitHub\]\(https:\/\/github\.com\/acme\/notes\)\n简介生成中。\n\n/);
  // 每个项目都链到项目页。
  for (const repo of Object.keys(r.daily.projects)) assert.ok(text.includes(`](http://127.0.0.1:5310/p/${repo}?from=daily)`), repo);
});

test('消息文件中途没写成：再跑时照已有的日报补上，不重新生成日报；已有的消息文件不动', async () => {
  const dir = dataDir();
  const first = await build(dir);
  rmSync(join(dir, first.feishuPath));
  const again = fakeGitHub();
  const r = await build(dir, again);
  assert.deepEqual([r.status, again.calls.length], ['exists', 0]);
  assert.equal(readFileSync(join(dir, r.feishuPath), 'utf8'), feishuMarkdown(first.daily));
  writeFileSync(join(dir, r.feishuPath), '已经交给机器人的版本');
  await build(dir);
  assert.equal(readFileSync(join(dir, r.feishuPath), 'utf8'), '已经交给机器人的版本');
});

test('日报页已删（#21）：/daily 跳首页，旧链接不出错', async () => {
  const dir = dataDir();
  await build(dir);
  const r = await visit(dir, 'daily');
  assert.deepEqual([r.status, r.headers.location], [303, '/']);
});

test('名次变化（#17）：概览末尾加一句，有可比上一期的窗口说前 10 里几个上一期不在前 10、谁连续第 1；列表行不加记号', async () => {
  const dir = dataDir();
  const day = '2026-10-23';
  const D1b = [entry(1, 1, 'acme/rocket', 950), entry(2, 2, 'acme/notes', 820), ...[3, 4, 5, 6, 7, 8].map((r) => entry(r, r, `acme/p${r}`, 800 - r * 50)),
    entry(9, 12, 'acme/p12', 300), entry(10, 99, 'acme/fresh', 250), entry(11, 9, 'acme/p9', 200)];
  put(dir, `snapshots/d1/${day}.json`, snapshot('d1', day, D1b));
  // 近 7、30 天 10-23 那期还不到起始期（10-24），不说。
  put(dir, `snapshots/d7/${day}.json`, snapshot('d7', day, D7));
  put(dir, `snapshots/d30/${day}.json`, snapshot('d30', day, D30));
  const r = await buildDaily({ dataDir: dir, fetch: fakeGitHub().fetch, token: 't', now: () => new Date('2026-10-24T02:40:00Z'), sleep: async () => {} });
  assert.equal(r.daily.statDay, day);
  assert.match(r.daily.overview, /。近 1 天前 10 里有 2 个上一期不在前 10，acme\/rocket 连续 2 期第 1。$/);
  assert.doesNotMatch(r.daily.overview, /新进|近 7 天前 10 里/);
  assert.ok(!JSON.stringify(r.daily.windows).includes('"mv"'));
});
