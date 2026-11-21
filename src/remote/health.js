// 健康检查（#48）：给猛鬼兽（Hermes）每天 09:50 的工程自检调用（bin/health.js），它把输出原样发到所有者的飞书私聊。
// 没问题返回空数组（什么都不发），有问题每条一句中文。只读：不改文件、不发消息。
// Mac 一直关机时这里也跑不了（猛鬼兽也在 Mac 上），那种情况靠网站上写明的数据日期。
import { beijing } from '../update-steps.js';
import { WINDOWS } from '../ranking/stat-day.js';

const STUCK_HOURS = 3;
const GRACE_MINUTES = 120; // 到了更新时间再等 2 小时（平时 15 分钟跑完）才要求今天已跑过
const BACKUP_STALE_DAYS = 2;
const UNFINISHED_LISTED = 5;
const daysBetween = (a, b) => Math.round((Date.parse(b) - Date.parse(a)) / 86400_000);
const minutesOf = (hhmm) => Number(hhmm.slice(0, 2)) * 60 + Number(hhmm.slice(3));
const DEPLOY = 'bash scripts/deploy-code.sh';

// 域名探测（#105）：请求 <url>/login，200 且是本站登录页（标题带 SITE_MARK）算通，返回 { host, ok: true }。
// https 连不上再请求一次 http（不跟跳转）：阿里云拦未备案域名时 https 被重置、http 回 403「Non-compliance ICP Filing」，
// 认出来返回 { host, blocked: true }；其余返回 { host, error }。每次请求最多 SITE_TIMEOUT_MS。不走代理（Node 的 fetch 默认不读代理变量）。
export const SITE_MARK = 'Github·Tidings';
const SITE_TIMEOUT_MS = 15_000;
const isIcpBlock = (status, body) => status === 403 && body.includes('ICP');
export async function probeSite(url, fetchImpl = fetch) {
  let login;
  try {
    login = new URL('/login', url);
  } catch {
    return { host: String(url), error: 'data/remote.json 里的 url 不是网址' };
  }
  const host = login.host;
  const get = async (u, redirect) => {
    const r = await fetchImpl(u, { redirect, signal: AbortSignal.timeout(SITE_TIMEOUT_MS) });
    return { status: r.status, body: await r.text() };
  };
  const reason = (e) => e?.cause?.code ?? e?.cause?.message ?? e?.name ?? String(e);
  let error;
  try {
    const r = await get(login, 'follow');
    if (r.status === 200 && r.body.includes(SITE_MARK)) return { host, ok: true };
    if (isIcpBlock(r.status, r.body)) return { host, blocked: true };
    return { host, error: `${login.href} 返回 ${r.status}${r.status === 200 ? '，但不是本站登录页' : ''}` };
  } catch (e) {
    error = `${login.href} 连不上（${reason(e)}）`;
  }
  if (login.protocol === 'https:') {
    const plain = new URL(login);
    plain.protocol = 'http:';
    try {
      const r = await get(plain, 'manual');
      if (isIcpBlock(r.status, r.body)) return { host, blocked: true };
    } catch {
      // http 也连不上：照报 https 的原因。
    }
  }
  return { host, error };
}

// run：lastRun()；settings：readSettings()；remote：有没有配服务器；server：服务器上网站的状态（'active' 等）或连不上时的 Error；
// backups：listBackups()（新的在前）；unfinished：榜单上简介没和当前资料对上的项目名（#52，当轮重试也没补上，网站先显示旧简介或 GitHub 描述）；
// ai：设置页「AI 接入」选定的执行方用不了的功能，每个一句（../ai-access.js 的 aiProblems，#69）。
// gaps：涨星榜前几天缺的期次（../ranking/backfill.js 的 missingDays，#103）；回补失败不算出榜失败，靠这里报出来。每日更新关着时不报。
// 以下三项配了服务器才有（#105），不传就是没查：site：probeSite() 的结果（data/remote.json 没填 url 就不查）；
// version：serverVersion() 的结果（null 是服务器上没有版本记录）或读不出时的 Error，服务器连不上时不查；
// lag：codeLag() 的结果或 Error，有版本记录才查。
export function healthProblems({ run, settings, remote, server, backups, unfinished = [], ai = [], gaps = [], site, version, lag, now = new Date() }) {
  const out = [...ai];
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
  // 每日更新关着时不报：这时不会回补，缺期会一直停在那里，天天报同一句没有用。
  if (gaps.length && settings.daily.on) {
    const list = gaps.map((g) => `${g.day.slice(5)}（近 ${g.windows.map((w) => WINDOWS[w].days).join('、')} 天）`).join('、');
    out.push(`涨星榜缺 ${gaps.length} 期：${list}。每日更新出完最近一期后会自动回补；连着几天还缺，看 data/logs/update.log 里「回补」的报错。`);
  }
  if (remote) {
    if (server instanceof Error) out.push(`连不上服务器：${server.message}`);
    else if (server !== 'active') out.push(`服务器上的网站没在跑（systemctl 状态：${server || '空'}）。`);
    const latest = backups[0]?.match(/\d{4}-\d{2}-\d{2}/)?.[0];
    if (!latest) out.push('还没有服务器库的备份（data/backups/ 是空的）。');
    else if (daysBetween(latest, today.day) > BACKUP_STALE_DAYS) out.push(`服务器库的最新备份是 ${latest}，已经 ${daysBetween(latest, today.day)} 天没备份了。`);
    if (site?.blocked) out.push(`域名 ${site.host} 打不开：被阿里云按未备案拦截（http 返回「Non-compliance ICP Filing」）。ICP 备案通过后这句自动不报。`);
    else if (site?.error) out.push(`域名 ${site.host} 打不开：${site.error}。`);
    if (version instanceof Error) out.push(`读不到服务器的代码版本：${version.message}。服务器上的代码早于这项检查（#105）时就会这样，重新发一次代码（${DEPLOY}）就好。`);
    else if (version === null) out.push(`服务器上没有代码版本记录（VERSION），对不上它跑的是哪个提交：重新发一次代码（${DEPLOY}）就有了。`);
    if (lag instanceof Error) out.push(`对不上服务器代码和本机 main：${lag.message}。`);
    else if (lag?.differs) {
      const at = version?.at && !Number.isNaN(Date.parse(version.at)) ? `，${Object.values(beijing(new Date(version.at))).join(' ')} 发的` : '';
      const which = `部署的是 ${version.commit.slice(0, 7)}${at}`;
      out.push(lag.behind
        ? `服务器代码落后本机 main ${lag.behind} 个改了代码的提交（${which}）：发布用 ${DEPLOY}。`
        : `服务器代码和本机 main 不一样（${which}，有 main 里没有的代码改动：可能从别的分支发的，或本机 main 还没拉）。`);
    }
  }
  return out;
}
