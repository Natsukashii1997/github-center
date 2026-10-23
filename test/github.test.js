// 官方接口客户端：限流时等额度重置、临时故障重试、额度紧时让出给 Codex 的严格实验。
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { githubClient, RESERVE } from '../src/ranking/github.js';

// 按顺序返回给定的响应，记下每次请求发生时的（假）时间。
function scripted(responses) {
  let clock = 1_000_000;
  const at = [];
  const fetch = async () => {
    at.push(clock);
    const r = responses.shift();
    if (r instanceof Error) throw r;
    return new Response(r.body ?? '[]', { status: r.status ?? 200, headers: r.headers ?? {} });
  };
  const sleep = async (ms) => { clock += ms; };
  return { fetch, sleep, now: () => clock, at };
}
const repo = { id: 1, name: 'a/b' };

test('剩余额度低于预留线时，下一次请求等到额度重置之后', async () => {
  const s = scripted([
    { headers: { 'x-ratelimit-remaining': String(RESERVE - 1), 'x-ratelimit-reset': '2000' } },
    {},
  ]);
  const gh = githubClient({ fetch: s.fetch, token: 't', sleep: s.sleep, now: s.now });
  await gh.history(repo);
  await gh.history(repo);
  assert.equal(s.at[0], 1_000_000);
  assert.ok(s.at[1] >= 2_000_000);
});

test('额度用完（403）时等到重置再试，成功就返回', async () => {
  const s = scripted([
    { status: 403, headers: { 'x-ratelimit-remaining': '0', 'x-ratelimit-reset': '1500' }, body: 'rate limited' },
    { body: '[{"week":1}]' },
  ]);
  const gh = githubClient({ fetch: s.fetch, token: 't', sleep: s.sleep, now: s.now });
  const res = await gh.history(repo);
  assert.equal(res.body, '[{"week":1}]');
  assert.ok(s.at[1] >= 1_500_000);
  assert.equal(gh.stats.history, 2);
});

test('次级限流（429 带 retry-after）按它说的秒数等', async () => {
  const s = scripted([{ status: 429, headers: { 'retry-after': '30' } }, {}]);
  const gh = githubClient({ fetch: s.fetch, token: 't', sleep: s.sleep, now: s.now });
  await gh.project(repo);
  assert.equal(s.at[1] - s.at[0], 30_000);
});

test('服务端临时故障和网络断开会重试，3 次都失败才报错', async () => {
  const ok = scripted([{ status: 502 }, new TypeError('fetch failed'), { body: '{"id":1}' }]);
  const gh = githubClient({ fetch: ok.fetch, token: 't', sleep: ok.sleep, now: ok.now });
  assert.equal((await gh.project(repo)).body, '{"id":1}');
  assert.equal(gh.stats.project, 3);

  const bad = scripted([{ status: 503 }, { status: 503 }, { status: 503 }]);
  const gh2 = githubClient({ fetch: bad.fetch, token: 't', sleep: bad.sleep, now: bad.now });
  await assert.rejects(gh2.history(repo), /返回 503/);
  assert.equal(gh2.stats.history, 3);
});

test('404 返回空，不重试；其他错误（如 401）不重试直接报错', async () => {
  const s = scripted([{ status: 404 }, { status: 401, body: 'Bad credentials' }]);
  const gh = githubClient({ fetch: s.fetch, token: 't', sleep: s.sleep, now: s.now });
  assert.equal(await gh.history(repo), null);
  await assert.rejects(gh.history(repo), /返回 401：Bad credentials/);
  assert.equal(s.at.length, 2);
});
