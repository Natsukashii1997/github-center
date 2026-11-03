// 起本机网站：npm run serve -- [--data data] [--port 5310] [--host 0.0.0.0] [--guest <账号名>]
// 默认只监听 127.0.0.1、要登录；--host 0.0.0.0 让同一 Wi-Fi 的人用本机 IP 打开，--guest 免登录、所有人共用这个账号。
// 所有者换卡时联网查 GitHub 的 token 取环境变量 GITHUB_TOKEN，没有就用本机 gh 登录，都没有就匿名查（额度小）。
import { parseArgs } from 'node:util';
import { execFileSync } from 'node:child_process';
import { networkInterfaces } from 'node:os';
import { startServer } from '../src/web/server.js';
import { repoLookup } from '../src/web/repo-lookup.js';

const { values } = parseArgs({ options: { data: { type: 'string', default: 'data' }, port: { type: 'string', default: '5310' }, host: { type: 'string', default: '127.0.0.1' }, guest: { type: 'string' } } });
let token = process.env.GITHUB_TOKEN;
try {
  token ||= execFileSync('gh', ['auth', 'token'], { encoding: 'utf8' }).trim();
} catch {
  console.log('没有 GITHUB_TOKEN 也没有 gh 登录：换卡时联网查 GitHub 走匿名额度');
}
const lookupRepo = repoLookup({ fetch, token });
const { server, url } = await startServer({ dataDir: values.data, port: Number(values.port), host: values.host, guest: values.guest, lookupRepo });
console.log(`涨星榜：${url}`);
if (values.host !== '127.0.0.1') {
  const port = server.address().port;
  for (const a of Object.values(networkInterfaces()).flat()) if (a.family === 'IPv4' && !a.internal) console.log(`同一 Wi-Fi 打开：http://${a.address}:${port}/`);
}
if (values.guest) console.log(`免登录：所有人都当作账号 ${values.guest}`);
