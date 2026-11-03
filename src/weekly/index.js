// 周报（#28，2026-11-03 起替代日报）：本周 GitHub 涨星前 10，取涨星榜“近 7 天”最新一期，末位并列一起列出。
// 按这一期的统计日写 data/weekly/<统计日>.json 和 <统计日>.feishu.md（飞书消息内容）；只写一次，已存在就不重写。
// 只读本地快照和项目资料，不请求上游；本仓库不发送，由猛鬼兽（Hermes）每周一读最新一份发出（docs/handoff/weekly-hermes.md）。
// 数据不是最新、可能不完整、更新失败都照实写进提示，不改数字、不补数。
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { readLatestSnapshot, readStatus, newerFailure, lastEndedDay } from '../ranking/index.js';
import { readJson, writeOnce, writeAtomic } from '../ranking/store.js';
import { windowDays } from '../ranking/stat-day.js';
import { readProfile, findProfile, currentGenerated } from '../profiles/index.js';
import { windowStatus } from '../web/home.js';
import { SITE } from '../daily/feishu.js';

export const TOP = 10;
const md = (day) => `${Number(day.slice(5, 7))} 月 ${Number(day.slice(8, 10))} 日`;
const num = (n) => n.toLocaleString('en-US');
const two = (n) => String(n).padStart(2, '0');
const bj = (iso) => { const d = new Date(Date.parse(iso) + 8 * 3600e3); return `${d.getUTCMonth() + 1} 月 ${d.getUTCDate()} 日 ${two(d.getUTCHours())}:${two(d.getUTCMinutes())}`; };
// 一句话：换行和多余空白并成一个空格，免得在消息里断成几段。
const oneLine = (s) => s.replace(/\s+/g, ' ').trim();

export const weeklyPath = (day, ext = 'json') => join('weekly', `${day}.${ext}`);
export const readWeekly = (dataDir, day) => readJson(join(dataDir, weeklyPath(day)));

export function weeklyMarkdown(w) {
  const lines = [`## GitHub 本周涨星前 ${TOP} · ${md(w.from)}–${md(w.statDay)}`, '',
    `涨星榜近 7 天，数据截至 ${md(w.statDay)}（UTC 统计日），${bj(w.generatedAt)}（北京时间）生成。`];
  if (w.notes.length) lines.push('', '**提示**', ...w.notes.map((n) => `- ${n.title}：${n.text}`));
  if (!w.entries.length) lines.push('', '这一期没有核出项目。');
  for (const e of w.entries) {
    lines.push('', `**${e.rank}. [${e.repo}](${SITE}/p/${e.repo})**${e.tie ? '（并列）' : ''}　近 7 天 +${num(e.gain)}　总 Star ${num(e.total)}　[GitHub](https://github.com/${e.repo})`,
      e.line ? oneLine(e.line) : '简介生成中。');
  }
  lines.push('', '数字来自 GitHub 官方数据；一句话由 AI 根据项目文档写成。项目名链到本机网站的项目页，只在运行本中心的电脑上能打开；手机上点 GitHub。');
  return `${lines.join('\n')}\n`;
}

// 消息文件跟着周报写：周报先写（只写一次），写成了再写消息文件；消息文件不在（中途断掉）就照周报补上，已有的不动。
function ensureFeishu(dataDir, day, weekly) {
  const path = weeklyPath(day, 'feishu.md');
  if (!existsSync(join(dataDir, path))) writeAtomic(join(dataDir, path), weeklyMarkdown(weekly ?? readWeekly(dataDir, day)));
  return path;
}

// 生成一份周报。返回 status：published | exists | missing（还没有近 7 天的榜单）。
export function buildWeekly({ dataDir, now = () => new Date() }) {
  const s = readLatestSnapshot(dataDir, 'd7');
  if (!s) return { status: 'missing' };
  const day = s.statDay;
  const path = weeklyPath(day);
  if (existsSync(join(dataDir, path))) return { status: 'exists', statDay: day, path, feishuPath: ensureFeishu(dataDir, day) };

  // 提示：更新失败、可能不完整、未做自检（同网站）；没有失败记录但统计日落后于最近一个已结束的统计日，写明不是最新。
  const failed = newerFailure(readStatus(dataDir), 'd7', s);
  const notes = windowStatus(s, failed).notes.map(({ title, text }) => ({ title, text }));
  const expected = lastEndedDay(now());
  const stale = day < expected;
  if (stale && !failed) notes.push({ title: '不是最新数据', text: `最近一期应是 ${md(expected)}，还没出；下面是 ${md(day)}的数据。` });

  const top = s.entries.filter((e) => e.rank <= TOP);
  const entries = top.map((e) => {
    const g = currentGenerated(e.projectId ? readProfile(dataDir, e.projectId) : findProfile(dataDir, e.fullName));
    return { rank: e.rank, tie: top.filter((x) => x.rank === e.rank).length > 1, repo: e.fullName, id: e.projectId ?? null, gain: e.gain, total: e.total, line: g?.line ?? g?.what ?? null };
  });
  const weekly = { statDay: day, from: windowDays(day, 7)[0], generatedAt: now().toISOString(), run: s.runId ?? null, stale, incomplete: Boolean(s.incomplete), notes, entries };
  const written = writeOnce(dataDir, path, JSON.stringify(weekly, null, 2));
  if (written.status === 'exists') return { status: 'exists', statDay: day, path, feishuPath: ensureFeishu(dataDir, day) };
  return { status: 'published', statDay: day, path, feishuPath: ensureFeishu(dataDir, day, weekly), weekly };
}
