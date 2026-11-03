// 精选榜默认填法：npm run picks -- [--data data] [--limit 500]
// 候选池（历史榜前 100 和涨星榜三个窗口的已核数候选，按总 Star 取前 limit 个）里还没按当前标签清单建议过的项目，
// 用本机已登录的 Codex CLI 建议精选标签（不新增 API 费用），再按总 Star 重填每个标签没固定的卡。手动重跑是安全的。
// 先跑 npm run history 和出榜，候选池才有项目。有一批建议失败时退出码为 1（这些项目下次再建议）。
import { parseArgs } from 'node:util';
import { updatePicks, codexTagger } from '../src/boards/index.js';
import { POOL } from '../src/boards/picks-update.js';

const { values } = parseArgs({ options: { data: { type: 'string', default: 'data' }, limit: { type: 'string', default: String(POOL) } } });
const t0 = performance.now();
const r = await updatePicks({ dataDir: values.data, tagger: codexTagger(), limit: Number(values.limit) });

console.log(`候选池 ${r.pool} 个：要建议 ${r.todo} 个，建议了 ${r.suggested} 个，失败 ${r.failed} 个${r.errors.length ? `（${r.errors.length} 批，如 ${r.errors[0]}）` : ''}`);
for (const t of r.tags) console.log(`${t.name}：${t.cards} 张（手动 ${t.manual}）${t.repos.length ? ' ' + t.repos.join('、') : ''}`);
console.log(`耗时 ${((performance.now() - t0) / 1000).toFixed(1)} 秒`);
if (r.failed) process.exitCode = 1;
