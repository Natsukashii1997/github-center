#!/bin/bash
# 每日出榜定时任务（本机 launchd）：bash scripts/schedule.sh install | uninstall | status
# 属于本机常驻配置，安装前须所有者同意。
# 每天北京时间 10:00 跑一次 npm run rank：统计日按 UTC 划分，北京时间 08:00 才结束，事件文件还要晚 1 小时左右才齐。
# 只出最近一个已结束的统计日；已发布的榜单不重跑，和手动重跑撞上也安全。电脑在 10:00 睡着时，醒来后补跑。
# 出完榜接着跑 npm run profiles：给榜单上首次出现或资料有变的项目生成项目资料（用本机已登录的 Codex CLI）。
# 再跑 npm run classify：给这一期各榜单涉及的项目归类，榜上项目用项目页资料复核（#10，同样用本机 Codex CLI）。
# 再跑 npm run daily：按近 1 天这一期写日报和飞书消息内容（#11，查上榜项目的官方 Release；本仓库不发送）。
# 最后跑 npm run calibrate：严格方案有新结果就出校准报告（只读严格实验目录）。
set -euo pipefail

LABEL=cn.github-center.rank
ROOT=$(cd "$(dirname "$0")/.." && pwd)
PLIST="$HOME/Library/LaunchAgents/$LABEL.plist"
DOMAIN="gui/$(id -u)"

case "${1:-}" in
  install)
    NODE=$(command -v node)
    GH=$(command -v gh)
    CODEX=$(command -v codex)
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
  <array><string>/bin/sh</string><string>-c</string><string>'$NODE' --use-env-proxy bin/rank-day.js; '$NODE' --use-env-proxy bin/profiles.js; '$NODE' --use-env-proxy bin/classify.js; '$NODE' --use-env-proxy bin/daily.js; '$NODE' bin/calibrate.js</string></array>
  <key>WorkingDirectory</key><string>$ROOT</string>
  <key>EnvironmentVariables</key>
  <dict><key>PATH</key><string>$(dirname "$NODE"):$(dirname "$GH"):$(dirname "$CODEX"):/usr/bin:/bin</string>$PROXY</dict>
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
