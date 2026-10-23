// 按网址回放录制的上游数据，记录每次请求；遇到未录制的网址直接报错。
import { readFileSync, readdirSync, existsSync } from 'node:fs';
import { gzipSync } from 'node:zlib';

const dir = new URL('../fixtures/upstream/', import.meta.url);
const read = (name) => readFileSync(new URL(name, dir));
const idByName = new Map(
  readdirSync(new URL('repos/', dir)).map((f) => {
    const repo = JSON.parse(read(`repos/${f}`));
    return [repo.full_name.toLowerCase(), repo.id];
  }),
);

export function recordedUpstream({ missingArchiveHours = [], brokenArchiveHours = [], failing = [], notFound = [] } = {}) {
  const calls = [];
  const json = (name) => new Response(read(name), { headers: { 'content-type': 'application/json', date: 'Fri, 23 Oct 2026 08:33:34 GMT' } });
  async function fetch(input, init = {}) {
    const url = String(input);
    calls.push({ url, method: init.method ?? 'GET', body: init.body });
    if (failing.some((re) => re.test(url))) return new Response('Service Unavailable', { status: 503 });
    if (notFound.some((re) => re.test(url))) return new Response('{"message":"Not Found"}', { status: 404 });
    let m;
    if ((m = url.match(/^https:\/\/data\.gharchive\.org\/(\d{4}-\d{2}-\d{2})-(\d{1,2})\.json\.gz$/))) {
      const hour = Number(m[2]);
      if (missingArchiveHours.includes(hour)) return new Response('Not Found', { status: 404 });
      if (brokenArchiveHours.includes(hour)) {
        // 下载到一半连接断开（真实运行中见过 undici 的 BodyTimeoutError）。
        const head = gzipSync(Buffer.from('{"type":"WatchEvent","repo":{"id":1,"name":"a/b"}}\n'.repeat(200))).subarray(0, 40);
        return new Response(new ReadableStream({ start(c) { c.enqueue(head); c.error(new TypeError('terminated')); } }));
      }
      const name = `gharchive-${m[1]}-${String(hour).padStart(2, '0')}.ndjson`;
      return new Response(gzipSync(existsSync(new URL(name, dir)) ? read(name) : Buffer.alloc(0)));
    }
    if (url === 'https://github.com/trending?since=daily') return new Response(read('trending-daily.html'));
    if ((m = url.match(/^https:\/\/api\.github\.com\/repositories\/(\d+)(\/stargazers\/history\?per_page=6)?$/))) {
      return json(m[2] ? `history/${m[1]}.json` : `repos/${m[1]}.json`);
    }
    if ((m = url.match(/^https:\/\/api\.github\.com\/repos\/([^/]+\/[^/?]+)(\/stargazers\/history\?per_page=6)?$/))) {
      const id = idByName.get(m[1].toLowerCase());
      if (!id) return new Response('{"message":"Not Found"}', { status: 404 });
      return json(m[2] ? `history/${id}.json` : `repos/${id}.json`);
    }
    if (url.startsWith('https://play.clickhouse.com/')) {
      const hm = String(init.body).match(/'(\d{4}-\d{2}-\d{2}) (\d{2}):00:00'/);
      const name = hm && `clickhouse-${hm[1]}-${hm[2]}.jsonl`;
      return new Response(name && existsSync(new URL(name, dir)) ? read(name) : '');
    }
    throw new Error(`未录制的请求：${url}`);
  }
  return { fetch, calls };
}
