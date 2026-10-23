// #5：登录与账号。接缝 2 的 HTTP 测试覆盖未登录被拒、登录成功、退出；另测账号库和开账号命令。
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { execFileSync, spawn } from 'node:child_process';
import { once } from 'node:events';
import { request } from 'node:http';
import { connect } from 'node:net';
import { startServer } from '../src/web/server.js';
import { openAccounts, SESSION_DAYS } from '../src/web/accounts.js';
import { http, form, testAccount } from './helpers/web.js';

const fresh = () => mkdtempSync(join(tmpdir(), 'gc-auth-'));
async function site(dataDir = fresh()) {
  const { server, url } = await startServer({ dataDir, port: 0 });
  return { dataDir, url, close: () => server.close() };
}
// 不经 Node 客户端校验，直接往端口写一行原始请求。
const raw = (url, line) => new Promise((resolve, reject) => {
  let data = '';
  const socket = connect(new URL(url).port, '127.0.0.1');
  socket.on('data', (c) => (data += c)).on('end', () => resolve(data)).on('error', reject);
  socket.write(`${line}\r\nHost: 127.0.0.1\r\nConnection: close\r\n\r\n`);
});

test('未登录访问任何页面都被引导去登录（记下原来要去的地方），访问接口直接拒绝', async () => {
  const s = await site();
  try {
    for (const path of ['', 'new', 'trending?since=weekly', 'top', '?w=d7', 'no-such-page']) {
      const r = await http(s.url + path);
      assert.equal(r.status, 303, path);
      assert.equal(r.headers.location, `/login?next=${encodeURIComponent('/' + path)}`);
      assert.doesNotMatch(r.body, /涨星榜|<table/);
    }
    const api = await http(s.url + 'api/favorites');
    assert.equal(api.status, 401);
    assert.deepEqual(JSON.parse(api.body), { error: '未登录' });
    const login = await http(s.url + 'login');
    assert.equal(login.status, 200);
    assert.match(login.body, /<input name="password" type="password"/);
    assert.match(login.body, /不开放注册/);
    // 拿不出有效会话令牌也不行。
    assert.equal((await http(s.url, { headers: { cookie: 'gc_session=forged' } })).status, 303);
  } finally {
    s.close();
  }
});

test('登录成功：发会话 Cookie（HttpOnly），跳回原来要去的页面，之后能看页面、显示账号；密码不对就拒绝', async () => {
  const s = await site();
  try {
    const password = testAccount(s.dataDir);
    const bad = await http(s.url + 'login', form({ name: 'tester', password: 'wrong', next: '/top' }));
    assert.equal(bad.status, 401);
    assert.match(bad.body, /账号或密码不对/);
    assert.equal(bad.headers['set-cookie'], undefined);
    assert.equal((await http(s.url + 'login', form({ name: 'nobody', password }))).status, 401);

    const ok = await http(s.url + 'login', form({ name: 'tester', password, next: '/top' }));
    assert.equal(ok.status, 303);
    assert.equal(ok.headers.location, '/top');
    const cookie = ok.headers['set-cookie'][0];
    assert.match(cookie, /^gc_session=[\w-]{40,}; HttpOnly; SameSite=Lax; Path=\/; Max-Age=2592000$/);
    const page = await http(s.url + 'top', { headers: { cookie: cookie.split(';')[0] } });
    assert.equal(page.status, 200);
    assert.match(page.body, /tester（伙伴）/);
    assert.match(page.body, /<form method="post" action="\/logout"><button>退出<\/button><\/form>/);
    // 已登录再打开登录页直接回首页。
    assert.equal((await http(s.url + 'login', { headers: { cookie: cookie.split(';')[0] } })).headers.location, '/');
  } finally {
    s.close();
  }
});

