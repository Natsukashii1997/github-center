// 周报（#28，2026-11-03 起替代日报）：本周 GitHub 涨星前 10，取涨星榜“近 7 天”最新一期，末位并列一起列出。
// 按这一期的统计日写 data/weekly/<统计日>.json、<统计日>.feishu.md（飞书消息内容）和 <统计日>.card.json（飞书卡片，#59）；只写一次，已存在就不重写。
// 只读本地快照和项目资料，不请求上游；本仓库不发送，由猛鬼兽（Hermes）每周一读最新一份发出（docs/handoff/weekly-hermes.md）。
// 数据不是最新、可能不完整、更新失败都照实写进提示，不改数字、不补数。
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { readLatestSnapshot, readStatus, newerFailure, lastEndedDay } from '../ranking/index.js';
import { readJson, writeOnce, writeAtomic } from '../ranking/store.js';
import { windowDays } from '../ranking/stat-day.js';
import { readProfile, findProfile, shownGenerated } from '../profiles/index.js';
import { windowStatus } from '../web/home.js';

// 本机网站（npm run serve 的默认端口，也是常驻服务的端口）。
export const SITE = 'http://127.0.0.1:5310';
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
    `涨星榜近 7 天，数据截至 ${md(w.statDay)}（GitHub 统计日，美国太平洋时间），${bj(w.generatedAt)}（北京时间）生成。`];
  if (w.notes.length) lines.push('', '**提示**', ...w.notes.map((n) => `- ${n.title}：${n.text}`));
  if (!w.entries.length) lines.push('', '这一期没有核出项目。');
  for (const e of w.entries) {
    // 没有一句话（#52）：给 GitHub 上的描述，也没有就只列名字和数字，不写“生成中”。
    const text = e.line ? oneLine(e.line) : e.desc ? `GitHub 上的描述：${oneLine(e.desc)}` : null;
    lines.push('', `**${e.rank}. [${e.repo}](${SITE}/p/${e.repo})**${e.tie ? '（并列）' : ''}　近 7 天 +${num(e.gain)}　总 Star ${num(e.total)}　[GitHub](https://github.com/${e.repo})`, ...(text ? [text] : []));
  }
  lines.push('', '数字来自 GitHub 官方数据；一句话由 AI 根据项目文档写成。项目名链到本机网站的项目页，只在运行本中心的电脑上能打开；手机上点 GitHub。');
  return `${lines.join('\n')}\n`;
}

