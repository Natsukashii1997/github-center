// B0-04 检索测试集（#77）：查 test/fixtures/search-cases.json 的格式和配比；能读到本机数据时，再核对每个引用还在收录范围里。
// 格式说明见 test/fixtures/search-cases.md。本机数据目录默认是 data/，可用 SEARCH_CASES_DATA 指定；没有就跳过核对（数据不进仓库）。
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync, existsSync } from 'node:fs';
import { join } from 'node:path';

const set = JSON.parse(readFileSync(new URL('./fixtures/search-cases.json', import.meta.url), 'utf8'));
const { cases } = set;
const LANGS = ['zh', 'en', 'mixed'];
const MIN_PER_LANG = 3; // B0-04 配比：三类语言各至少 3 条（和判定门槛 rules.minFoundPassPerLang 是两回事）
const REF = {
  project: /^[\w.-]+\/[\w.-]+$/,
  skill: /^[\w.-]+\/[\w.-]+#.+$/,
  'skills.sh': /^skills\.sh:.+\/[^/]+$/,
};
const refs = (c) => [...c.candidates, ...c.mustNotAppear];
const count = (list, f) => list.filter(f).length;

test('规则：前 10、有候选的通过率 ≥ 80%、三类语言各至少通过 3 条、不应出现进前 10 判失败', () => {
  assert.deepEqual(set.rules, { topN: 10, foundPass: 'anyCandidateInTopN', foundPassRate: 0.8, minFoundPassPerLang: 3, failIfMustNotAppearInTopN: true });
  assert.ok(set.version >= 1 && set.frozenAt && set.confirmedBy && set.dataAsOf);
});

test('条目：15–20 条，编号不重复，字段取值合法', () => {
  assert.ok(cases.length >= 15 && cases.length <= 20, `共 ${cases.length} 条`);
  assert.equal(new Set(cases.map((c) => c.id)).size, cases.length);
  for (const c of cases) {
    assert.match(c.id, c.expect === 'found' ? /^S\d{2}$/ : /^N\d{2}$/, c.id);
    assert.ok(c.query.trim(), c.id);
    assert.ok(LANGS.includes(c.lang), c.id);
    assert.ok(['describe', 'keyword'].includes(c.style), c.id);
    assert.ok(['project', 'skill'].includes(c.target), c.id);
    assert.ok(c.source.trim(), c.id);
    assert.ok(Array.isArray(c.candidates) && Array.isArray(c.mustNotAppear), c.id);
    if (c.expect === 'found') assert.ok(c.candidates.length > 0, `${c.id} 没有预期候选`);
    else assert.ok(c.candidates.length === 0 && c.mustNotAppear.length > 0, `${c.id} 库里没有的条目要写不应出现、不写候选`);
    for (const r of refs(c)) {
      assert.ok(REF[r.kind], `${c.id} ${r.ref} 的 kind「${r.kind}」不认识`);
      assert.match(r.ref, REF[r.kind], `${c.id} ${r.kind} ${r.ref}`);
      assert.ok(r.why?.trim(), `${c.id} ${r.ref} 没写理由`);
      if (r.kind === 'project') assert.ok(Number.isInteger(r.projectId), `${c.id} ${r.ref} 没有 projectId`);
    }
    const mine = refs(c).map((r) => r.ref);
    assert.equal(new Set(mine).size, mine.length, `${c.id} 引用重复`);
  }
});

test('配比：三类语言各至少 3 条（有候选的也各至少 3 条），描述式和关键词式、有和没有、项目和 Skill 都有', () => {
  const found = cases.filter((c) => c.expect === 'found');
  for (const l of LANGS) {
    assert.ok(count(cases, (c) => c.lang === l) >= MIN_PER_LANG, `${l} 不足 ${MIN_PER_LANG} 条`);
    assert.ok(count(found, (c) => c.lang === l) >= set.rules.minFoundPassPerLang, `${l} 有候选的不足 3 条，门槛无法达到`);
  }
  for (const [field, values] of [['style', ['describe', 'keyword']], ['expect', ['found', 'none']], ['target', ['project', 'skill']]]) {
    for (const v of values) assert.ok(cases.some((c) => c[field] === v), `缺少 ${field}=${v}`);
  }
});

// 本机收录范围：已分类项目、资料级项目、资料级 Skill（仓库#目录）、最近一天的 skills.sh 排行。
const dataDir = process.env.SEARCH_CASES_DATA ?? 'data';
const hasData = existsSync(join(dataDir, 'categories.json'));

function corpus() {
  const projects = new Map();
  const skills = new Set();
  for (const c of Object.values(JSON.parse(readFileSync(join(dataDir, 'categories.json'), 'utf8')).items)) projects.set(c.id, c.fullName);
  const profiles = join(dataDir, 'profiles');
  for (const f of existsSync(profiles) ? readdirSync(profiles).filter((f) => f.endsWith('.json')) : []) {
    const p = JSON.parse(readFileSync(join(profiles, f), 'utf8'));
    projects.set(p.projectId, p.fullName);
    for (const s of p.material?.skills ?? []) skills.add(`${p.fullName}#${s.path}`);
  }
  const snaps = join(dataDir, 'snapshots', 'skills');
  const latest = existsSync(snaps) ? readdirSync(snaps).filter((f) => f.endsWith('.json')).sort().at(-1) : null;
  for (const e of latest ? JSON.parse(readFileSync(join(snaps, latest), 'utf8')).entries : []) skills.add(`skills.sh:${e.source}/${e.skillId}`);
  return { projects, skills };
}

test('本机数据：每个引用都还在收录范围里（项目按 id 认，改名也算）', { skip: hasData ? false : `没有本机数据（${dataDir}/categories.json），跳过` }, () => {
  const { projects, skills } = corpus();
  const missing = [];
  for (const c of cases) {
    for (const r of refs(c)) {
      const ok = r.kind === 'project' ? projects.has(r.projectId) : skills.has(r.ref);
      if (!ok) missing.push(`${c.id} ${r.ref}`);
    }
  }
  assert.deepEqual(missing, [], '这些引用已不在本机收录范围里，找所有者重新确认这几条');
});
