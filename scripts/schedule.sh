#!/bin/bash
# 本机 launchd 的两个任务：bash scripts/schedule.sh install | uninstall | status
# 属于本机常驻配置，安装前须所有者同意（2026-11-03 已同意；同日设置页批 3 改成每 15 分钟叫醒，所有者再次同意）。
#
# 1. 每日更新 cn.github-center.update：北京时间每天 09:00–23:45 每 15 分钟叫醒一次 `node bin/update.js --scheduled`，
#    到了设置页里的更新时间（data/settings.json，默认 18:00；#83 前是 10:00）、今天还没跑过才真跑（src/update-steps.js），没到点什么都不写。
#    改更新时间只改设置，不用重装这里（2026-11-03 设置页批 3 起；之前是写死每天 10:00）。
#    出榜 → 全站 Star 前 100 → 历史榜（Skill 安装量）→ 热点榜 → 精选榜 → 补资料 → 归类 → 周报，一步失败照样跑后面的。
#    GitHub 统计日按美国太平洋时间，北京 16:00 才结束（夏令时 15:00），事件文件还要晚 1 小时左右才齐，所以最早 17:00（#83）。
#    叫醒窗口 09:00–23:45 已经覆盖 17:00 以后，#83 改时间不用重装。
#    各步都能安全重跑；到点时电脑睡着的，醒来后补跑。日志 data/logs/update.log，第一行开始时间、最后一行 `exit N`。
# 2. 网站 cn.github-center.web：npm run serve 常驻在 5310，只监听本机，免登录（所有人都当作所有者账号 GUEST，默认 Nat）；
#    开机（登录）就起，出错退出自动重启。日志 data/logs/web.log。
#
# launchd 直接启动 node，不经过 /bin/sh、/bin/bash：launchd 起的 shell 读不了「文稿」目录（全局坑 G-05）。
# 装好后用 launchctl kickstart 真实触发一次再看日志；如果日志里是 Operation not permitted，
# 要在「系统设置 → 隐私与安全性 → 完全磁盘访问权限」里加上这个 node（路径见 status）。
set -euo pipefail

UPDATE=cn.github-center.update
WEB=cn.github-center.web
OLD=cn.github-center.rank
ROOT=$(cd "$(dirname "$0")/.." && pwd)
AGENTS="$HOME/Library/LaunchAgents"
DOMAIN="gui/$(id -u)"
GUEST=${GUEST:-Nat}

plist() { # plist <label> <其余 dict 内容>
  cat > "$AGENTS/$1.plist" <<EOF
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>Label</key><string>$1</string>
  <key>WorkingDirectory</key><string>$ROOT</string>
  <key>EnvironmentVariables</key>
  <dict><key>PATH</key><string>$PATHS</string>$PROXY</dict>
$2
</dict>
</plist>
EOF
  launchctl bootout "$DOMAIN/$1" 2>/dev/null || true
  # bootout 返回时旧任务可能还没卸完（网站要等进程退出），马上 bootstrap 会报「Bootstrap failed: 5」，任务就没装回去（2026-11-03 踩过）：
  # 等它真正不在了再装，最多等 10 秒；仍装不上隔 2 秒再试，共 3 次。
  for _ in $(seq 20); do launchctl print "$DOMAIN/$1" >/dev/null 2>&1 || break; sleep 0.5; done
  for n in 1 2 3; do
    launchctl bootstrap "$DOMAIN" "$AGENTS/$1.plist" && break
    if [ "$n" = 3 ]; then
      echo "没装上 $1：plist 已写好，可以手动 launchctl bootstrap $DOMAIN $AGENTS/$1.plist" >&2
      exit 1
    fi
    sleep 2
  done
  echo "已安装：$AGENTS/$1.plist"
}

case "${1:-}" in
  install)
    NODE=$(command -v node)
    # gh 给出榜、全站 Star 前 100、热点榜和联网查 GitHub 取 token；codex、claude 给补资料、归类、精选榜用（设置页选，Codex 额度用完 Claude 接力）。
    PATHS="$(dirname "$NODE"):$(dirname "$(command -v gh)"):$(dirname "$(command -v codex)"):$(dirname "$(command -v claude)"):/usr/bin:/bin"
    # 本机代理（装的时候有就带上）：直连 GitHub 和 GH Archive 慢且时断时续，走代理快约 10 倍。
    PROXY=""
    for v in HTTPS_PROXY HTTP_PROXY NO_PROXY; do
      if [ -n "${!v:-}" ]; then PROXY="$PROXY<key>$v</key><string>${!v}</string>"; fi
    done
    mkdir -p "$ROOT/data/logs" "$AGENTS"
    # 旧的每日出榜任务（只装过脚本、没装进 launchd 的话这里什么都不做）
    launchctl bootout "$DOMAIN/$OLD" 2>/dev/null || true
    rm -f "$AGENTS/$OLD.plist"
    # 09:00–23:45 每 15 分钟一个叫醒点，共 60 个
    TIMES=""
    for h in $(seq 9 23); do
      for m in 0 15 30 45; do TIMES="$TIMES<dict><key>Hour</key><integer>$h</integer><key>Minute</key><integer>$m</integer></dict>"; done
    done
    plist "$UPDATE" "  <key>ProgramArguments</key>
  <array><string>$NODE</string><string>bin/update.js</string><string>--scheduled</string></array>
  <key>StartCalendarInterval</key>
  <array>$TIMES</array>
  <key>StandardOutPath</key><string>$ROOT/data/logs/update.log</string>
  <key>StandardErrorPath</key><string>$ROOT/data/logs/update.log</string>"
    plist "$WEB" "  <key>ProgramArguments</key>
  <array><string>$NODE</string><string>--use-env-proxy</string><string>bin/serve.js</string><string>--port</string><string>5310</string><string>--guest</string><string>$GUEST</string></array>
  <key>RunAtLoad</key><true/>
  <key>KeepAlive</key><dict><key>SuccessfulExit</key><false/></dict>
  <key>ThrottleInterval</key><integer>10</integer>
  <key>StandardOutPath</key><string>$ROOT/data/logs/web.log</string>
  <key>StandardErrorPath</key><string>$ROOT/data/logs/web.log</string>"
    ;;
  uninstall)
    for l in "$UPDATE" "$WEB" "$OLD"; do
      launchctl bootout "$DOMAIN/$l" 2>/dev/null || true
      rm -f "$AGENTS/$l.plist"
    done
    echo "已卸载：$UPDATE、$WEB"
    ;;
  status)
    for l in "$UPDATE" "$WEB"; do
      echo "== $l"
      launchctl print "$DOMAIN/$l" 2>/dev/null | grep -E 'state =|last exit code|pid =|program =' || echo "没有安装"
    done
    echo "每日更新时间看设置页（data/settings.json，默认 18:00）；今天跑过没有看 data/update-state.json"
    ;;
  *)
    echo "用法：[GUEST=账号名] bash scripts/schedule.sh install | uninstall | status" >&2
    exit 2
    ;;
esac
