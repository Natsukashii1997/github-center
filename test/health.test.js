// #48 健康检查：没问题不出声；每日更新太久没跑、卡住、有步骤失败，服务器连不上或网站没在跑，备份缺失或过旧，各说一句。
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { healthProblems, probeSite, remoteChecks } from '../src/remote/health.js';

const settings = { daily: { on: true, at: '10:00' } };
// 北京时间 2026-11-04 09:50（UTC 01:50），猛鬼兽工程自检的时间。
const now = new Date('2026-11-04T01:50:00Z');
const run = (startedAt, extra = {}) => ({ startedAt, failed: [], running: false, endedAt: startedAt, ...extra });
const ok = { run: run('2026-11-03T02:00:00Z'), settings, remote: true, server: 'active', backups: ['center-2026-11-03.db', 'center-2026-11-02.db'], now };

test('昨天跑过、服务器在跑、备份是昨天的：什么都不说', () => {
  assert.deepEqual(healthProblems(ok), []);
  // 没配服务器时只看每日更新。
  assert.deepEqual(healthProblems({ ...ok, remote: false, server: null, backups: [] }), []);
  // 每日更新关掉了就不催。
  assert.deepEqual(healthProblems({ ...ok, run: run('2026-10-20T02:00:00Z'), settings: { daily: { on: false, at: '10:00' } } }), []);
});

test('每日更新太久没跑：到了更新时间再过 2 小时才要求今天跑过', () => {
  const stale = healthProblems({ ...ok, run: run('2026-11-01T02:05:00Z') });
  assert.deepEqual(stale, ['每日更新 3 天没跑了（最后一次 2026-11-01 10:05）：Mac 可能一直关机或睡着，网站上的数据停在那天。']);
  const noon = new Date('2026-11-04T03:30:00Z'); // 北京时间 11:30，不到 12:00
  assert.deepEqual(healthProblems({ ...ok, now: noon }), []);
  const late = new Date('2026-11-04T04:10:00Z'); // 北京时间 12:10
  assert.match(healthProblems({ ...ok, now: late })[0], /每日更新 1 天没跑了/);
  assert.equal(healthProblems({ ...ok, run: null })[0], '每日更新还没跑过（data/logs/update.log 里没有记录）。');
});

test('卡住和步骤失败', () => {
  const stuck = healthProblems({ ...ok, run: run('2026-11-03T22:00:00Z', { running: true, endedAt: undefined }) });
  assert.deepEqual(stuck, ['每日更新从 2026-11-04 06:00 开始，3 小时了还没结束，可能卡住了。']);
  assert.deepEqual(healthProblems({ ...ok, run: run('2026-11-04T01:00:00Z', { running: true }) }), [], '刚开始跑不算卡住');
  const failed = healthProblems({ ...ok, run: run('2026-11-03T02:00:00Z', { failed: ['补资料', '推到服务器、备份库'] }) });
  assert.deepEqual(failed, ['最近一次每日更新（2026-11-03）有步骤失败：补资料、推到服务器、备份库。详情看 data/logs/update.log。']);
});

test('服务器和备份', () => {
  assert.deepEqual(healthProblems({ ...ok, server: new Error('Connection timed out') }), ['连不上服务器：Connection timed out']);
  assert.deepEqual(healthProblems({ ...ok, server: 'failed' }), ['服务器上的网站没在跑（systemctl 状态：failed）。']);
  assert.deepEqual(healthProblems({ ...ok, backups: [] }), ['还没有服务器库的备份（data/backups/ 是空的）。']);
  assert.deepEqual(healthProblems({ ...ok, backups: ['center-2026-11-02.db'] }), [], '前天的备份还行');
  assert.deepEqual(healthProblems({ ...ok, backups: ['center-2026-10-31.db'] }), ['服务器库的最新备份是 2026-10-31，已经 4 天没备份了。']);
});

test('榜单项目的简介重试后还没生成成功：报出个数和前 5 个名字（#52）', () => {
  assert.deepEqual(healthProblems({ ...ok, unfinished: ['acme/a', 'acme/b'] }),
    ['有 2 个榜单项目的简介没生成成功（重试过也没成），网站上先显示旧简介或 GitHub 描述：acme/a、acme/b。详情看 data/logs/update.log。']);
  const many = ['a/1', 'a/2', 'a/3', 'a/4', 'a/5', 'a/6'];
  assert.match(healthProblems({ ...ok, unfinished: many })[0], /^有 6 个榜单项目.*：a\/1、a\/2、a\/3、a\/4、a\/5 等。/);
});

