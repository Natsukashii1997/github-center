// 飞书消息内容（#11）：同一份日报写成 Markdown，`lark-cli im +messages-send --markdown` 能直接发（自动包成飞书富文本）。
// 本仓库只写文件、不发送，由 Codex 机器人读 data/daily/<统计日>.feishu.md 发出。
// 每个项目都链到本机项目页（只在运行本中心的电脑上能打开）；第一次出现时另附 GitHub 原项目链接，手机上也能点开。
import { WINDOWS } from '../ranking/index.js';

// 本机网站（npm run serve 的默认端口）。
export const SITE = 'http://127.0.0.1:5310';
const md = (day) => `${Number(day.slice(5, 7))} 月 ${Number(day.slice(8, 10))} 日`;
const num = (n) => n.toLocaleString('en-US');
const two = (n) => String(n).padStart(2, '0');
const bj = (iso) => { const d = new Date(Date.parse(iso) + 8 * 3600e3); return `${d.getUTCMonth() + 1} 月 ${d.getUTCDate()} 日 ${two(d.getUTCHours())}:${two(d.getUTCMinutes())}`; };
// 简介是一句话：换行和多余空白并成一个空格，免得在消息里断成几段。
const oneLine = (s) => s.replace(/\s+/g, ' ').trim();

export function feishuMarkdown(daily) {
  const page = (repo) => `${SITE}/p/${repo}?from=daily`;
  const lines = [`## GitHub 快速中心日报 · ${md(daily.statDay)}`, '', `统计日 ${md(daily.statDay)}（UTC），${bj(daily.generatedAt)}（北京时间）生成。`, '', daily.overview];
  if (daily.notes.length) lines.push('', '**提示**', ...daily.notes.map((n) => `- ${n.title}：${n.text}`));
  for (const w of Object.keys(WINDOWS)) {
    const win = daily.windows[w];
    lines.push('', `#### ${win.label}前 10`);
    if (!win.entries.length) lines.push('', win.statDay ? '这一期没有核出项目。' : `还没有${win.label}的榜单。`);
    for (const e of win.entries) {
      const head = `**${e.rank}. [${e.repo}](${page(e.repo)})**${e.tie ? '（并列）' : ''}　+${num(e.gain)}`;
      // 同一项目只介绍一次：再出现只写名次、新增和“见上”。
      if (e.first) {
        lines.push('', `${head}　见上（${daily.windows[e.first.w].label}第 ${e.first.rank} 名）`);
        continue;
      }
      // 简介同日报页：干什么，加上能解决什么问题。
      const p = daily.projects[e.repo];
      lines.push('', `${head}　[GitHub](https://github.com/${e.repo})`, p.what ? oneLine(`${p.what} ${p.problem ?? ''}`) : '简介生成中。');
      if (p.release) lines.push(`版本发布：${md(p.release.publishedAt.slice(0, 10))} [${p.release.tag}](${p.release.url})`);
    }
  }
  lines.push('', '数字来自 GitHub 官方数据；简介由 AI 根据项目文档写成；版本发布取自项目的官方 Release。项目名链到本机网站的项目页，只在运行本中心的电脑上能打开。');
  return `${lines.join('\n')}\n`;
}
