// 各页共用的项目卡转换（#114 从 home.js 拆出）：涨星页、项目页、收藏页、发现页的详情栏都用同一套卡片内容。
// 卡片上的数字和 30 天走势取这一期榜单那次运行存下的官方原始响应：三个窗口的快照可能出自不同次运行（某个窗口失败后重跑），
// 同一张卡上的数字和柱子来自同一份响应才对得上。缺数据的那天留空位，不补零。
import { join } from 'node:path';
import { WINDOWS } from '../ranking/index.js';
import { readJson } from '../store.js';
import { bucketOf, windowDays } from '../ranking/stat-day.js';
import { PER_PAGE } from '../ranking/github.js';
import { readProfile, shownGenerated, skillPurpose } from '../profiles/index.js';

const SERIES_DAYS = 30;

// 截至统计日（含）的 30 个统计日，每天取官方星数历史里那一格，规则和出榜相同：那一周的历史在就取；项目那天还不存在
// （历史不满一页且最早一周晚于那天）记 0；否则那天缺数据，记 null（缺失不补零）。
export function dailySeries(weeks, statDay) {
  return windowDays(statDay, SERIES_DAYS).map((d) => {
    const b = bucketOf(d);
    const week = weeks.find((w) => w.week === b.week);
    if (week) return week.days[b.dayIndex];
    return weeks.length < PER_PAGE && weeks.every((w) => w.week > b.week) ? 0 : null;
  });
}

// 一次运行里一个项目的数字：30 天走势、三个窗口的新增（窗口里有一天缺数据就记 null）、总 Star。
// 这一期自己的窗口直接用榜上的数字，它和走势出自同一份响应，两者相等。
function runFigures(dataDir, w, snapshot, entry) {
  const weeks = entry.evidence?.history ? readJson(join(dataDir, entry.evidence.history.path)) : null;
  const series = weeks ? dailySeries(weeks, snapshot.statDay) : null;
  const gains = Object.fromEntries(Object.entries(WINDOWS).map(([id, { days }]) => {
    const span = series?.slice(-days);
    return [id, span && !span.includes(null) ? span.reduce((s, x) => s + x, 0) : null];
  }));
  return { seriesDay: snapshot.statDay, series, gains: { ...gains, [w]: entry.gain }, total: entry.total };
}

// 只上了分类榜的项目：卡片标出来（不写“简介生成中”），描述取候选里 GitHub 上的那句。
export const categoryOnly = (card, entry) => ({ ...card, catOnly: true, desc: entry.description ?? null });

// 使用条件：每条带类别、整理后的一句话和原文摘录（#6）。详情栏、项目页不再显示（白雾定稿），项目页数据里照旧带着。
export const conditionsOf = (g) => (g ? g.conditions.map(({ kind, text, quote }) => ({ kind, text, quote })) : []);
// 首页短字段（#23，补资料时由 Codex 生成）：一句话、主要用途、使用场景、说明标签、定义标签。还没按新版重新生成的资料没有这些，页面上那一格留空。
export const shortOf = (g) => ({ line: g?.line ?? null, use: g?.use ?? [], scene: g?.scene ?? [], tag: g?.tag ?? null, type: g?.type ?? null });
// 维护信号（#18）：最近推送取资料里的 pushedAt，最新正式版取补资料时查的 releases/latest；查不到都写“未知”。详情栏里写成“最近更新时间”和最新版本。
export const maintOf = (profile) => ({ pushed: profile?.pushedAt?.slice(0, 10) ?? null, release: profile?.release ?? { state: 'unknown' } });

// 一个上榜项目在卡片上要的全部内容。onBoards：它出现在哪些窗口的快照里，最新生成的在前；语言、创建日期取最新存下的项目信息，
// 数字按运行分开放（runs），卡片按这一期榜单的运行取。
// AI 产出留痕（#69，全局规则 P-13）：简介和分类各是谁做的（执行方、接入方式、模型、时间），详情栏末尾写出来。
// 没生成过的给 null；#69 之前生成的没有记录，给 {}。
export const aiBy = (g, cat) => ({ profile: g ? g.ai ?? {} : null, cats: cat ? cat.ai ?? {} : null });

export function project(dataDir, onBoards, { account, favorites }, find) {
  const { entry } = onBoards[0];
  const projectRaw = onBoards.find((b) => b.entry.evidence?.project)?.entry.evidence.project;
  const info = projectRaw ? readJson(join(dataDir, projectRaw.path)) : null;
  const runs = {};
  for (const b of onBoards) runs[b.snapshot.runId] ??= runFigures(dataDir, b.w, b.snapshot, b.entry);
  const profile = readProfile(dataDir, entry.projectId);
  const g = shownGenerated(profile);
  const saved = favorites.savedIn(account.id, entry.projectId);
  return {
    repo: entry.fullName,
    id: entry.projectId,
    ownerId: info?.owner?.id ?? null,
    runs,
    lang: info?.language ?? null,
    created: info?.created_at?.slice(0, 10) ?? null,
    what: g?.what ?? null,
    problem: g?.problem ?? null,
    // 从没生成过简介（#52：当轮重试也没成）：先给 GitHub 上的描述。
    ghDesc: g ? null : profile?.description ?? info?.description ?? null,
    ...shortOf(g),
    cats: find({ id: entry.projectId, fullName: entry.fullName })?.categories ?? [],
    aiBy: aiBy(g, find({ id: entry.projectId, fullName: entry.fullName })),
    maint: maintOf(profile),
    installable: Boolean(profile?.material),
    skills: (profile?.material?.skills ?? []).map((s) => ({ name: s.name, path: s.path, desc: skillPurpose(s, g) })),
    saved: saved.has(''),
    savedSkills: [...saved].filter(Boolean),
  };
}
