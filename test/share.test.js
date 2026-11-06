// #63：只读快照导出。临时数据目录里放一期近 1 天榜单、一个有资料的项目和所有者账号，头像用假的下载，
// 检查四页都导出、样式脚本全内联、站内链接改成文件名、个人信息不带出去、安装指令能查到。
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { copyFileSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { gunzipSync } from 'node:zlib';
import { openAccounts } from '../src/web/accounts.js';
import { takeShare, scrub, artifactMain, dayLabel } from '../src/share/index.js';
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

test('导出四页和两份共用文件：样式脚本内联、站内链接改成文件名、页头写只读快照和北京时间日期', async () => {
  const dir = dataDir();
  const out = join(dir, 'share');
  const asked = [];
  // 夹具里的项目没有 ownerId，头像都按作者名取；php 那张假装下不到
  const fakeFetch = async (u) => (asked.push(u), u.includes('/php.png') ? new Response('', { status: 404 }) : new Response(PNG));
  const r = await takeShare({ dataDir: dir, outDir: out, fetch: fakeFetch, now: new Date('2026-10-23T17:30:00Z') });
  assert.deepEqual(Object.keys(r.files).sort(), ['favorites.html', 'index.html', 'settings.html', 'stars.html', 'tidings-avatars.js', 'tidings-install.gz.txt']);
  assert.equal(r.label, '10 月 24 日');                                   // UTC 17:30 已是北京时间次日
  assert.ok(asked.every((u) => /^https:\/\/github\.com\/[\w.-]+\.png\?size=88$/.test(u)));
  assert.deepEqual(r.avatars, [asked.length - 1, asked.length]);         // 下不到的那张不算进去

  const read = (f) => readFileSync(join(out, f), 'utf8');
  for (const f of ['index.html', 'stars.html', 'favorites.html', 'settings.html']) {
    const html = read(f);
    assert.doesNotMatch(html, /(?:href|src)="\/assets\//, f);
    assert.doesNotMatch(html, /href="\/[^/]/, f);                         // 站内链接都改成了文件名
    assert.match(html, /<script src="tidings-avatars\.js"><\/script>/, f);
    assert.match(html, /只读快照 · 10 月 24 日/, f);
    assert.doesNotMatch(html, /Zhanghao/, f);                             // 账号名不带出去
    assert.match(html, /<a href="stars\.html"[^>]*>涨星<\/a>/, f);
  }
  // 主页面给 Artifact 套壳：没有外层标签，标题是站名
  const index = read('index.html');
  assert.doesNotMatch(index, /<!doctype|<html|<body|<meta charset/i);
  assert.match(index, /^<title>Github·Tidings<\/title>/);
  assert.match(read('stars.html'), /^<!doctype html>/i);

  // 个人的东西清掉
  const stars = dataOf(read('stars.html'));
  assert.ok(Object.values(stars.projects).length > 0);
  assert.ok(Object.values(stars.projects).every((p) => p.saved === false && p.savedSkills.length === 0));
  assert.deepEqual(stars.account, { name: '访客' });
  assert.deepEqual(dataOf(read('favorites.html')).items, []);
  const settings = dataOf(read('settings.html'));
  assert.deepEqual([settings.me, settings.canEdit], ['访客', false]);

  // 安装指令：项目 id|AI|Skill 路径
  const install = JSON.parse(gunzipSync(Buffer.from(read('tidings-install.gz.txt'), 'base64')));
  assert.match(install['1903522|claude-code|'], /php\/php-src/);
  assert.match(install['1903522|codex|skills/pdf'], /Skill「pdf」装进 Codex/);
  // 头像：data: 图，按 n/<作者名小写> 查；下不到的没有
  const av = JSON.parse(read('tidings-avatars.js').replace(/^window\.__AV = |;\n$/g, ''));
  assert.ok(Object.entries(av).every(([k, v]) => /^n\/[a-z0-9.-]+$/.test(k) && v.startsWith('data:image/png;base64,')));
  assert.ok(av['n/anthropics'] && !av['n/php']);
});

test('scrub：收藏、能不能改、账号名去掉；收藏页整页给空的', () => {
  const d = { account: { name: 'Nat' }, picks: { canEdit: true }, projects: { 'a/b': { saved: true, savedSkills: ['x'] } }, items: [1] };
  assert.deepEqual(scrub('index', d), { account: { name: '访客' }, picks: { canEdit: false }, projects: { 'a/b': { saved: false, savedSkills: [] } }, items: [1] });
  assert.deepEqual(scrub('favorites', d).items, []);
  assert.deepEqual(scrub('favorites', d).projects, {});
  assert.deepEqual(scrub('settings', { me: 'Nat', canEdit: true }), { me: '访客', canEdit: false });
  assert.equal(d.account.name, 'Nat');                                   // 不改原对象
});

test('artifactMain 只留 head 里的内容和 body；dayLabel 按北京时间', () => {
  const html = '<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="x"><title>发现 · Github·Tidings</title><style>a{}</style></head><body class="x"><main>hi</main></body></html>';
  assert.equal(artifactMain(html), '<title>Github·Tidings</title><style>a{}</style>\n<main>hi</main>\n');
  assert.equal(dayLabel(new Date('2026-11-06T16:00:00Z')), '11 月 7 日');
  assert.equal(dayLabel(new Date('2026-11-06T15:59:00Z')), '11 月 6 日');
});
