// 历史榜（Skill 安装量，所有者 2026-11-03 改定）：抓一次 skills.sh 首页，解析嵌在页面里的全时段排行榜，存当天快照；
// 失败保留上一次快照并写明失败的日期。网络全部模拟。
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, existsSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { updateSkills, readSkillsBoard, parseSkills, groupBySource } from '../src/boards/index.js';

// 页面里每个 Skill 是脚本中转义过引号的一段 JSON；同一个 Skill 可能出现不止一次。
const item = (n, source = `o${n}/r${n}`) => `{\\"source\\":\\"${source}\\",\\"skillId\\":\\"sk-${n}\\",\\"name\\":\\"sk-${n}\\",\\"installs\\":${1_000_000 - n * 100},\\"weeklyInstalls\\":[1,2],\\"isOfficial\\":false}`;
const page = (count = 120) => `<html><script>self.__next_f.push([1,"[${Array.from({ length: count }, (_, i) => item(i + 1, i === 4 ? 'open.feishu.cn' : undefined)).reverse().join(',')},${item(1)}]"])</script></html>`;
const fetchOf = (responses, urls = []) => async (url) => {
  urls.push(url);
  const r = responses.shift();
  if (r instanceof Error) throw r;
  return new Response(r.body, { status: r.status ?? 200, headers: { date: 'Tue, 03 Nov 2026 01:30:00 GMT' } });
};
const at = (iso) => () => new Date(iso);

test('解析：按安装量从高到低全部存下，去重；GitHub 来源带 repo，网址来源 repo 为 null；认出太少就报错', () => {
  const entries = parseSkills(page());
  assert.equal(entries.length, 120);
  assert.deepEqual(entries[0], { rank: 1, skill: 'sk-1', skillId: 'sk-1', source: 'o1/r1', repo: 'o1/r1', installs: 999_900, url: 'https://skills.sh/o1/r1/sk-1' });
  assert.deepEqual([entries[4].source, entries[4].repo, entries[4].url], ['open.feishu.cn', null, 'https://skills.sh/site/open.feishu.cn/sk-5']);
  assert.equal(new Set(entries.map((e) => e.skill)).size, 120);
  assert.throws(() => parseSkills(page(10)), /只认出 10 个 Skill/);
});

test('同一来源合成一行：名字和安装量取最高的那个，注明个数；几个时链到来源页，一个时链到 Skill 页', () => {
  const e = (skill, source, installs, repo = source) => ({ skill, source, repo, installs, url: `https://skills.sh/${repo ? '' : 'site/'}${source}/${skill}` });
  const g = groupBySource([e('lark-doc', 'open.feishu.cn', 900, null), e('grill-me', 'm/skills', 800), e('lark-im', 'open.feishu.cn', 850, null), e('solo', 'a/b', 700), e('tdd', 'M/Skills', 600)]);
  assert.deepEqual(g, [
    { rank: 1, skill: 'lark-doc', source: 'open.feishu.cn', repo: null, installs: 900, count: 2, url: 'https://skills.sh/site/open.feishu.cn' },
    { rank: 2, skill: 'grill-me', source: 'm/skills', repo: 'm/skills', installs: 800, count: 2, url: 'https://skills.sh/m/skills' },
    { rank: 3, skill: 'solo', source: 'a/b', repo: 'a/b', installs: 700, count: 1, url: 'https://skills.sh/a/b/solo' },
  ]);
});

test('每天一次：存当天快照和原始页面，网站读前 50；同一天重跑不再请求', async () => {
  const dataDir = mkdtempSync(join(tmpdir(), 'gc-skills-'));
  const urls = [];
  const r = await updateSkills({ dataDir, fetch: fetchOf([{ body: page() }], urls), now: at('2026-11-03T02:00:00Z') });
  assert.equal(r.status, 'published');
  assert.deepEqual(urls, ['https://www.skills.sh/']);
  assert.ok(existsSync(join(dataDir, 'snapshots/skills/2026-11-03.json')));
  assert.equal(readFileSync(join(dataDir, r.snapshot.evidence.path), 'utf8'), page());
  const b = readSkillsBoard(dataDir);
  assert.deepEqual([b.day, b.entries.length, b.entries[0].skill, b.failure], ['2026-11-03', 50, 'sk-1', null]);
  const again = await updateSkills({ dataDir, fetch: fetchOf([]), now: at('2026-11-03T09:00:00Z') });
  assert.deepEqual([again.status, again.requests], ['exists', 0]);
});

test('失败：保留上一次快照，网站写明哪天更新失败；页面结构变了也不发布', async () => {
  const dataDir = mkdtempSync(join(tmpdir(), 'gc-skills-'));
  assert.equal(readSkillsBoard(dataDir), null);
  await updateSkills({ dataDir, fetch: fetchOf([{ body: page() }]), now: at('2026-11-02T02:00:00Z') });
  const down = await updateSkills({ dataDir, fetch: fetchOf([{ status: 503, body: 'x' }]), now: at('2026-11-03T02:00:00Z') });
  assert.deepEqual([down.status, down.error], ['failed', 'skills.sh 返回 503']);
  let b = readSkillsBoard(dataDir);
  assert.deepEqual([b.day, b.entries.length, b.failure.day, b.failure.error], ['2026-11-02', 50, '2026-11-03', 'skills.sh 返回 503']);
  // 连不上：隔一会儿再试一次，第二次成功就照常发布
  const retried = await updateSkills({ dataDir: mkdtempSync(join(tmpdir(), 'gc-skills-')), fetch: fetchOf([new Error('socket hang up'), { body: page() }]), now: at('2026-11-03T02:00:00Z'), sleep: async () => {} });
  assert.deepEqual([retried.status, retried.requests], ['published', 2]);
  const odd = await updateSkills({ dataDir, fetch: fetchOf([{ body: '<html>改版了</html>' }]), now: at('2026-11-04T02:00:00Z') });
  assert.match(odd.error, /页面结构可能变了/);
  b = readSkillsBoard(dataDir);
  assert.deepEqual([b.day, b.failure.day], ['2026-11-02', '2026-11-04']);
});
