// 接缝 2：本机网站首页（登录后）。首页只读快照、更新记录和项目资料，访问时不调用外部接口。
// #13 起首页按视觉方案由页面脚本画出，数据整份嵌在页面里；这里检查嵌入的数据，浏览器里的样子另用无头 Chrome 实看。
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, copyFileSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { startServer } from '../src/web/server.js';
import { dailySeries } from '../src/web/home.js';
import { saveProfile } from '../src/profiles/store.js';
import { visit, serve, http } from './helpers/web.js';

const fixture = new URL('./fixtures/snapshot-d1-2026-10-22.json', import.meta.url);
function dataDirWithSnapshot() {
  const dir = mkdtempSync(join(tmpdir(), 'gc-web-'));
  mkdirSync(join(dir, 'snapshots', 'd1'), { recursive: true });
  copyFileSync(fixture, join(dir, 'snapshots', 'd1', '2026-10-22.json'));
  return dir;
}
// 在 #2 的快照上补齐 #3 的字段，写成任意窗口的快照。
function writeSnapshot(dir, window, extra) {
  const base = JSON.parse(readFileSync(fixture, 'utf8'));
  const snapshot = {
    ...base,
    window,
    from: '2026-10-22',
    candidates: { ...base.candidates, backfilledDays: [], failed: [] },
    check: { passed: true, missProbability: 1e-9, threshold: 30, recordRatio: 0.01, expectedRecords: 60 },
    incomplete: false,
    ...extra,
  };
  mkdirSync(join(dir, 'snapshots', window), { recursive: true });
  writeFileSync(join(dir, 'snapshots', window, `${snapshot.statDay}.json`), JSON.stringify(snapshot));
}
// 页面里嵌入的首页数据。
const dataOf = (body) => JSON.parse(body.match(/<script type="application\/json" id="gc-data">([^<]*)<\/script>/)[1]);
const home = async (dir, path = 'stars') => {
  const r = await visit(dir, path);
  return { ...r, data: r.status === 200 ? dataOf(r.body) : null };
};

// 2026-10-18（周日）起的一周与前几周：days[0..6] 是周日到周六。
const WEEK = (day) => Date.parse(`${day}T00:00:00Z`) / 1000;
const weeks = [
  { week: WEEK('2026-10-18'), days: [10, 11, 12, 13, 14, 15, 16] },
  { week: WEEK('2026-10-11'), days: [7, 7, 7, 7, 7, 7, 7] },
  { week: WEEK('2026-10-04'), days: [1, 1, 1, 1, 1, 1, 1] },
  { week: WEEK('2026-09-27'), days: [2, 2, 2, 2, 2, 2, 2] },
  { week: WEEK('2026-09-20'), days: [3, 3, 3, 3, 3, 3, 3] },
  { week: WEEK('2026-09-13'), days: [4, 4, 4, 4, 4, 4, 4] },
];

