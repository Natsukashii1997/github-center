// 更新项目资料：npm run profiles -- [--data data]
// 给网站上各榜单当前显示的项目读 README、仓库目录和 Skill，用本机已登录的 Codex CLI或 Claude（设置页「AI 接入」选，见 src/agent.js；选定的执行方用不了就报错退出，不换另一家） 生成简介和使用条件（不新增 API 费用）。
// 项目没有新提交、资料没变的不重复生成；每天出完榜后由定时任务接着跑，手动重跑是安全的。token 取法和出榜一样。
// 有项目生成失败或资料读不全时退出码为 1（网站对这些项目显示“简介生成中”或保留上一次的简介）。
import { execFileSync } from 'node:child_process';
import { parseArgs } from 'node:util';
import { updateProfiles, aiGenerator } from '../src/profiles/index.js';
import { readSettings } from '../src/settings/index.js';
import { useAgent, recordCalls } from '../src/ai-access.js';

const { values } = parseArgs({ options: { data: { type: 'string', default: 'data' } } });
const t0 = performance.now();
const token = process.env.GITHUB_TOKEN || execFileSync('gh', ['auth', 'token'], { encoding: 'utf8' }).trim();
const settings = readSettings(values.data);
const generator = aiGenerator({ ...(await useAgent(values.data, settings, 'profiles')), effort: settings.effort.profiles });
const r = await updateProfiles({ dataDir: values.data, token, generator });

const NAMES = { generated: '新生成', reused: '资料重读后没变、沿用', unchanged: '没有新提交、沿用', failed: '生成失败', error: '资料读不全', missing: '官方接口查不到' };
const count = (s) => r.results.filter((x) => x.status === s).length;
console.log(`项目 ${r.results.length} 个：${Object.entries(NAMES).map(([s, n]) => `${n} ${count(s)}`).join('，')}${r.rounds ? `（失败的当轮重试了 ${r.rounds} 轮）` : ''}`);
for (const x of r.results.filter((x) => x.error)) console.log(`  ${x.name}：${NAMES[x.status]}，${x.error}`);
const q = r.requests;
console.log(`官方接口请求 ${q.project + q.readme + q.tree + q.releases} 次（项目信息 ${q.project}，README ${q.readme}，仓库目录 ${q.tree}，最新正式版 ${q.releases}）；耗时 ${((performance.now() - t0) / 1000).toFixed(1)} 秒`);
recordCalls(values.data, 'profiles', generator.stats);
if (generator.stats.relayed) console.log(`Codex 失败或额度用完，Claude 接力了 ${generator.stats.relayed} 次`);
if (count('failed') || count('error')) process.exitCode = 1;
