// 与严格方案逐日校准（#4）：拿 Codex 严格实验某个统计日的完整日榜，和快速方法同一天的近 1 天前 20（含并列）对照名单和数字。
// 严格实验目录只读：只用 readFileSync 读它的结果文件，不写入、不加锁、不启动任何进程。
import { readFileSync, readdirSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { readEvents } from './store.js';

// 严格实验每个任务完成后写 results/<任务>/result.json，统计日在 statistical_day_label，日榜在 top20_plus_ties（id、repo、value、checked）。
function strictResults(strictDir) {
  const dir = join(strictDir, 'results');
  if (!existsSync(dir)) return [];
  return readdirSync(dir)
    .map((job) => join(dir, job, 'result.json'))
    .filter((path) => existsSync(path))
    .map((path) => ({ path, result: JSON.parse(readFileSync(path, 'utf8')) }));
}

export const strictDays = (strictDir) => [...new Set(strictResults(strictDir).map((r) => r.result.statistical_day_label))].sort();

// 同一统计日有几份结果时取最后完成的那份。
export function readStrictResult(strictDir, day) {
  const found = strictResults(strictDir).filter((r) => r.result.statistical_day_label === day);
  return found.sort((a, b) => (a.result.finished_at < b.result.finished_at ? 1 : -1))[0] ?? null;
}

// 对照：名单按项目 id 比（两边都是 GitHub 仓库 id，不受改名影响），数字比两边都有的项目。名单和数字都一致才算过关。
export function compare({ fast, strict }) {
  const strictRows = new Map(strict.top20_plus_ties.map((r) => [r.id, { fullName: r.repo, gain: r.value, at: new Date(r.checked * 1000).toISOString() }]));
  const fastRows = new Map(fast.entries.map((e) => [e.projectId, { fullName: e.fullName, gain: e.gain, at: new Date(e.evidence.history.date).toISOString() }]));
  const missing = [...strictRows].filter(([id]) => !fastRows.has(id)).map(([id, r]) => ({ id, fullName: r.fullName, gain: r.gain }));
  const extra = [...fastRows].filter(([id]) => !strictRows.has(id)).map(([id, r]) => ({ id, fullName: r.fullName, gain: r.gain }));
  const numbers = [...fastRows].filter(([id, r]) => strictRows.has(id) && strictRows.get(id).gain !== r.gain)
    .map(([id, r]) => ({ id, fullName: r.fullName, fast: r.gain, strict: strictRows.get(id).gain, fastAt: r.at, strictAt: strictRows.get(id).at }));
  const verdict = missing.length || extra.length ? '名单不同' : numbers.length ? '数字不同' : '一致';
  return { statDay: fast.statDay, verdict, missing, extra, numbers, fastCutoff: fast.entries.at(-1).gain, strictCutoff: strict.top20_plus_ties.at(-1).value };
}

// 排查线索：漏掉的项目在当天事件数据里记了几次，按当天的候选门槛判断有没有进候选，核数失败的单独标出。
// 事件数据里只有名字的行（ClickHouse 补的）按名字对，项目改过名会对不上、记成 0。
export function clues({ diff, fast, dataDir }) {
  const rows = readEvents(dataDir, fast.statDay)?.rows;
  const failed = new Set(fast.candidates.failed?.map((f) => f.name.toLowerCase()));
  const recordsOf = (r) => (rows.find((x) => x.id === r.id) ?? rows.find((x) => x.name.toLowerCase() === r.fullName.toLowerCase()))?.events ?? 0;
  // 自检上线（#3）之前的快照没有门槛，只跑过近 1 天、每个候选都按 id 存了官方星数历史，就看有没有存。
  const enteredOld = (r) => existsSync(join(dataDir, 'runs', fast.runId, 'raw', 'history', `${r.id}.json`));
  return diff.missing.map((r) => {
    const records = rows ? recordsOf(r) : null;
    const candidate = failed.has(r.fullName.toLowerCase()) ? '核数失败' : (fast.check ? records !== null && records >= fast.check.threshold : enteredOld(r)) ? '是' : '否';
    return { ...r, records, candidate };
  });
}

const num = (n) => n.toLocaleString('en-US');
const CANDIDATE = { 是: '是（核数后没排进前 20，查核数）', 否: '否（查事件漏记和候选门槛；当天在官方热门日榜上的也会进候选）', 核数失败: '进了，但官方核数失败' };

// missingWithClues：clues() 的结果。
export function report({ diff, fast, strictPath, missingWithClues }) {
  const lines = [
    `# 校准报告：统计日 ${diff.statDay}（近 1 天）`,
    '',
    `结论：**${diff.verdict}**${diff.verdict === '一致' ? '，名单和数字都与严格方案相同。' : '。不一致视为缺陷，需要排查。'}`,
    '',
    `- 快速方法：快照生成于 ${fast.generatedAt}，上榜 ${fast.entries.length} 个，第 20 名（含并列）新增 ${num(diff.fastCutoff)}${fast.check ? `；当天自检${fast.check.passed ? '通过' : '未通过'}，候选门槛 ${fast.check.threshold} 次事件记录` : '；生成于自检上线之前'}。`,
    `- 严格方案：${strictPath}（只读），第 20 名（含并列）新增 ${num(diff.strictCutoff)}。`,
  ];
  if (diff.missing.length) {
    lines.push('', '## 严格方案有、快速方法漏掉的', '', '|项目|严格方案新增|事件记录次数|进了候选|', '|---|---:|---:|---|');
    for (const m of missingWithClues) lines.push(`|${m.fullName}|${num(m.gain)}|${m.records ?? '（当天事件数据未存）'}|${CANDIDATE[m.candidate]}|`);
  }
  if (diff.extra.length) {
    lines.push('', '## 快速方法有、严格方案没有的', '', '严格方案的名单是完整的，这些项目在它那里没排进前 20：对照两边的新增数和取数时间。', '', '|项目|快速方法新增|', '|---|---:|');
    for (const e of diff.extra) lines.push(`|${e.fullName}|${num(e.gain)}|`);
  }
  if (diff.numbers.length) {
    // 官方星数历史里旧日子的数字会因取消 Star 变小，两边取数时间不同也会差一点，所以列出各自取数时间。
    lines.push('', '## 数字不同', '', '|项目|快速方法|严格方案|快速方法取数时间|严格方案取数时间|', '|---|---:|---:|---|---|');
    for (const n of diff.numbers) lines.push(`|${n.fullName}|${num(n.fast)}|${num(n.strict)}|${n.fastAt}|${n.strictAt}|`);
  }
  return lines.join('\n') + '\n';
}