test('首页嵌入近 1 天榜单：名次、并列、新增、总 Star、统计日期、更新时间', async () => {
  const { status, body, data } = await home(dataDirWithSnapshot());
  assert.equal(status, 200);
  // 白雾外壳（#21）：反色鲨鱼背景、顶栏是发现／涨星／收藏／设置（2026-11-04 改名，发现放第一个）；涨星页的样式和脚本。
  assert.match(body, /<link rel="stylesheet" href="\/assets\/bw\.css">\n<link rel="stylesheet" href="\/assets\/shell\.css">/);
  assert.match(body, /<canvas class="sea" id="sea" aria-hidden="true"><\/canvas>/);
  assert.match(body, /<nav class="nav" aria-label="主导航"><a href="\/">发现<\/a><a href="\/stars" aria-current="page">涨星<\/a><a href="\/favorites">收藏<\/a><a href="\/settings">设置<\/a><\/nav>/);
  // 品牌 Github·Tidings（2026-11-03 定稿）：报徽图标 + 衬线斜体字标；浏览器标签用同一个图标。
  assert.match(body, /<a class="brand" href="\/"><svg class="logo" width="24" height="24" aria-hidden="true" viewBox="0 0 24 24">[\s\S]*?<\/svg><span class="wm">Github<span class="d">·<\/span>Tidings<\/span><\/a>/);
  assert.match(body, /<title>涨星 · Github·Tidings<\/title>\n<link rel="icon" href="data:image\/svg\+xml,%3Csvg%20xmlns/);
  assert.match(body, /<script src="\/assets\/sharks\.js"><\/script>\n<script src="\/assets\/shell\.js"><\/script>\n<script src="\/assets\/bw\.js"><\/script>\n<script src="\/assets\/home\.js"><\/script>/);
  const d1 = data.windows.d1;
  assert.deepEqual(d1.top, { tone: 'ok', text: '10 月 22 日数据 · 16:40 更新' });
  assert.deepEqual(d1.lede, { span: '统计日 10 月 22 日（UTC）', candidates: 23, checks: 23 + 21 });
  assert.deepEqual(d1.entries.slice(0, 7).map(({ repo, rank, tie, gain }) => [repo, rank, tie, gain]), [
    ['php/php-src', 1, false, 5200],
    ['anthropics/knowledge-work-plugins', 2, false, 3100],
    ['DietrichGebert/ponytail', 3, false, 2400],
    ['cloudflare/security-audit-skill', 4, false, 1800],
    ['Graphify-Labs/graphify', 5, true, 1500],
    ['nicholasx417/WinNative-Components', 5, true, 1500],
    ['GabrielTaiga/Taiga-Launcher-for-Steam', 7, false, 1200],
  ]);
  const run = d1.entries[0].run;
  assert.equal(data.projects['php/php-src'].runs[run].total, 193409);
  assert.equal(data.account.name, 'tester');
  // 这份快照生成于自检上线之前，页面如实说明；10-22 早于名次变化的起始期（#17），提示条写没有上一期。
  assert.deepEqual(d1.notes.map((n) => n.title), ['未做自检', '没有上一期']);
  assert.match(d1.notes[0].text, /没有做完整性自检/);
});

test('网站只监听本机地址', async () => {
  const { server } = await startServer({ dataDir: dataDirWithSnapshot(), port: 0 });
  try {
    assert.equal(server.address().address, '127.0.0.1');
  } finally {
    server.close();
  }
});

test('访问首页时不调用任何外部接口', async (t) => {
  const outbound = t.mock.method(globalThis, 'fetch', async () => { throw new Error('首页不应发外部请求'); });
  const { status } = await visit(dataDirWithSnapshot(), 'stars');
  assert.equal(status, 200);
  assert.equal(outbound.mock.callCount(), 0);
});

test('还没有任何快照时，首页如实说明', async () => {
  const { status, data } = await home(mkdtempSync(join(tmpdir(), 'gc-web-')));
  assert.equal(status, 200);
  assert.deepEqual(data.windows.d1.entries, []);
  assert.equal(data.windows.d1.empty.title, '还没有近 1 天的榜单');
  assert.deepEqual(data.windows.d1.top, { tone: 'warn', text: '还没有数据' });
});

test('近 7、30 天的榜单一起嵌进页面，写明统计的起止日期；?w= 只认三个窗口', async () => {
  const dir = dataDirWithSnapshot();
  writeSnapshot(dir, 'd7', { from: '2026-10-16' });
  writeSnapshot(dir, 'd30', { from: '2026-09-23' });
  const { data } = await home(dir);
  assert.deepEqual(Object.keys(data.windows), ['d1', 'd7', 'd30']);
  assert.equal(data.windows.d7.label, '近 7 天');
  assert.equal(data.windows.d7.lede.span, '统计 10 月 16 日至 10 月 22 日（UTC）');
  assert.equal(data.windows.d30.lede.span, '统计 9 月 23 日至 10 月 22 日（UTC）');
  assert.deepEqual(data.windows.d7.notes.map((n) => n.title), ['没有上一期']);
  assert.equal((await visit(dir, 'stars?w=d7')).status, 200);
  assert.equal((await visit(dir, 'stars?w=d3')).status, 404);
});

test('自检不通过或有候选核数失败时，标“可能不完整”并写出漏失概率', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'gc-web-'));
  writeSnapshot(dir, 'd1', {
    check: { passed: false, missProbability: 1.1e-4, threshold: 1, recordRatio: 0.011, expectedRecords: 9.1 },
    candidates: { total: 3900, archive: 3891, trending: 9, fallbackHours: [], backfilledDays: [], unavailable: [], failed: [{ name: 'a/b', reason: '503' }] },
    incomplete: true,
  });
  const { body, data } = await home(dir);
  assert.deepEqual(data.windows.d1.notes, [{ tone: 'warn', icon: 'warn', title: '可能不完整', text: '自检未通过，估计漏掉一个该上榜项目的概率约万分之 1.1（要求小于百分之一）；1 个候选的官方核数失败，名次可能有出入。' }, { icon: 'calendar', title: '没有上一期', text: '暂不显示名次变化。' }]);
  assert.deepEqual(data.windows.d1.top, { tone: 'warn', text: '可能不完整 · 10 月 22 日数据' });
  // 事件记录次数和候选门槛只用于自检，不上页面。
  assert.doesNotMatch(body, /3891|门槛/);
});