// 飞书卡片（#59，常浩选的 B 版“排行榜”，卡片 JSON 2.0；#86 改版）。横幅图（本身就是标题）由发送方（猛鬼兽）上传后插在 body.elements 最前面，本仓库不管图片。
const MEDAL = { 1: '🥇', 2: '🥈', 3: '🥉' };
// 这周才出现的仓库：本周以前攒下的 Star 不到 1,000。
const isNew = (e) => e.total - e.gain < 1000;
const wan = (n) => (n >= 10000 ? `${(n / 10000).toFixed(1).replace(/\.0$/, '')} 万` : num(n));
// 卡片 Markdown 里会被当成格式的字符换成 HTML 实体，仓库名和简介原样显示。
const esc = (s) => s.replace(/[&<>*_~`[\]]/g, (c) => `&#${c.charCodeAt(0)};`);
const md2 = (content, extra = {}) => ({ tag: 'markdown', content, ...extra });
const col = (width, elements, extra = {}) => ({ tag: 'column', width, vertical_align: 'center', elements, ...extra });
const chip = (text, color) => `<text_tag color='${color}'>${esc(text)}</text_tag>`;
// 类型标签的颜色跟涨星榜页面的色点对应（bw.css 的 --t-*）；说明标签用蓝色，所以 Agent 用靛蓝。没列到的用中性灰。
const TYPE_COLOR = { Skill: 'violet', MCP: 'turquoise', Agent: 'indigo', 'AI 应用': 'carmine', 插件: 'yellow', 框架: 'green', 工具: 'neutral', 应用: 'orange', 内容: 'neutral' };

// 每行三列：名次｜项目名（大一号）、仓库主人、说明标签、类型标签、新项目，下一行一句话｜近 7 天涨星、总 Star。前 3 名灰底带奖牌。
function cardRow(e) {
  const top = e.rank <= 3;
  const text = e.line ? oneLine(e.line) : e.desc ? `GitHub 上的描述：${oneLine(e.desc)}` : null;
  const [owner, name] = e.repo.includes('/') ? e.repo.split('/', 2) : [null, e.repo];
  const chips = [e.tag && chip(e.tag, 'blue'), e.type && chip(e.type, TYPE_COLOR[e.type] ?? 'neutral'), isNew(e) && chip('新项目', 'red')].filter(Boolean);
  const title = [`**${esc(name)}**${e.tie ? '（并列）' : ''}`, owner && `<font color='grey'>${esc(owner)}</font>`, ...chips].filter(Boolean).join(' ');
  // 2026-11-05 实发核对：column_set 不认 padding 和 behaviors，内边距放在列上，整行跳转用 action.multi_url。
  const pad = (l, r) => ({ padding: `10px ${r}px 10px ${l}px` });
  const url = `https://github.com/${e.repo}`;
  return {
    tag: 'column_set', flex_mode: 'none', horizontal_spacing: '8px', margin: '0px',
    ...(top ? { background_style: 'grey-100' } : {}),
    action: { multi_url: { url, pc_url: '', android_url: '', ios_url: '' } },
    columns: [
      col('36px', [md2(top ? MEDAL[e.rank] : `<font color='grey'>**${e.rank}**</font>`, { text_align: 'center', text_size: top ? 'heading' : 'heading-4' })], pad(8, 0)),
      col('weighted', [md2(title, { text_size: 'heading-4' }), ...(text ? [md2(`<font color='grey'>${esc(text)}</font>`)] : [])], { weight: 1, vertical_spacing: '4px', ...pad(4, 4) }),
      col('auto', [md2(`<font color='orange'>**+${num(e.gain)}**</font>`, { text_align: 'right', text_size: 'heading-4' }), md2(`<font color='grey'>总 ${wan(e.total)}</font>`, { text_align: 'right' })], { vertical_spacing: '4px', ...pad(0, 12) }),
    ],
  };
}

// 三个按钮等宽、整体居中：电脑上一行三个，手机上窄屏自动一行一个、占满宽度。三种底色一眼分开。
const button = (text, url, type) => col('weighted', [{ tag: 'button', text: { tag: 'plain_text', content: text }, type, width: 'fill', size: 'medium', behaviors: [{ type: 'open_url', default_url: url }] }], { weight: 1 });

export function weeklyCard(w) {
  const range = `${md(w.from)}–${md(w.statDay)}`;
  const elements = [md2(`<font color='grey'>${range} · 近 7 天新增 Star 前 ${TOP}</font>`, { text_align: 'center' })];
  if (w.notes.length) elements.push(md2(`<font color='orange'>**⚠️ 提示**</font>\n${w.notes.map((n) => `- ${esc(n.title)}：${esc(oneLine(n.text))}`).join('\n')}`));
  if (!w.entries.length) elements.push(md2('这一期没有核出项目。'));
  elements.push(...w.entries.map(cardRow));
  elements.push(
    { tag: 'column_set', flex_mode: 'stretch', horizontal_spacing: '12px', horizontal_align: 'center', margin: '8px 0px 0px 0px', columns: [
      button('GitHub 周趋势', 'https://github.com/trending?since=weekly', 'primary_filled'),
      button('完整涨星榜（电脑）', `${SITE}/stars?w=d7`, 'laser'),
      button('我的收藏（电脑）', `${SITE}/favorites`, 'default'),
    ] },
    { tag: 'hr' },
    md2(`来自 Github·Tidings · 数据截至 ${md(w.statDay)}（GitHub 统计日，美国太平洋时间），${bj(w.generatedAt)}（北京时间）生成。数字来自 GitHub 官方数据，一句话和标签由 AI 根据项目文档写成；标着「电脑」的按钮只在运行本中心的电脑上能打开。`, { text_size: 'notation', text_align: 'center' }),
  );
  return {
    schema: '2.0',
    config: { summary: { content: `GitHub 本周涨星前 ${TOP} · ${range}` } },
    body: { vertical_spacing: '8px', elements },
  };
}

// 消息文件跟着周报写：周报先写（只写一次），写成了再写消息文件和卡片；不在（中途断掉）就照周报补上，已有的不动。
function ensureMessages(dataDir, day, weekly) {
  const files = { feishuPath: [weeklyPath(day, 'feishu.md'), weeklyMarkdown], cardPath: [weeklyPath(day, 'card.json'), (w) => `${JSON.stringify(weeklyCard(w), null, 2)}\n`] };
  const out = {};
  for (const [key, [path, render]] of Object.entries(files)) {
    if (!existsSync(join(dataDir, path))) writeAtomic(join(dataDir, path), render(weekly ??= readWeekly(dataDir, day)));
    out[key] = path;
  }
  return out;
}

// 生成一份周报。返回 status：published | exists | missing（还没有近 7 天的榜单）。
export function buildWeekly({ dataDir, now = () => new Date() }) {
  const s = readLatestSnapshot(dataDir, 'd7');
  if (!s) return { status: 'missing' };
  const day = s.statDay;
  const path = weeklyPath(day);
  if (existsSync(join(dataDir, path))) return { status: 'exists', statDay: day, path, ...ensureMessages(dataDir, day) };

  // 提示：更新失败、可能不完整、未做自检（同网站）；没有失败记录但统计日落后于最近一个已结束的统计日，写明不是最新。
  const failed = newerFailure(readStatus(dataDir), 'd7', s);
  const notes = windowStatus(s, failed).notes.map(({ title, text }) => ({ title, text }));
  const expected = lastEndedDay(now());
  const stale = day < expected;
  if (stale && !failed) notes.push({ title: '不是最新数据', text: `最近一期应是 ${md(expected)}，还没出；下面是 ${md(day)}的数据。` });

  const top = s.entries.filter((e) => e.rank <= TOP);
  const entries = top.map((e) => {
    const profile = e.projectId ? readProfile(dataDir, e.projectId) : findProfile(dataDir, e.fullName);
    const g = shownGenerated(profile);
    return { rank: e.rank, tie: top.filter((x) => x.rank === e.rank).length > 1, repo: e.fullName, id: e.projectId ?? null, gain: e.gain, total: e.total, line: g?.line ?? g?.what ?? null, tag: g?.tag ?? null, type: g?.type ?? null, desc: profile?.description ?? null };
  });
  const weekly = { statDay: day, from: windowDays(day, 7)[0], generatedAt: now().toISOString(), run: s.runId ?? null, stale, incomplete: Boolean(s.incomplete), notes, entries };
  const written = writeOnce(dataDir, path, JSON.stringify(weekly, null, 2));
  if (written.status === 'exists') return { status: 'exists', statDay: day, path, ...ensureMessages(dataDir, day) };
  return { status: 'published', statDay: day, path, ...ensureMessages(dataDir, day, weekly), weekly };
}
