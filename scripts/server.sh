#!/bin/bash
# 服务器上（#46，部署见 docs/deploy.md）：Mac 的每日更新经 ssh 调这里（src/remote/index.js），以 root 登录，读写库都切到网站的账号 tidings，
# 免得库的 -wal、-shm 文件变成 root 的、网站写不进去。
#   bash scripts/server.sh settings     打印服务器上的设置（没存过就什么都不打）
#   bash scripts/server.sh picks-state  打印精选标签清单和固定的卡（JSON）
#   bash scripts/server.sh apply        Mac 推完数据后：数据交给 tidings，把 data/pick-pool.json 写进库并补卡
#   bash scripts/server.sh backup       把库做一份一致的副本（sqlite3 .backup）原样打到标准输出，Mac 存成备份（#48）
#   bash scripts/server.sh status       网站服务在不在跑（systemctl is-active），健康检查用（#48）
#   bash scripts/server.sh version      服务器上的代码是哪个提交（发布时写的 VERSION，没有就什么都不打），健康检查用（#105）
set -euo pipefail

ROOT=$(cd "$(dirname "$0")/.." && pwd)
NODE=${NODE:-/opt/node24/bin/node}
USER_=${SITE_USER:-tidings}
as_site() { runuser -u "$USER_" -- "$@"; }
cd "$ROOT"

case "${1:-}" in
  settings)
    [ -f data/settings.json ] && cat data/settings.json || true
    ;;
  picks-state)
    as_site "$NODE" bin/picks.js --state
    ;;
  apply)
    chown -R "$USER_:$USER_" data
    as_site "$NODE" bin/picks.js --apply
    ;;
  backup)
    tmp=$(mktemp -d)
    trap 'rm -rf "$tmp"' EXIT
    chown "$USER_:$USER_" "$tmp"
    as_site sqlite3 data/center.db ".backup '$tmp/center.db'"
    cat "$tmp/center.db"
    ;;
  status)
    systemctl is-active tidings || true
    ;;
  version)
    [ -f VERSION ] && cat VERSION || true
    ;;
  *)
    echo "用法：bash scripts/server.sh settings | picks-state | apply | backup | status | version" >&2
    exit 2
    ;;
esac