test('退出：会话作废、Cookie 清掉，原来的 Cookie 再用也进不去', async () => {
  const s = await site();
  try {
    const login = await http(s.url + 'login', form({ name: 'tester', password: testAccount(s.dataDir) }));
    const cookie = login.headers['set-cookie'][0].split(';')[0];
    const out = await http(s.url + 'logout', form({}, { cookie }));
    assert.equal(out.status, 303);
    assert.equal(out.headers.location, '/login');
    assert.match(out.headers['set-cookie'][0], /^gc_session=; .*Max-Age=0$/);
    assert.equal((await http(s.url, { headers: { cookie } })).status, 303);
  } finally {
    s.close();
  }
});

test('登录后只跳回本站路径；别的网站提交来的登录、退出表单一律拒绝', async () => {
  const s = await site();
  try {
    const password = testAccount(s.dataDir);
    // 浏览器会去掉网址里的 Tab 和换行、把反斜杠当斜杠，这些写法都不能借道跳出去。
    for (const next of ['https://evil.example/', '//evil.example/', '/\\evil.example', '/\t/evil.example', '/\n/evil.example', ' /x', 'top']) {
      assert.equal((await http(s.url + 'login', form({ name: 'tester', password, next }))).headers.location, '/', JSON.stringify(next));
    }
    // 站内路径照常跳回；跳转地址一律编码成安全字符，带汉字或换行也不会让服务出错。
    assert.equal((await http(s.url + 'login', form({ name: 'tester', password, next: '/中文?q=星' }))).headers.location, '/%E4%B8%AD%E6%96%87?q=%E6%98%9F');
    assert.equal((await http(s.url + 'login', form({ name: 'tester', password, next: '/a\nb' }))).headers.location, '/ab');
    const page = await http(s.url + 'login?next=' + encodeURIComponent('/中文\r\nx'));
    assert.equal(page.status, 200);
    assert.match(page.body, /name="next" value="\/%E4%B8%AD%E6%96%87x"/);
    const cross = await http(s.url + 'login', form({ name: 'tester', password }, { origin: 'https://evil.example' }));
    assert.equal(cross.status, 403);
    assert.equal(cross.headers['set-cookie'], undefined);
    assert.equal((await http(s.url + 'logout', form({}, { origin: 'https://evil.example' }))).status, 403);
    assert.equal((await http(s.url + 'login', form({ name: 'tester', password }, { origin: s.url.slice(0, -1) }))).status, 303);
  } finally {
    s.close();
  }
});

test('表单超过 10KB（按字节算）立即回 413 并断开，不再接着收；请求出错回 500，服务不退出', async () => {
  const s = await site();
  try {
    const password = testAccount(s.dataDir);
    // 直接发未编码的汉字：3,334 个汉字不到 1 万个字符，但有 1 万多字节。
    const big = await http(s.url + 'login', { ...form({}), body: `name=tester&next=/${'星'.repeat(3334)}` });
    assert.equal(big.status, 413);
    assert.equal(big.headers.connection, 'close');
    // 不停地发的请求体：服务端收够 10KB 就不再收并断开连接，不会一直收下去（以前会一直收，这里就会卡到超时）。
    // 断开时这边可能先收到 413，也可能直接被断开，两种都算对。
    await new Promise((resolve) => {
      const req = request(s.url + 'login', { method: 'POST', headers: { 'content-type': 'application/x-www-form-urlencoded' } }, (res) => res.resume());
      req.on('error', () => {});
      req.on('close', resolve);
      const chunk = 'x'.repeat(64 * 1024);
      const pump = () => {
        while (!req.destroyed && req.write(chunk));
        if (!req.destroyed) req.once('drain', pump);
      };
      pump();
    });
    // 解析不了的请求地址（以前会让进程直接退出）现在只回 500。
    const bad = await raw(s.url, 'GET //[ HTTP/1.1');
    assert.match(bad, /^HTTP\/1\.1 500 /);
    assert.equal((await http(s.url + 'login')).status, 200);
  } finally {
    s.close();
  }
});

