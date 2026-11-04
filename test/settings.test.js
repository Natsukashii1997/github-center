// 设置页（所有者 2026-11-03 加，原型 brand/settings.html 的 A 分区原版）：设置的读写和校验、状态汇总、页面和接口（只有所有者能改）。
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { readSettings, parseSettings, saveSettings, checkDaily, DEFAULTS, SettingsError } from '../src/settings/index.js';
import { nextRun } from '../src/web/settings.js';
import { parseRun as lastRun } from '../src/update-steps.js';
import { openAccounts } from '../src/web/accounts.js';
import { http, form, serve, testAccount, dataOf } from './helpers/web.js';

const fresh = () => mkdtempSync(join(tmpdir(), 'gc-settings-'));
const put = (dir, path, text) => {
  mkdirSync(dirname(join(dir, path)), { recursive: true });
  writeFileSync(join(dir, path), typeof text === 'string' ? text : JSON.stringify(text));
};
// 页面提交的整份设置（默认值），over 覆盖其中几项。
const fieldsOf = (s, over = {}) => ({
  ...Object.fromEntries(Object.entries(s.sources).map(([k, v]) => [`sources.${k}`, v ? 'on' : 'off'])),
  agent: s.agent,
  ...Object.fromEntries(Object.entries(s.effort).map(([k, v]) => [`effort.${k}`, v])),
  'daily.on': s.daily.on ? 'on' : 'off', 'daily.at': s.daily.at,
  'weekly.on': s.weekly.on ? 'on' : 'off', 'weekly.day': String(s.weekly.day), 'weekly.at': s.weekly.at,
  ...over,
});
const parse = (over) => parseSettings(new URLSearchParams(fieldsOf(DEFAULTS, over)));

test('读设置：没存过用默认值；文件坏了、缺项、乱填都回到默认，GH Archive 总是开、Reddit 总是关', () => {
  const dir = fresh();
  assert.deepEqual(readSettings(dir), DEFAULTS);
  assert.equal(DEFAULTS.sources.gharchive, true);
  assert.equal(DEFAULTS.sources.reddit, false);
  assert.deepEqual(DEFAULTS.effort, { profiles: 'low', classify: 'low', picks: 'low' });
  assert.equal(DEFAULTS.agent, 'codex');
  put(dir, 'settings.json', '{坏的');
  assert.deepEqual(readSettings(dir), DEFAULTS);
  put(dir, 'settings.json', { sources: { gharchive: false, reddit: true, hn: false, v2ex: 'x' }, agent: 'gemini', effort: { classify: 'high', picks: 'max' }, daily: { at: '08:00' }, weekly: { day: 9, on: true } });
  const s = readSettings(dir);
  assert.equal(s.sources.gharchive, true);
  assert.equal(s.sources.reddit, false);
  assert.equal(s.sources.hn, false);
  assert.equal(s.sources.v2ex, true);
  assert.deepEqual(s.effort, { profiles: 'low', classify: 'high', picks: 'low' });
  assert.equal(s.agent, 'codex');
  assert.equal(s.daily.at, '10:00');
  assert.deepEqual(s.weekly, { on: true, day: 1, at: '11:30' });
});

test('校验：GH Archive 不能关，Reddit 不能开，智能体只认 Codex、Claude，强度只认低中高，每日更新不早于 09:00、按 15 分钟一档，缺项不收', () => {
  const ok = parse({ 'sources.hn': 'off', 'effort.classify': 'high', 'daily.at': '09:00', 'weekly.on': 'on', 'weekly.day': '0', 'weekly.at': '20:05' });
  assert.equal(ok.sources.hn, false);
  assert.equal(ok.effort.classify, 'high');
  assert.equal(ok.agent, 'codex');
  assert.equal(parse({ agent: 'claude' }).agent, 'claude');
  assert.throws(() => parse({ agent: 'gemini' }), /智能体只能是 codex、claude/);
  assert.deepEqual(ok.daily, { on: true, at: '09:00' });
  assert.deepEqual(ok.weekly, { on: true, day: 0, at: '20:05' });
  assert.throws(() => parse({ 'sources.gharchive': 'off' }), /GH Archive.*不能关/);
  assert.throws(() => parse({ 'sources.reddit': 'on' }), /Reddit 还没接/);
  assert.throws(() => parse({ 'effort.picks': 'max' }), /思考强度只能是/);
  assert.throws(() => parse({ 'daily.at': '08:45' }), /不能早于 09:00/);
  assert.throws(() => parse({ 'daily.at': '10:10' }), /15 分钟一档/);
  assert.throws(() => parse({ 'daily.at': '24:00' }), /格式不对/);
  assert.throws(() => parse({ 'weekly.day': '7' }), /星期不对/);
  assert.throws(() => parse({ 'weekly.day': '' }), /星期不对/);
  assert.throws(() => parse({ 'sources.hn': 'yes' }), SettingsError);
  const missing = new URLSearchParams(fieldsOf(DEFAULTS));
  missing.delete('effort.profiles');
  assert.throws(() => parseSettings(missing), /缺少 effort.profiles/);
  assert.equal(checkDaily('23:45'), null);
});

