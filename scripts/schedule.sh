#!/bin/bash
# 本机 launchd 的两个任务：bash scripts/schedule.sh install | uninstall | status
# 属于本机常驻配置，安装前须所有者同意（2026-11-03 已同意）。
#
# 1. 每日更新 cn.github-center.update：每天北京时间 10:00 跑 npm run update（bin/update.js）：
#    出榜 → 历史榜 → 热点榜 → 精选榜 → 补资料 → 归类 → 周报 → 校准报告，一步失败照样跑后面的。
#    统计日按 UTC 划分，北京时间 08:00 才结束，事件文件还要晚 1 小时左右才齐，所以定在 10:00。
#    各步都能安全重跑；电脑在 10:00 睡着时，醒来后补跑。日志 data/logs/update.log，第一行开始时间、最后一行 `exit N`。
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
  launchctl bootstrap "$DOMAIN" "$AGENTS/$1.plist"
  echo "已安装：$AGENTS/$1.plist"
}

case "${1:-}" in
  install)
    NODE=$(command -v node)
    # gh 给出榜、历史榜、热点榜和联网查 GitHub 取 token；codex 给补资料、归类、精选榜用。
    PATHS="$(dirname "$NODE"):$(dirname "$(command -v gh)"):$(dirname "$(command -v codex)"):/usr/bin:/bin"
    # 本机代理（装的时候有就带上）：直连 GitHub 和 GH Archive 慢且时断时续，走代理快约 10 倍。
    PROXY=""
    for v in HTTPS_PROXY HTTP_PROXY NO_PROXY; do
      if [ -n "${!v:-}" ]; then PROXY="$PROXY<key>$v</key><string>${!v}</string>"; fi
    done
    mkdir -p "$ROOT/data/logs" "$AGENTS"
    # 旧的每日出榜任务（只装过脚本、没装进 launchd 的话这里什么都不做）
    launchctl bootout "$DOMAIN/$OLD" 2>/dev/null || true
    rm -f "$AGENTS/$OLD.plist"
    plist "$UPDATE" "  <key>ProgramArguments</key>
  <array><string>$NODE</string><string>bin/update.js</string></array>
  <key>StartCalendarInterval</key>
  <dict><key>Hour</key><integer>10</integer><key>Minute</key><integer>0</integer></dict>
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
      launchctl print "$DOMAIN/$l" 2>/dev/null | grep -E 'state =|last exit code|pid =|program =|Hour|Minute' || echo "没有安装"
    done
    ;;
  *)
    echo "用法：[GUEST=账号名] bash scripts/schedule.sh install | uninstall | status" >&2
    exit 2
    ;;
esac
