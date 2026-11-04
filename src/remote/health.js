// 健康检查（#48）：给猛鬼兽（Hermes）每天 09:50 的工程自检调用（bin/health.js），它把输出原样发到所有者的飞书私聊。
// 没问题返回空数组（什么都不发），有问题每条一句中文。只读：不改文件、不发消息。
// Mac 一直关机时这里也跑不了（猛鬼兽也在 Mac 上），那种情况靠网站上写明的数据日期。
import { beijing } from '../update-steps.js';

const STUCK_HOURS = 3;
const GRACE_MINUTES = 120; // 到了更新时间再等 2 小时（平时 15 分钟跑完）才要求今天已跑过
const BACKUP_STALE_DAYS = 2;
const UNFINISHED_LISTED = 5;
const daysBetween = (a, b) => Math.round((Date.parse(b) - Date.parse(a)) / 86400_000);
const minutesOf = (hhmm) => Number(hhmm.slice(0, 2)) * 60 + Number(hhmm.slice(3));

// run：lastRun()；settings：readSettings()；remote：有没有配服务器；server：服务器上网站的状态（'active' 等）或连不上时的 Error；
// backups：listBackups()（新的在前）；unfinished：榜单上简介没和当前资料对上的项目名（#52，当轮重试也没补上，网站先显示旧简介或 GitHub 描述）。
export function healthProblems({ run, settings, remote, server, backups, unfinished = [], now = new Date() }) {
  const out = [];
  const today = beijing(now);
  if (settings.daily.on) {
    if (!run) out.push('每日更新还没跑过（data/logs/update.log 里没有记录）。');
    else {
      const started = beijing(new Date(run.startedAt));
      const expect = minutesOf(today.time) >= minutesOf(settings.daily.at) + GRACE_MINUTES ? today.day : beijing(new Date(now.getTime() - 86400_000)).day;
      const hours = (now - new Date(run.startedAt)) / 3600_000;
      if (run.running && hours >= STUCK_HOURS) out.push(`每日更新从 ${started.day} ${started.time} 开始，${Math.floor(hours)} 小时了还没结束，可能卡住了。`);
      if (started.day < expect) out.push(`每日更新 ${daysBetween(started.day, today.day)} 天没跑了（最后一次 ${started.day} ${started.time}）：Mac 可能一直关机或睡着，网站上的数据停在那天。`);
      if (run.failed.length) out.push(`最近一次每日更新（${started.day}）有步骤失败：${run.failed.join('、')}。详情看 data/logs/update.log。`);
    }
  }
  if (unfinished.length) {
    const shown = unfinished.slice(0, UNFINISHED_LISTED).join('、') + (unfinished.length > UNFINISHED_LISTED ? ' 等' : '');
    out.push(`有 ${unfinished.length} 个榜单项目的简介没生成成功（重试过也没成），网站上先显示旧简介或 GitHub 描述：${shown}。详情看 data/logs/update.log。`);
  }
  if (remote) {
    if (server instanceof Error) out.push(`连不上服务器：${server.message}`);
    else if (server !== 'active') out.push(`服务器上的网站没在跑（systemctl 状态：${server || '空'}）。`);
    const latest = backups[0]?.match(/\d{4}-\d{2}-\d{2}/)?.[0];
    if (!latest) out.push('还没有服务器库的备份（data/backups/ 是空的）。');
    else if (daysBetween(latest, today.day) > BACKUP_STALE_DAYS) out.push(`服务器库的最新备份是 ${latest}，已经 ${daysBetween(latest, today.day)} 天没备份了。`);
  }
  return out;
}