test('存设置：整份写进 data/settings.json，带保存时刻，读回来一样', () => {
  const dir = fresh();
  const s = parse({ 'sources.skills': 'off', agent: 'claude', 'effort.profiles': 'medium' });
  saveSettings(dir, s, () => new Date('2026-11-03T12:00:00Z'));
  const back = readSettings(dir);
  assert.equal(back.savedAt, '2026-11-03T12:00:00.000Z');
  assert.equal(back.sources.skills, false);
  assert.equal(back.effort.profiles, 'medium');
  assert.equal(back.agent, 'claude');
});

test('上次每日更新从日志读：成功、有失败的步骤、还在跑；下次更新看今天（北京时间）跑过没有', () => {
  const log = (lines) => lines.join('\n') + '\n';
  assert.equal(lastRun(''), null);
  const done = lastRun(log(['2026-11-02T02:00:00Z 每日更新开始', '2026-11-02T02:30:00Z 每日更新结束：失败 出榜', 'exit 1',
    '2026-11-03T02:00:01.000Z 每日更新开始', '2026-11-03T02:00:01.000Z ▶ 出榜', '2026-11-03T02:10:00.000Z 出榜 退出码 0',
    '2026-11-03T02:11:00.000Z 热点榜 退出码 1', '2026-11-03T02:12:00.000Z 归类 退出码 2', '2026-11-03T02:20:00.000Z 每日更新结束：失败 热点榜、归类', 'exit 1']));
  assert.deepEqual(done, { startedAt: '2026-11-03T02:00:01.000Z', endedAt: '2026-11-03T02:20:00.000Z', failed: ['热点榜', '归类'], running: false });
  const running = lastRun(log(['2026-11-03T02:00:01.000Z 每日更新开始', '2026-11-03T02:10:00.000Z 出榜 退出码 0']));
  assert.equal(running.running, true);
  assert.deepEqual(running.failed, []);
  // 北京时间 11/3 23:30 = UTC 11/3 15:30；11/4 00:30 = UTC 11/3 16:30。
  assert.deepEqual(nextRun(new Date('2026-11-03T15:30:00Z'), '11:15', { day: '2026-11-03' }), { at: '11:15', today: false });
  assert.deepEqual(nextRun(new Date('2026-11-03T16:30:00Z'), '11:15', { day: '2026-11-03' }), { at: '11:15', today: true });
  assert.deepEqual(nextRun(new Date('2026-11-03T01:00:00Z'), '10:00', null), { at: '10:00', today: true });
});

// 有状态的数据目录：涨星榜正常、历史榜失败，最新热点榜 HN 成功、V2EX 失败，一次每日更新的日志；另有所有者 boss。
function seeded() {
  const dir = fresh();
  put(dir, 'status.json', { boards: {
    d1: { day: '2026-11-02', at: '2026-11-03T02:10:00Z', status: 'published' },
    d30: { day: '2026-11-02', at: '2026-11-03T02:10:00Z', status: 'exists' },
    trending: { day: '2026-11-02', at: '2026-11-03T02:10:00Z', status: 'published' },
    skills: { day: '2026-11-03', at: '2026-11-03T02:12:00Z', status: 'failed', error: 'skills.sh 超时' },
  } });
  put(dir, 'snapshots/hot/2026-11-03.json', { board: 'hot', statDay: '2026-11-03', sources: { hn: { status: 'ok' }, v2ex: { status: 'failed', error: 'V2EX 403' } }, entries: [], posts: [] });
  put(dir, 'logs/update.log', '2026-11-03T02:00:01.000Z 每日更新开始\n2026-11-03T02:12:00.000Z 历史榜（Skill 安装量） 退出码 1\n2026-11-03T02:20:00.000Z 每日更新结束：失败 历史榜（Skill 安装量）\nexit 1\n');
  const accounts = openAccounts(dir);
  accounts.create({ name: 'boss', role: 'owner' });
  accounts.close();
  return dir;
}
async function asOwner(site, dir) {
  const res = await http(site.url + 'login', form({ name: 'boss', password: testAccount(dir, 'boss') }));
  return { ...site, cookie: res.headers['set-cookie'][0].split(';')[0] };
}
const post = (site, fields, headers = {}) => http(site.url + 'api/settings', form(fields, { cookie: site.cookie, ...headers })).then((r) => ({ ...r, json: JSON.parse(r.body || 'null') }));