test('更新失败时仍显示上一次的榜单，写明它的真实日期和失败原因', async () => {
  const dir = dataDirWithSnapshot();
  writeFileSync(join(dir, 'status.json'), JSON.stringify({ boards: { d1: { day: '2026-10-23', at: '2026-10-24T02:10:00.000Z', status: 'failed', error: '官方热门日榜返回 503' } } }));
  const { data } = await home(dir);
  assert.deepEqual(data.windows.d1.top, { tone: 'bad', text: '更新失败 · 显示 10 月 22 日数据' });
  assert.equal(data.windows.d1.notes[0].text, '10 月 23 日的更新失败：官方热门日榜返回 503。下面是上次成功的 10 月 22 日数据。');
  assert.equal(data.windows.d1.entries[0].repo, 'php/php-src');
  // 失败的日子比当前快照旧（重跑更早的日子失败）时不提示。
  writeFileSync(join(dir, 'status.json'), JSON.stringify({ boards: { d1: { day: '2026-10-21', at: '2026-10-24T02:10:00.000Z', status: 'failed', error: 'x' } } }));
  assert.ok(!(await home(dir)).data.windows.d1.notes.some((n) => n.title === '更新失败'));
});

test('30 天走势按统计日从官方星数历史取，跨周拼接；缺一周的那几天记为缺数据，项目还不存在的日子记 0', () => {
  const s = dailySeries(weeks, '2026-10-22');
  assert.equal(s.length, 30);
  // 10-22 是周四（第 4 格），最后 5 天是 10-18 到 10-22。
  assert.deepEqual(s.slice(-5), [10, 11, 12, 13, 14]);
  assert.deepEqual(s.slice(0, 2), [3, 3]); // 9-23、9-24
  // 缺 10-04 那一周：10-04 到 10-10 七天缺数据，别的日子照常（缺失不补零）。
  const gap = dailySeries(weeks.filter((_, i) => i !== 2), '2026-10-22');
  assert.deepEqual(gap.slice(11, 18), Array(7).fill(null));
  assert.deepEqual([gap[10], gap[18]], [2, 7]);
  // 只有两周历史（不满一页），更早的日子项目还不存在。
  const young = dailySeries(weeks.slice(0, 2), '2026-10-22');
  assert.deepEqual(young.slice(0, 18), Array(18).fill(0));
  assert.deepEqual(young.slice(-12), [7, 7, 7, 7, 7, 7, 7, 10, 11, 12, 13, 14]);
});

test('项目卡片：走势、三个窗口的新增和总 Star 取这一期榜单那次运行的原始响应；简介没生成好就标生成中', async () => {
  const dir = dataDirWithSnapshot();
  const snap = JSON.parse(readFileSync(join(dir, 'snapshots', 'd1', '2026-10-22.json'), 'utf8'));
  const php = snap.entries[0];
  mkdirSync(join(dir, php.evidence.history.path, '..'), { recursive: true });
  writeFileSync(join(dir, php.evidence.history.path), JSON.stringify(weeks));
  mkdirSync(join(dir, php.evidence.project.path, '..'), { recursive: true });
  writeFileSync(join(dir, php.evidence.project.path), JSON.stringify({ id: php.projectId, owner: { id: 25158 }, language: 'C', created_at: '2011-06-16T01:52:25Z' }));
  // 近 7 天是另一次运行出的（项目信息和历史不同），卡片按各自那一期的运行取数。
  writeSnapshot(dir, 'd7', { from: '2026-10-16', runId: 'r-week', generatedAt: '2026-10-23T12:00:00.000Z', entries: snap.entries.map(({ evidence, ...e }) => e) });
  const { data } = await home(dir);
  const p = data.projects['php/php-src'];
  const day = p.runs[data.windows.d1.entries[0].run];
  assert.equal(day.series.length, 30);
  assert.equal(day.seriesDay, '2026-10-22');
  // 这一期自己的窗口用榜上的数字，另两个窗口按同一份走势相加。
  assert.deepEqual(day.gains, { d1: 5200, d7: 10 + 11 + 12 + 13 + 14 + 7 + 7, d30: day.series.reduce((a, b) => a + b, 0) });
  assert.equal(day.total, 193409);
  assert.deepEqual([p.ownerId, p.lang, p.created], [25158, 'C', '2011-06-16']);
  assert.deepEqual([p.what, p.installable, p.skills], [null, false, []]);
  // 还没生成的短字段留空，不写替代文字。
  assert.deepEqual([p.line, p.use, p.scene, p.tag, p.type], [null, [], [], null, null]);
  // 另一次运行没存原始响应：只有榜上的数字，别的窗口暂缺，不拿另一次运行的数字顶替。
  const week = p.runs['r-week'];
  assert.equal(data.windows.d7.entries[0].run, 'r-week');
  assert.deepEqual([week.series, week.gains], [null, { d1: null, d7: 5200, d30: null }]);
});

