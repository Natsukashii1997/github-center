// 更新热点榜：npm run hot -- [--data data]
// 从 Hacker News（Algolia 公开搜索接口，7 次请求）和 V2EX（公开接口，7 次请求）找近 7 天指向 GitHub 仓库的帖子，
// 热度 = 点赞数 + 评论数，存成当天（UTC）的快照；再用一次 GitHub GraphQL 核热度最高的 40 个仓库。当天已存过就不再请求。
// token 取法和出榜一样。两个来源都失败时保留上一次快照、记进 status.json，退出码为 1；只有一个来源失败时照常发布并写明。
import { execFileSync } from 'node:child_process';
import { parseArgs } from 'node:util';
import { githubClient } from '../src/ranking/github.js';
import { updateHot, readHotBoard, jsonGetter, HOT_SOURCES } from '../src/boards/index.js';
import { readSettings } from '../src/settings/index.js';

const { values } = parseArgs({ options: { data: { type: 'string', default: 'data' } } });
const t0 = performance.now();
const token = process.env.GITHUB_TOKEN || execFileSync('gh', ['auth', 'token'], { encoding: 'utf8' }).trim();
const gh = githubClient({ fetch: globalThis.fetch, token });
const http = jsonGetter();
// 设置页关掉的来源不抓，沿用上一次的帖子。
const r = await updateHot({ dataDir: values.data, gh, get: http.get, enabled: readSettings(values.data).sources });

if (r.status === 'exists') console.log(`今天的热点榜快照已存在，没有重跑：${r.path}`);
else if (r.status === 'failed') console.log(`热点榜更新失败（保留上一次快照）：${r.error}`);
else {
  const s = r.snapshot;
  console.log(`已发布 ${r.path}（窗口 ${s.window.from} 至 ${s.window.to}）`);
  for (const [k, x] of Object.entries(s.sources)) {
    console.log(`${HOT_SOURCES[k].name}：${x.status === 'ok' ? `本次抓到链到仓库的帖子 ${x.fetched} 个` : x.status === 'off' ? '设置页里关掉了，沿用上一次的帖子' : `失败（${x.error}），沿用上一次的帖子`}，计入 ${x.posts} 个${x.truncated ? `；有 ${x.truncated} 条超出单次上限没取到` : ''}${x.errors?.length ? `；${x.errors.length} 个列表失败：${x.errors[0]}` : ''}`);
  }
  console.log(`仓库 ${s.entries.length} 个上榜（核了 ${s.resolve.requested} 个，查到 ${s.resolve.found} 个${s.resolve.failed ? '；GraphQL 失败，未核' : ''}）`);
  const b = readHotBoard(values.data);
  console.log(`走势已记 ${b.days} 天${b.complete ? '' : '（不满 7 天）'}`);
  for (const e of b.entries) console.log(`${String(e.rank).padStart(2)}  ${String(e.heat).padEnd(6)} ${e.repo}  (${Object.entries(e.sources).filter(([, v]) => v).map(([k, v]) => `${k} ${v}`).join('，')})`);
}
console.log(`公开接口请求 ${http.stats.requests} 次，GitHub GraphQL ${gh.stats.graphql} 次；耗时 ${((performance.now() - t0) / 1000).toFixed(1)} 秒`);
if (r.status === 'failed') process.exitCode = 1;
