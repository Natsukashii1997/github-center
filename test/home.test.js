// 接缝 2：本机网站首页。首页只读快照，访问时不调用外部接口。
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, copyFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { get } from 'node:http';
import { startServer } from '../src/web/server.js';

const fixture = new URL('./fixtures/snapshot-d1-2026-10-22.json', import.meta.url);
function dataDirWithSnapshot() {
  const dir = mkdtempSync(join(tmpdir(), 'gc-web-'));
  mkdirSync(join(dir, 'snapshots', 'd1'), { recursive: true });
  copyFileSync(fixture, join(dir, 'snapshots', 'd1', '2026-10-22.json'));
  return dir;
}
const page = (url) => new Promise((resolve, reject) => {
  get(url, (res) => { let body = ''; res.setEncoding('utf8'); res.on('data', (c) => (body += c)); res.on('end', () => resolve({ status: res.statusCode, body })); }).on('error', reject);
});

test('首页显示近 1 天榜单：名次、项目、当天新增、当前总 Star、统计日期、更新时间', async () => {
  const { server, url } = await startServer({ dataDir: dataDirWithSnapshot(), port: 0 });
  try {
    const { status, body } = await page(url);
    assert.equal(status, 200);
    assert.match(body, /统计日 2026-10-22（UTC）/);
    assert.match(body, /更新于 2026-10-23 16:40（北京时间）/);
    const rows = [...body.matchAll(/<tr><td>(\d+)<\/td><td><a href="https:\/\/github\.com\/([^"]+)">[^<]+<\/a><\/td><td>\+([\d,]+)<\/td><td>([\d,]+)<\/td><\/tr>/g)].map((m) => m.slice(1));
    assert.deepEqual(rows, [
      ['1', 'php/php-src', '5,200', '193,409'],
      ['2', 'anthropics/knowledge-work-plugins', '3,100', '115,709'],
      ['3', 'DietrichGebert/ponytail', '2,400', '89,809'],
      ['4', 'cloudflare/security-audit-skill', '1,800', '67,609'],
      ['5', 'Graphify-Labs/graphify', '1,500', '56,509'],
      ['5', 'nicholasx417/WinNative-Components', '1,500', '56,509'],
      ['7', 'GabrielTaiga/Taiga-Launcher-for-Steam', '1,200', '45,409'],
    ]);
  } finally {
    server.close();
  }
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
  const { server, url } = await startServer({ dataDir: dataDirWithSnapshot(), port: 0 });
  try {
    const { status } = await page(url);
    assert.equal(status, 200);
    assert.equal(outbound.mock.callCount(), 0);
  } finally {
    server.close();
  }
});

test('还没有任何快照时，首页如实说明', async () => {
  const { server, url } = await startServer({ dataDir: mkdtempSync(join(tmpdir(), 'gc-web-')), port: 0 });
  try {
    const { status, body } = await page(url);
    assert.equal(status, 200);
    assert.match(body, /还没有榜单/);
  } finally {
    server.close();
  }
});
