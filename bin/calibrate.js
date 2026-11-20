// 校准报告：npm run calibrate -- [--day YYYY-MM-DD] [--data data] [--strict 严格实验目录]
// 只读 Codex 严格实验的结果，和快速方法同一天的近 1 天快照对照；报告写进 data/calibration/<统计日>.md 并打印。
// 不给 --day 时，把严格方案已有结果、快速方法也有快照、还没出过报告的日子都出一遍（每日定时任务出榜后跑这个）。
import { mkdirSync, writeFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { parseArgs } from 'node:util';
import { findSnapshot } from '../src/ranking/store.js';
import { strictDays, readStrictResult, compare, clues, report } from '../src/ranking/calibrate.js';

// 严格实验的运行目录（docs/history/HANDOFF.md 里的“实验根目录”下）。
const STRICT = '/Users/nat/Documents/ChatGPT/自动化推送/outputs/github-center-sustained-run';
const { values } = parseArgs({ options: { day: { type: 'string' }, data: { type: 'string', default: 'data' }, strict: { type: 'string', default: STRICT } } });
const reportPath = (day) => join(values.data, 'calibration', `${day}.md`);

function calibrate(day) {
  const fast = findSnapshot(values.data, 'd1', day)?.snapshot;
  if (!fast) return console.error(`快速方法还没有统计日 ${day} 的近 1 天快照，先运行 npm run rank -- --day ${day}`), null;
  const strict = readStrictResult(values.strict, day);
  if (!strict) return console.error(`严格方案还没有统计日 ${day} 的结果（${values.strict}/results/）`), null;
  const diff = compare({ fast, strict: strict.result });
  const text = report({ diff, fast, strictPath: strict.path, missingWithClues: clues({ diff, fast, dataDir: values.data }) });
  mkdirSync(join(values.data, 'calibration'), { recursive: true });
  writeFileSync(reportPath(day), text);
  console.log(text);
  return diff.verdict;
}

const days = values.day ? [values.day] : strictDays(values.strict).filter((d) => !existsSync(reportPath(d)));
if (!days.length) console.log('没有要出的校准报告：严格方案还没有新的结果。');
const verdicts = days.map(calibrate);
if (verdicts.some((v) => v === null)) process.exitCode = 2;
else if (verdicts.some((v) => v !== '一致')) process.exitCode = 1;
