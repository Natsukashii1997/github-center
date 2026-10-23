#!/bin/bash
# 每日出榜定时任务（本机 launchd）：bash scripts/schedule.sh install | uninstall | status
# 属于本机常驻配置，安装前须所有者同意。
# 每天北京时间 10:00 跑一次 npm run rank：统计日按 UTC 划分，北京时间 08:00 才结束，事件文件还要晚 1 小时左右才齐。
# 只出最近一个已结束的统计日；已发布的窗口不重跑，和手动重跑撞上也安全。电脑在 10:00 睡着时，醒来后补跑。
set -euo pipefail

LABEL=cn.github-center.rank
ROOT=$(cd "$(dirname "$0")/.." && pwd)
PLIST="$HOME/Library/LaunchAgents/$LABEL.plist"
DOMAIN="gui/$(id -u)"

case "${1:-}" in
  install)
    NODE=$(command -v node)
    GH=$(command -v gh)
    mkdir -p "$ROOT/data/logs" "$(dirname "$PLIST")"
    # 本机代理（装的时候有就带上）：直连 GitHub 和 GH Archive 慢且时断时续，走代理快约 10 倍。
    PROXY=""
    for v in HTTPS_PROXY HTTP_PROXY NO_PROXY; do
      if [ -n "${!v:-}" ]; then PROXY="$PROXY<key>$v</key><string>${!v}</string>"; fi
    done
    cat > "$PLIST" <<EOF
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>Label</key><string>$LABEL</string>
  <key>ProgramArguments</key>
  <array><string>$NODE</string><string>--use-env-proxy</string><string>$ROOT/bin/rank-day.js</string></array>
  <key>WorkingDirectory</key><string>$ROOT</string>
  <key>EnvironmentVariables</key>
  <dict><key>PATH</key><string>$(dirname "$NODE"):$(dirname "$GH"):/usr/bin:/bin</string>$PROXY</dict>
  <key>StartCalendarInterval</key>
  <dict><key>Hour</key><integer>10</integer><key>Minute</key><integer>0</integer></dict>
  <key>StandardOutPath</key><string>$ROOT/data/logs/rank.log</string>
  <key>StandardErrorPath</key><string>$ROOT/data/logs/rank.err.log</string>
</dict>
</plist>
EOF
    launchctl bootout "$DOMAIN/$LABEL" 2>/dev/null || true
    launchctl bootstrap "$DOMAIN" "$PLIST"
    echo "已安装：$PLIST"
    ;;
  uninstall)
    launchctl bootout "$DOMAIN/$LABEL" 2>/dev/null || true
    rm -f "$PLIST"
    echo "已卸载：$LABEL"
    ;;
  status)
    launchctl print "$DOMAIN/$LABEL" | grep -E 'state =|last exit code|path =|Hour|Minute' || echo "没有安装：$LABEL"
    ;;
  *)
    echo "用法：bash scripts/schedule.sh install | uninstall | status" >&2
    exit 2
    ;;
esac
