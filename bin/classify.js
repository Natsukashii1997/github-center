// 项目归类：npm run classify -- [--data data]
// 给各榜单这一期涉及的项目归类（涨星榜是三个窗口全部已核数的候选），用本机已登录的 Codex CLI（不新增 API 费用）。
// 已归过的不重归；榜上项目有了项目页资料后再复核一次。每天出榜、补完资料后由定时任务接着跑，手动重跑是安全的。token 取法和出榜一样。
// 有一批归类失败时退出码为 1（这些项目网站上算“还没归类”，下次运行再归）。
import { execFileSync } from 'node:child_process';
import { parseArgs } from 'node:util';
import { githubClient } from '../src/ranking/github.js';
import { updateCategories, codexClassifier } from '../src/categories/index.js';
import { readSettings } from '../src/settings/index.js';

const { values } = parseArgs({ options: { data: { type: 'string', default: 'data' } } });
const t0 = performance.now();
const token = process.env.GITHUB_TOKEN || execFileSync('gh', ['auth', 'token'], { encoding: 'utf8' }).trim();
const r = await updateCategories({ dataDir: values.data, gh: githubClient({ fetch: globalThis.fetch, token }), classifier: codexClassifier({ effort: readSettings(values.data).effort.classify }) });

const line = (name, s) => `${name}：要归 ${s.todo} 个，归上 ${s.classified} 个，没归上 ${s.unclassified} 个，失败 ${s.failed} 个${s.errors.length ? `（${s.errors.length} 批，如 ${s.errors[0]}）` : ''}`;
console.log(`这一期涉及项目 ${r.targets} 个；补取其他榜单项目资料的 GraphQL 请求 ${r.requests.graphql} 次`);
console.log(line('批量归类（名称、描述、topics）', r.batch));
console.log(line('上榜项目复核（项目页资料）', r.review));
console.log(`耗时 ${((performance.now() - t0) / 1000).toFixed(1)} 秒`);
if (r.batch.failed || r.review.failed) process.exitCode = 1;
