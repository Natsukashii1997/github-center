// 接缝 2 的测试工具：起本机网站；serve() 另开一个测试账号并从登录页登录，之后的请求都带上会话 Cookie。
import { request } from 'node:http';
import { startServer } from '../../src/web/server.js';
import { openAccounts } from '../../src/web/accounts.js';

export function http(url, { method = 'GET', headers = {}, body } = {}) {
  return new Promise((resolve, reject) => {
    const req = request(url, { method, headers }, (res) => {
      let text = '';
      res.setEncoding('utf8');
      res.on('data', (c) => (text += c));
      res.on('end', () => resolve({ status: res.statusCode, headers: res.headers, body: text }));
    });
    req.on('error', reject);
    req.end(body);
  });
}

export const form = (fields, headers = {}) => ({ method: 'POST', headers: { 'content-type': 'application/x-www-form-urlencoded', ...headers }, body: new URLSearchParams(fields).toString() });

// 测试账号：没有就开一个伙伴账号，有就重置密码，拿到能登录的密码。
export function testAccount(dataDir, name = 'tester') {
  const accounts = openAccounts(dataDir);
  try {
    return accounts.list().some((a) => a.name === name) ? accounts.resetPassword(name) : accounts.create({ name, role: 'partner' });
  } finally {
    accounts.close();
  }
}

export async function serve(dataDir) {
  const { server, url } = await startServer({ dataDir, port: 0 });
  const login = await http(url + 'login', form({ name: 'tester', password: testAccount(dataDir) }));
  const cookie = login.headers['set-cookie'][0].split(';')[0];
  return { server, url, cookie, get: (path = '') => http(url + path, { headers: { cookie } }), close: () => server.close() };
}

// 登录后访问一个页面。
export async function visit(dataDir, path = '') {
  const site = await serve(dataDir);
  try {
    return await site.get(path);
  } finally {
    site.close();
  }
}

// #13、#14 起页面由页面脚本画出，数据整份嵌在页面里；测试检查嵌入的数据。
export const dataOf = (body) => JSON.parse(body.match(/<script type="application\/json" id="gc-data">([^<]*)<\/script>/)[1]);
