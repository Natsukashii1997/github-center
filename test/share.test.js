// #63、#71：分享页导出。临时数据目录里放一期近 1 天榜单、一个有资料的项目和所有者账号，头像用假的下载，
// 检查导出成一个文件、四页样式脚本全内联、站内链接留给外层切页、个人信息不带出去、安装指令能查到。
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { copyFileSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { gunzipSync } from 'node:zlib';
import vm from 'node:vm';
import { openAccounts } from '../src/web/accounts.js';
import { takeShare, scrub, shell, dayLabel } from '../src/share/index.js';
import { dataOf } from './helpers/web.js';

const fixture = new URL('./fixtures/snapshot-d1-2026-10-22.json', import.meta.url);
const PNG = Buffer.from('89504e470d0a1a0a0000000d49484452', 'hex');

function dataDir() {
  const dir = mkdtempSync(join(tmpdir(), 'gc-share-'));
  mkdirSync(join(dir, 'snapshots', 'd1'), { recursive: true });
  copyFileSync(fixture, join(dir, 'snapshots', 'd1', '2026-10-22.json'));
  mkdirSync(join(dir, 'profiles'));
  writeFileSync(join(dir, 'profiles', '1903522.json'), JSON.stringify({
    projectId: 1903522, fullName: 'php/php-src', defaultBranch: 'master',
    material: { hash: 'h1', listing: ['README.md', 'skills/'], readme: { path: 'README.md', htmlUrl: 'https://github.com/php/php-src/blob/master/README.md', truncated: false }, docs: [], skills: [{ path: 'skills/pdf', name: 'pdf', description: 'Read PDF.' }], fetchedAt: '2026-10-23T02:00:00Z' },
    generated: { materialHash: 'h1', at: '2026-10-23T02:00:00Z', what: 'PHP 解释器。', problem: '跑 PHP。', conditions: [], droppedConditions: 0, skillPurposes: {} },
  }));
  const accounts = openAccounts(dir);
  accounts.create({ name: 'Zhanghao', role: 'owner' });
  accounts.close();
  return dir;
}

// 外层壳里每行一份数据：window.__AV = {...}; window.__INSTALL_GZ = "..."; const PAGES = {...};
const shellData = (html, name) => JSON.parse(new RegExp(`^\\s*(?:window\\.|const )${name} = (.*);$`, 'm').exec(html)[1]);

test('导出成一个文件：外层是发现页、另三页页内切，样式脚本内联、页头写只读快照和北京时间日期、个人信息不带出去', async () => {
  const dir = dataDir();
  const out = join(dir, 'share');
  const asked = [];
  // 夹具里的项目没有 ownerId，头像都按作者名取；php 那张假装下不到
  const fakeFetch = async (u) => (asked.push(u), u.includes('/php.png') ? new Response('', { status: 404 }) : new Response(PNG));
  const r = await takeShare({ dataDir: dir, outDir: out, fetch: fakeFetch, now: new Date('2026-10-23T17:30:00Z') });
  assert.deepEqual(Object.keys(r.files), ['tidings.html']);
  assert.equal(r.label, '10 月 24 日');                                   // UTC 17:30 已是北京时间次日
  assert.ok(asked.every((u) => /^https:\/\/github\.com\/[\w.-]+\.png\?size=88$/.test(u)));
  assert.deepEqual(r.avatars, [asked.length - 1, asked.length]);         // 下不到的那张不算进去

  const html = readFileSync(join(out, 'tidings.html'), 'utf8');
  assert.match(html, /^<!doctype html>/i);
  assert.match(html.slice(0, 8192), /<title>Github·Tidings<\/title>/);   // Artifact 只在前 8KB 找标题
  assert.doesNotMatch(html, /Zhanghao/);                                 // 账号名不带出去
  assert.match(html, /window\.__tidingsGo = /);
  const pages = { index: html, ...shellData(html, 'PAGES') };
  assert.deepEqual(Object.keys(pages), ['index', 'stars', 'favorites', 'settings']);
  assert.ok(html.indexOf('window.__AV = {') < html.indexOf('window.__AV ??= window.parent.__AV'));   // 头像先于垫片
  for (const [kind, page] of Object.entries(pages)) {
    assert.doesNotMatch(page, /(?:href|src)="\/assets\//, kind);
    assert.doesNotMatch(page, /<script src=/, kind);                     // 全内联，不靠附带文件
    assert.match(page, /window\.__AV \?\?= window\.parent\.__AV/, kind);
    assert.match(page, /只读快照 · 10 月 24 日/, kind);
    assert.match(page, /<a href="\/stars"[^>]*>涨星<\/a>/, kind);        // 站内链接留着，由垫片交给外层切页
  }

  // 个人的东西清掉
  const stars = dataOf(pages.stars);
  assert.ok(Object.values(stars.projects).length > 0);
  assert.ok(Object.values(stars.projects).every((p) => p.saved === false && p.savedSkills.length === 0));
  assert.deepEqual(stars.account, { name: '访客' });
  assert.deepEqual(dataOf(pages.favorites).items, []);
  const settings = dataOf(pages.settings);
  assert.deepEqual([settings.me, settings.canEdit], ['访客', false]);

  // 安装指令：项目 id|AI|Skill 路径
  const install = JSON.parse(gunzipSync(Buffer.from(shellData(html, '__INSTALL_GZ'), 'base64')));
  assert.match(install['1903522|claude-code|'], /php\/php-src/);
  assert.match(install['1903522|codex|skills/pdf'], /Skill「pdf」装进 Codex/);
  // 头像：data: 图，按 n/<作者名小写> 查；下不到的没有
  const av = shellData(html, '__AV');
  assert.ok(Object.entries(av).every(([k, v]) => /^n\/[a-z0-9.-]+$/.test(k) && v.startsWith('data:image/png;base64,')));
  assert.ok(av['n/anthropics'] && !av['n/php']);
});

test('scrub：收藏、投票、能不能改、账号名去掉；收藏页整页给空的', () => {
  const d = { account: { name: 'Nat' }, picks: { canEdit: true, tags: [{ id: 't', cards: [{ repo: 'a/b', up: 1, down: 2, mine: 1 }] }] }, projects: { 'a/b': { saved: true, savedSkills: ['x'] } }, items: [1] };
  assert.deepEqual(scrub('index', d), { account: { name: '访客' }, picks: { canEdit: false, tags: [{ id: 't', cards: [{ repo: 'a/b', up: 0, down: 0, mine: 0 }] }] }, projects: { 'a/b': { saved: false, savedSkills: [] } }, items: [1] });
  assert.deepEqual(scrub('favorites', d).items, []);
  assert.deepEqual(scrub('favorites', d).projects, {});
  assert.deepEqual(scrub('settings', { me: 'Nat', canEdit: true }), { me: '访客', canEdit: false });
  assert.equal(d.account.name, 'Nat');                                   // 不改原对象
});

// 在 vm 里跑垫片：只给它用到的那点 DOM，点一下站内链接，看切页交给了谁
function runShim(win) {
  const on = {};
  const Element = function () {};
  Object.defineProperty(Element.prototype, 'innerHTML', { configurable: true, get() { return ''; }, set() {} });
  Element.prototype.insertAdjacentHTML = () => {};
  Object.assign(win, {
    Element, URL, Response, atob,
    MutationObserver: class { observe() {} },
    document: { documentElement: {}, addEventListener: (t, f) => (on[t] = f), getElementById: () => ({ classList: { add() {}, remove() {} } }) },
    history: { pushState() {}, replaceState() {} },
    fetch: async () => new Response(''),
    addEventListener() {},
  });
  win.window = win;
  vm.runInNewContext(readFileSync(new URL('../src/share/shim.js', import.meta.url), 'utf8'), win);
  on.click({ target: { closest: () => ({ getAttribute: () => '/stars' }) }, preventDefault() {} });
}

test('垫片：外层自己就是发现页，被套在跨域 iframe 里（Artifact 查看器）也切得动；iframe 里的页交给外层', () => {
  // Artifact 里外层页的 parent 是 claude.ai，读它任何属性都抛 SecurityError
  const crossOrigin = new Proxy({}, { get() { throw new Error('SecurityError: Blocked a frame with origin'); }, has() { throw new Error('SecurityError'); } });
  const went = [];
  runShim({ parent: crossOrigin, __INSTALL_GZ: 'QUJD', __tidingsGo: (k) => went.push(['外层', k]) });
  const shellWin = { __INSTALL_GZ: 'QUJD', __tidingsGo: (k) => went.push(['iframe→外层', k]) };
  runShim({ parent: shellWin });
  assert.deepEqual(went, [['外层', 'stars'], ['iframe→外层', 'stars']]);
});

test('dayLabel 按北京时间；外层壳的数据里 </script> 和行分隔符都转义', () => {
  const html = shell({ index: '<html><head><title>发现 · Github·Tidings</title></head><body><p>发现</p></body></html>', stars: '<script>x</script>\u2028' }, {}, 'QUJD');
  assert.equal(shellData(html, 'PAGES').stars, '<script>x</script>\u2028');
  assert.equal((html.match(/<\/script>/g) ?? []).length, 2);            // 只有外层自己的数据和切页两段
  assert.match(html, /^<html><head><title>Github·Tidings<\/title>\n<script>\nwindow\.__AV = \{\};/);
  assert.match(html, /<p>发现<\/p><style>[\s\S]*<\/script>\n<\/body><\/html>$/);
  assert.equal(dayLabel(new Date('2026-11-06T16:00:00Z')), '11 月 7 日');
  assert.equal(dayLabel(new Date('2026-11-06T15:59:00Z')), '11 月 6 日');
});
