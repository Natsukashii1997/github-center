// 名次变化与连续上榜（#17）：和上一期比名次（▲n 升、▼n 降、新进、持平），以及连续几期第 1 / 前 20。
// 只做涨星榜（近 1/7/30 天的总榜和分类榜）；“一期”是一个统计日的快照，上一期是前一个统计日。
// 视觉照批准的 signals-r1（design/candidates/signals/，原型在那里的 build.mjs）。
import { join } from 'node:path';
import { existsSync, statSync } from 'node:fs';
import { readJson } from './store.js';
import { gainersInCategory } from '../categories/boards.js';

// 名次变化从哪一期起显示（所有者 2026-10-24）：近 1 天从 10-23 起；近 7/30 天和分类榜从 10-24 起
// （10-22 那期近 7/30 天受已修的合并 bug 影响可能有漏；分类候选从 10-23 起才存）。起始期的上一期是最早能拿来比的一期，
// 连续期数也最早只数到那一期。
export const MARKS_FROM = { d1: '2026-10-23', d7: '2026-10-24', d30: '2026-10-24', cat: '2026-10-24' };
const fromOf = (w, cat) => (cat ? MARKS_FROM.cat : MARKS_FROM[w]);
export const prevDay = (day) => new Date(Date.parse(`${day}T00:00:00Z`) - 86400e3).toISOString().slice(0, 10);
// 项目身份：快照条目用 projectId，候选用 id，都没有才用小写名字（和首页卡片同一套认法）。
export const keyOf = (e) => String(e.projectId ?? e.id ?? e.fullName.toLowerCase());

// 快照和候选按统计日只写一次：读过的留在内存里，下次打开页面不重读；按修改时间认，万一被人工重写也会重读。
// 还没写出来的（null）不留。网站常驻运行，最多留 FILE_CACHE 份（约三个窗口各 60 天），满了先丢最早读的。
const FILE_CACHE = 400;
const files = new Map();
function readOnce(path) {
  const mtime = existsSync(path) ? statSync(path).mtimeMs : null;
  if (mtime === null) return null;
  const hit = files.get(path);
  if (hit?.mtime === mtime) return hit.v;
  const v = readJson(path);
  if (v) {
    files.delete(path);
    if (files.size >= FILE_CACHE) files.delete(files.keys().next().value);
    files.set(path, { mtime, v });
  }
  return v;
}

// 一个页面请求里用一个：dataDir 是数据目录，find 是现在的分类记录（分类榜按现在的分类重算往期，和首页分类榜同一口径）。
export function rankHistory(dataDir, find) {
  const memo = new Map();
  // 某一期的一份榜：项目 → 名次；那天没有这份榜就是 null。
  function ranksAt(w, cat, day) {
    const k = `${w}/${cat ?? ''}/${day}`;
    if (memo.has(k)) return memo.get(k);
    let entries = null;
    if (!cat) entries = readOnce(join(dataDir, 'snapshots', w, `${day}.json`))?.entries ?? null;
    else {
      const candidates = readOnce(join(dataDir, 'candidates', w, `${day}.json`));
      entries = candidates ? gainersInCategory({ candidates, find, category: cat }).entries : null;
    }
    const r = entries && new Map(entries.map((e) => [keyOf(e), e.rank]));
    memo.set(k, r);
    return r;
  }
  return {
    // 这一期每个项目和上一期比：上一期在前 20（含并列）里就比名次，不在就是“新进”。
    // 这一期还没到起始期、或上一期缺，返回 null（不标，页面写提示条）。
    moves(w, cat, day) {
      if (day < fromOf(w, cat)) return null;
      const prev = ranksAt(w, cat, prevDay(day));
      if (!prev) return null;
      return (e) => {
        const p = prev.get(keyOf(e));
        const d = p == null ? null : p - e.rank;
        return d == null ? { kind: 'new' } : d > 0 ? { kind: 'up', n: d } : d < 0 ? { kind: 'down', n: -d } : { kind: 'flat' };
      };
    },
    // 从这一期往前一天一天数：在第 1 名（并列第 1 也算）/ 在前 20 就加一，中间缺一期（没有榜，或不在榜上）就停。
    // N≥2 才算，第 1 优先：返回 { kind: 'first' | 'top', n } 或 null，页面上的说法用 streakText。
    streak(w, cat, day, e) {
      const k = keyOf(e), earliest = prevDay(fromOf(w, cat));
      let first = 0, top = 0, stillFirst = true;
      for (let d = day; d >= earliest; d = prevDay(d)) {
        const r = ranksAt(w, cat, d)?.get(k);
        if (r == null) break;
        top++;
        if (stillFirst && r === 1) first++; else stillFirst = false;
      }
      if (first >= 2) return { kind: 'first', n: first };
      if (top >= 2) return { kind: 'top', n: top };
      return null;
    },
  };
}

export const streakText = (s) => (s ? `连续 ${s.n} 期${s.kind === 'first' ? '第 1' : '前 20'}` : null);

// 页面提示条：这份榜还没有可比的上一期。
export const NO_PREV = { icon: 'calendar', title: '没有上一期', text: '暂不显示名次变化。' };

// 给一份榜的行加上名次变化（mv）和连续期数（streak，{ kind: 'first' | 'top', n }，页面自己写成说法）；没有可比的上一期就往 notes 里加提示条。
// rows 是页面要的行，raw 是同顺序的快照条目或候选。
export function markRows(history, { w, cat = null, day, rows, raw, notes }) {
  const mv = history.moves(w, cat, day);
  if (!mv && rows.length) notes.push(NO_PREV);
  rows.forEach((r, i) => {
    if (mv) r.mv = mv(raw[i]);
    const s = history.streak(w, cat, day, raw[i]);
    if (s) r.streak = s;
  });
}
