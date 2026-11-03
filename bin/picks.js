// 精选榜默认填法：npm run picks -- [--data data] [--limit 500]
// 候选池（历史榜前 100 和涨星榜三个窗口的已核数候选，按总 Star 取前 limit 个）里还没按当前标签清单建议过的项目，
// 用本机已登录的 Codex CLI 建议精选标签（不新增 API 费用），再按总 Star 重填每个标签没固定的卡。手动重跑是安全的。
// 先跑 npm run history 和出榜，候选池才有项目。有一批建议失败时退出码为 1（这些项目下次再建议）。
// 放到服务器上后（#46，有 data/remote.json，见 src/remote）：先拉服务器的标签清单和固定的卡，算完把候选池写成 data/pick-pool.json，
// 随每日更新最后一步推上去。服务器上由 scripts/server.sh 调：--state 打印标签清单和固定的卡，--apply 把推上来的候选池写进库并补卡。
import { parseArgs } from 'node:util';
import { join } from 'node:path';
import { updatePicks, codexTagger, openPicks } from '../src/boards/index.js';
import { POOL } from '../src/boards/picks-update.js';
import { readSettings } from '../src/settings/index.js';
import { readJson } from '../src/ranking/store.js';
import { readRemote, pullPicks, writePool, POOL_FILE } from '../src/remote/index.js';

const { values } = parseArgs({ options: { data: { type: 'string', default: 'data' }, limit: { type: 'string', default: String(POOL) }, state: { type: 'boolean' }, apply: { type: 'boolean' } } });

if (values.state || values.apply) {
  const picks = openPicks(values.data);
  try {
    if (values.state) console.log(JSON.stringify(picks.state()));
    else {
      const rows = readJson(join(values.data, POOL_FILE)) ?? [];
      picks.importPool(rows);
      picks.refill();
      const board = picks.board(null);
      console.log(`候选池写入 ${rows.length} 个；${board.tags.map((t) => `${t.name} ${t.cards.length} 张`).join('，')}`);
    }
  } finally {
    picks.close();
  }
} else {
  const t0 = performance.now();
  const remote = readRemote(values.data);
  if (remote) {
    try {
      const got = pullPicks(values.data, remote);
      console.log(`拉到服务器的精选标签 ${got.tags} 个、固定的卡 ${got.pinned} 张`);
    } catch (e) {
      console.log(`拉服务器的精选标签失败，用本机这份：${e.message}`);
    }
  }
  const r = await updatePicks({ dataDir: values.data, tagger: codexTagger({ effort: readSettings(values.data).effort.picks }), limit: Number(values.limit) });

  console.log(`候选池 ${r.pool} 个：要建议 ${r.todo} 个，建议了 ${r.suggested} 个，失败 ${r.failed} 个${r.errors.length ? `（${r.errors.length} 批，如 ${r.errors[0]}）` : ''}`);
  for (const t of r.tags) console.log(`${t.name}：${t.cards} 张（手动 ${t.manual}）${t.repos.length ? ' ' + t.repos.join('、') : ''}`);
  if (remote) console.log(`候选池 ${writePool(values.data)} 个写进 data/${POOL_FILE}，等最后一步推到服务器`);
  console.log(`耗时 ${((performance.now() - t0) / 1000).toFixed(1)} 秒`);
  if (r.failed) process.exitCode = 1;
}