test('设置页：导航第四项；数据里有各来源的日期和成败、上次更新的结果；伙伴只能看', async () => {
  const dir = seeded();
  const site = await serve(dir);
  try {
    const res = await site.get('settings');
    assert.equal(res.status, 200);
    assert.match(res.body, /<a href="\/favorites">收藏<\/a><a href="\/settings" aria-current="page">设置<\/a><\/nav>/);
    assert.match(res.body, /<title>设置 · Github·Tidings<\/title>/);
    const data = dataOf(res.body);
    assert.equal(data.canEdit, false);
    assert.deepEqual(data.settings, DEFAULTS);
    const st = Object.fromEntries(data.sources.map((s) => [s.key, s.status]));
    assert.deepEqual(st.gharchive, { state: 'ok', day: '2026-11-02' });
    assert.deepEqual(st.skills, { state: 'failed', day: '2026-11-03', error: 'skills.sh 超时' });
    assert.deepEqual(st.hn, { state: 'ok', day: '2026-11-03' });
    assert.deepEqual(st.v2ex, { state: 'failed', day: '2026-11-03', error: 'V2EX 403' });
    assert.equal(st.github, null);
    assert.deepEqual(data.sources.find((s) => s.key === 'gharchive').required, true);
    assert.deepEqual(data.sources.find((s) => s.key === 'reddit').unavailable, true);
    assert.deepEqual(data.run, { startedAt: '2026-11-03T02:00:01.000Z', endedAt: '2026-11-03T02:20:00.000Z', failed: ['历史榜（Skill 安装量）'], running: false });
    assert.equal(data.next.at, '10:00');
    assert.equal((await site.get('assets/settings.js')).status, 200);
    assert.equal((await site.get('assets/settings.css')).status, 200);
    const refused = await post(site, fieldsOf(DEFAULTS, { 'sources.hn': 'off' }));
    assert.equal(refused.status, 403);
    assert.match(refused.json.error, /只有所有者/);
    assert.equal(existsSync(join(dir, 'settings.json')), false);
  } finally {
    site.close();
  }
});

test('所有者改设置：存进 settings.json，页面读回；不合规整份不存；只收本站提交的 POST', async () => {
  const dir = seeded();
  const site = await asOwner(await serve(dir), dir);
  try {
    assert.equal(dataOf((await http(site.url + 'settings', { headers: { cookie: site.cookie } })).body).canEdit, true);
    const ok = await post(site, fieldsOf(DEFAULTS, { 'sources.v2ex': 'off', 'effort.picks': 'high', 'daily.at': '11:15' }));
    assert.equal(ok.status, 200);
    assert.equal(ok.json.settings.sources.v2ex, false);
    const file = JSON.parse(readFileSync(join(dir, 'settings.json'), 'utf8'));
    assert.equal(file.effort.picks, 'high');
    assert.equal(file.daily.at, '11:15');
    const page = dataOf((await http(site.url + 'settings', { headers: { cookie: site.cookie } })).body);
    assert.equal(page.settings.sources.v2ex, false);

    const before = readFileSync(join(dir, 'settings.json'), 'utf8');
    const bad = await post(site, fieldsOf(DEFAULTS, { 'sources.v2ex': 'on', 'daily.at': '08:30' }));
    assert.equal(bad.status, 400);
    assert.match(bad.json.error, /不能早于 09:00/);
    assert.equal(readFileSync(join(dir, 'settings.json'), 'utf8'), before);

    const cross = await post(site, fieldsOf(DEFAULTS), { origin: 'http://evil.example' });
    assert.equal(cross.status, 403);
    assert.equal((await http(site.url + 'api/settings', { headers: { cookie: site.cookie } })).status, 405);
    assert.equal(readFileSync(join(dir, 'settings.json'), 'utf8'), before);
  } finally {
    site.close();
  }
});