test('嵌入的数据把 < 转义，项目文字里出现 </script> 也不会截断页面', async () => {
  const dir = dataDirWithSnapshot();
  const snap = JSON.parse(readFileSync(join(dir, 'snapshots', 'd1', '2026-10-22.json'), 'utf8'));
  saveProfile(dir, {
    projectId: snap.entries[0].projectId, fullName: 'php/php-src',
    material: { hash: 'h', skills: [], docs: [] },
    generated: { materialHash: 'h', what: '会写 </script><b>的项目', problem: 'x', line: '一句话</script>', use: ['用途一', '用途二'], scene: ['场景一', '场景二'], tag: '语言运行时', type: '工具', conditions: [{ kind: '环境', text: '要 PHP', quote: 'PHP' }], skillPurposes: {} },
  });
  const { body, data } = await home(dir);
  assert.equal((body.match(/<\/script>/g) || []).length, 5);
  const p = data.projects['php/php-src'];
  assert.equal(p.what, '会写 </script><b>的项目');
  assert.equal(p.installable, true);
  // 首页短字段（#23）原样给页面；详情栏不放使用条件，卡片数据里也不再带。
  assert.deepEqual([p.line, p.use, p.scene, p.tag, p.type], ['一句话</script>', ['用途一', '用途二'], ['场景一', '场景二'], '语言运行时', '工具']);
  assert.equal(p.conditions, undefined);
  assert.ok(data.types.includes('工具'));
});

test('页面脚本登录后才能取（登录页用的样式和组件脚本除外），只给登记过的文件', async () => {
  const site = await serve(dataDirWithSnapshot());
  try {
    const css = await site.get('assets/components.css');
    assert.equal(css.status, 200);
    assert.match(css.headers['content-type'], /^text\/css/);
    assert.doesNotMatch(css.body, /gc-demo/); // 方案里的演示面板不进入生产
    assert.match((await site.get('assets/gc.js')).headers['content-type'], /^text\/javascript/);
    assert.equal((await site.get('assets/nope.js')).status, 404);
    assert.equal((await site.get('assets/%2e%2e%2fserver.js')).status, 404);
    // 登录页（未登录时打开）要用的样式、图标、组件和登录脚本不登录也能取，其余页面脚本不行。
    for (const f of ['tokens.css', 'components.css', 'pages.css', 'icons.js', 'gc.js', 'pages.js', 'login.js']) assert.equal((await http(site.url + `assets/${f}`)).status, 200, f);
    for (const f of ['shell.css', 'bw.css', 'sharks.js', 'shell.js', 'bw.js', 'home.js', 'project.js', 'favorites.js', 'nope.js']) assert.equal((await http(site.url + `assets/${f}`)).status, 303, f);
    // 删掉的日报、其他榜单页脚本不再给（#21）。
    for (const f of ['boards.js', 'daily.js']) assert.equal((await site.get(`assets/${f}`)).status, 404, f);
  } finally {
    site.close();
  }
});

test('日报页已删（#21）：/daily 跳涨星，旧链接不出错', async () => {
  const r = await visit(dataDirWithSnapshot(), 'daily');
  assert.deepEqual([r.status, r.headers.location], [303, '/stars']);
});

test('导航改名（2026-11-04）：首页是发现；以前首页上的涨星榜链接跳 /stars（带原参数），原分类榜地址跳首页', async () => {
  const dir = dataDirWithSnapshot();
  const root = await visit(dir);
  assert.equal(root.status, 200);
  assert.match(root.body, /<title>发现 · Github·Tidings<\/title>/);
  assert.match(root.body, /<nav class="nav" aria-label="主导航"><a href="\/" aria-current="page">发现<\/a><a href="\/stars">涨星<\/a><a href="\/favorites">收藏<\/a><a href="\/settings">设置<\/a><\/nav>/);
  for (const [path, to] of [['?w=d7', '/stars?w=d7'], ['?w=d1&sel=php%2Fphp-src', '/stars?w=d1&sel=php%2Fphp-src'], ['categories', '/']]) {
    const r = await visit(dir, path);
    assert.deepEqual([r.status, r.headers.location], [303, to], path);
  }
});