// #105 域名探测：fetch 用替身，按网址回固定结果或抛和 Node 一样的错（TypeError: fetch failed，cause 带错误码）。
const reset = () => Object.assign(new TypeError('fetch failed'), { cause: { code: 'ECONNRESET' } });
function fakeFetch(replies) {
  const calls = [];
  const fetchImpl = async (u, opts) => {
    calls.push([String(u), opts.redirect]);
    const r = replies[String(u)];
    if (!r) throw reset();
    if (r instanceof Error) throw r;
    return new Response(r.body, { status: r.status });
  };
  return { fetchImpl, calls };
}
const LOGIN = '<!doctype html><title>登录 · Github·Tidings</title>';
const ICP = '<html><head><title>Non-compliance ICP Filing</title></head></html>';

test('域名探测：本站登录页算通；https 被重置、http 回阿里云拦截页认作未备案拦截（#105）', async () => {
  const good = fakeFetch({ 'https://t.example.cn/login': { status: 200, body: LOGIN } });
  assert.deepEqual(await probeSite('https://t.example.cn', good.fetchImpl), { host: 't.example.cn', ok: true });
  assert.deepEqual(good.calls, [['https://t.example.cn/login', 'follow']], '通了就不再试 http');

  const blocked = fakeFetch({ 'http://t.example.cn/login': { status: 403, body: ICP } });
  assert.deepEqual(await probeSite('https://t.example.cn/', blocked.fetchImpl), { host: 't.example.cn', blocked: true });
  assert.deepEqual(blocked.calls, [['https://t.example.cn/login', 'follow'], ['http://t.example.cn/login', 'manual']]);
  // https 自己回拦截页也认得。
  assert.deepEqual(await probeSite('https://t.example.cn', fakeFetch({ 'https://t.example.cn/login': { status: 403, body: ICP } }).fetchImpl), { host: 't.example.cn', blocked: true });
});

test('域名探测：其余情况报出状态码或连不上的原因', async () => {
  const down = fakeFetch({});
  assert.deepEqual(await probeSite('https://t.example.cn', down.fetchImpl), { host: 't.example.cn', error: 'https://t.example.cn/login 连不上（ECONNRESET）' });
  assert.equal(down.calls.length, 2, 'https 连不上再试 http');
  // http 回的不是拦截页（比如跳回 https）：照报 https 的原因。
  const redirect = fakeFetch({ 'http://t.example.cn/login': { status: 308, body: '' } });
  assert.match((await probeSite('https://t.example.cn', redirect.fetchImpl)).error, /连不上（ECONNRESET）/);
  assert.deepEqual(await probeSite('https://t.example.cn', fakeFetch({ 'https://t.example.cn/login': { status: 502, body: 'Bad Gateway' } }).fetchImpl),
    { host: 't.example.cn', error: 'https://t.example.cn/login 返回 502' });
  assert.deepEqual(await probeSite('https://t.example.cn', fakeFetch({ 'https://t.example.cn/login': { status: 200, body: '<title>别的站</title>' } }).fetchImpl),
    { host: 't.example.cn', error: 'https://t.example.cn/login 返回 200，但不是本站登录页' });
  const timeout = fakeFetch({ 'https://t.example.cn/login': Object.assign(new Error('timed out'), { name: 'TimeoutError' }) });
  assert.match((await probeSite('https://t.example.cn', timeout.fetchImpl)).error, /连不上（TimeoutError）/);
  assert.deepEqual(await probeSite('不是网址', down.fetchImpl), { host: '不是网址', error: 'data/remote.json 里的 url 不是网址' });
  // 只配 http 的不再降级重试。
  const plain = fakeFetch({});
  await probeSite('http://t.example.cn', plain.fetchImpl);
  assert.equal(plain.calls.length, 1);
});