test('账号库：密码只存哈希；重置密码后旧密码失效、已登录的地方全部退出；会话 30 天后失效', () => {
  const dataDir = fresh();
  const accounts = openAccounts(dataDir);
  try {
    const first = accounts.create({ name: '常浩', role: 'owner' });
    assert.match(first, /^[\w-]{16}$/);
    assert.throws(() => accounts.create({ name: '另一个', role: 'owner' }), /已经有所有者账号 常浩/);
    assert.throws(() => accounts.create({ name: '常浩', role: 'partner' }), /已经有账号 常浩/);
    assert.throws(() => accounts.create({ name: 'a b', role: 'partner' }), /账号名只能用/);
    accounts.create({ name: '伙伴A', role: 'partner' });
    assert.deepEqual(accounts.list().map((a) => [a.name, a.role]), [['常浩', 'owner'], ['伙伴A', 'partner']]);
    assert.ok(!readFileSync(join(dataDir, 'center.db')).includes(first), '库里不应有明文密码');

    const now = Date.parse('2026-10-24T00:00:00Z');
    const token = accounts.login('常浩', first, now);
    assert.deepEqual({ ...accounts.session(token, now) }, { name: '常浩', role: 'owner' });
    assert.equal(accounts.session(token, now + SESSION_DAYS * 86400e3), null);

    const live = accounts.login('常浩', first);
    const second = accounts.resetPassword('常浩');
    assert.notEqual(second, first);
    assert.equal(accounts.session(live), null);
    assert.equal(accounts.login('常浩', first), null);
    assert.ok(accounts.login('常浩', second));
    assert.throws(() => accounts.resetPassword('没有这个人'), /没有账号/);
  } finally {
    accounts.close();
  }
});

test('命令行开号的同时网站在用：账号库被另一个进程占着时等它写完，不报错', async () => {
  const dataDir = fresh();
  const accounts = openAccounts(dataDir);
  try {
    // 另一个进程（相当于命令行开号）拿着写锁 0.5 秒。
    const holder = spawn(process.execPath, ['-e', `
      const { DatabaseSync } = require('node:sqlite');
      const db = new DatabaseSync(process.argv[1]);
      db.exec('BEGIN IMMEDIATE');
      db.exec("INSERT INTO accounts(name, role, salt, hash, created_at) VALUES ('占用', 'partner', 'x', 'x', 'x')");
      console.log('locked');
      Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 500);
      db.exec('COMMIT');
    `, join(dataDir, 'center.db')]);
    await once(holder.stdout, 'data');
    assert.equal(accounts.session('anything'), null);
    const [code] = await once(holder, 'exit');
    assert.equal(code, 0);
  } finally {
    accounts.close();
  }
});

test('本机命令：开所有者和伙伴账号、重置密码、列出账号；密码只在开通和重置时显示一次', () => {
  const dataDir = fresh();
  const run = (...args) => execFileSync(process.execPath, ['bin/account.js', ...args, '--data', dataDir], { encoding: 'utf8', cwd: new URL('..', import.meta.url) });
  const owner = run('add', '常浩');
  assert.match(owner, /已开通所有者账号 常浩\n初始密码：[\w-]{16}\n密码只显示这一次/);
  assert.match(run('add', '伙伴A', '--partner'), /已开通伙伴账号 伙伴A/);
  const reset = run('reset', '伙伴A');
  assert.match(reset, /新密码：[\w-]{16}/);
  const list = run('list');
  assert.match(list, /常浩\t所有者/);
  assert.match(list, /伙伴A\t伙伴/);
  assert.doesNotMatch(list, /密码/);
  const accounts = openAccounts(dataDir);
  try {
    assert.ok(accounts.login('伙伴A', reset.match(/新密码：([\w-]{16})/)[1]));
    assert.ok(accounts.login('常浩', owner.match(/初始密码：([\w-]{16})/)[1]));
  } finally {
    accounts.close();
  }
});