test('域名、服务器代码版本各说一句；没查（不传）就不说（#105）', () => {
  const sha = 'abcdef0123456789abcdef0123456789abcdef01';
  const version = { commit: sha, at: '2026-11-20T15:50:00Z' };
  // 通、代码一致、没填 url（不传 site）都不出声。
  assert.deepEqual(healthProblems({ ...ok, site: { host: 't.cn', ok: true }, version, lag: { behind: 0, differs: false } }), []);
  assert.deepEqual(healthProblems({ ...ok, version, lag: { behind: 3, differs: false } }), [], '改了又改回去，代码一样就不报');
  assert.deepEqual(healthProblems({ ...ok, site: { host: 't.cn', blocked: true } }),
    ['域名 t.cn 打不开：被阿里云按未备案拦截（返回「Non-compliance ICP Filing」）。ICP 备案通过后这句自动不报。']);
  assert.deepEqual(healthProblems({ ...ok, site: { host: 't.cn', error: 'https://t.cn/login 返回 502' } }), ['域名 t.cn 打不开：https://t.cn/login 返回 502。']);
  assert.deepEqual(healthProblems({ ...ok, version, lag: { behind: 4, differs: true } }),
    ['服务器代码落后本机 main 4 个改了代码的提交（部署的是 abcdef0，2026-11-20 23:50 发的）：发布用 bash scripts/deploy-code.sh。']);
  assert.match(healthProblems({ ...ok, version, lag: { behind: 0, differs: true } })[0], /^服务器代码和本机 main 不一样（部署的是 abcdef0，2026-11-20 23:50 发的，有 main 里没有的代码改动/);
  assert.deepEqual(healthProblems({ ...ok, version: null }),
    ['服务器上没有代码版本记录（VERSION），对不上它跑的是哪个提交：重新发一次代码（bash scripts/deploy-code.sh）就有了。']);
  assert.deepEqual(healthProblems({ ...ok, version: new Error('服务器 version 失败（退出码 2）：用法') }),
    ['服务器上的代码早于这项检查（#105），读不到代码版本：重新发一次代码（bash scripts/deploy-code.sh）就好。']);
  assert.deepEqual(healthProblems({ ...ok, version: new Error('服务器 version 失败（退出码 255）：Connection reset') }),
    ['读不到服务器的代码版本：服务器 version 失败（退出码 255）：Connection reset'], 'ssh 偶然断了照实报，不叫人重发');
  assert.deepEqual(healthProblems({ ...ok, version, lag: new Error('本机找不到部署的提交 abcdef0（先 git fetch）') }),
    ['对不上服务器代码和本机 main：本机找不到部署的提交 abcdef0（先 git fetch）。']);
  // 没配服务器时这几项都不看。
  assert.deepEqual(healthProblems({ ...ok, remote: false, server: null, backups: [], site: { host: 't.cn', blocked: true }, version: null }), []);
});

test('配了服务器查哪几项：连不上不查版本，没版本记录不算落后，没填 url 不探测（#105）', async () => {
  const sha = 'abcdef0123456789abcdef0123456789abcdef01';
  const calls = [];
  const check = (over = {}) => ({
    status: () => (calls.push('status'), 'active'),
    version: () => (calls.push('version'), { commit: sha, at: '2026-11-20T15:50:00Z' }),
    lag: (c) => (calls.push(`lag ${c.slice(0, 7)}`), { behind: 0, differs: false }),
    probe: async (u) => (calls.push(`probe ${u}`), { host: 't.cn', ok: true }),
    ...over,
  });
  assert.deepEqual(await remoteChecks({ url: 'https://t.cn' }, check()), {
    server: 'active', version: { commit: sha, at: '2026-11-20T15:50:00Z' }, lag: { behind: 0, differs: false }, site: { host: 't.cn', ok: true },
  });
  assert.deepEqual(calls, ['status', 'version', 'lag abcdef0', 'probe https://t.cn']);

  calls.length = 0;
  const down = await remoteChecks({}, check({ status: () => { throw new Error('Connection timed out'); } }));
  assert.equal(down.server.message, 'Connection timed out');
  assert.deepEqual(calls, [], '连不上服务器：不查版本；没填 url：不探测');
  assert.deepEqual(healthProblems({ ...ok, ...down }), ['连不上服务器：Connection timed out'], '只报一句');

  calls.length = 0;
  const none = await remoteChecks({}, check({ version: () => null }));
  assert.deepEqual(calls, ['status']);
  assert.equal(none.version, null);
  assert.equal(none.lag, undefined);
  const broken = await remoteChecks({}, check({ version: () => { throw new Error('VERSION 内容不对'); }, lag: () => assert.fail('不该算落后') }));
  assert.equal(broken.version.message, 'VERSION 内容不对');
  const lagErr = await remoteChecks({}, check({ lag: () => { throw new Error('本机找不到部署的提交'); } }));
  assert.equal(lagErr.lag.message, '本机找不到部署的提交');
});
