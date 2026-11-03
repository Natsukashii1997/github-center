#!/bin/bash
# 服务器上（#46，部署见 docs/deploy.md）：Mac 的每日更新经 ssh 调这里（src/remote/index.js），以 root 登录，读写库都切到网站的账号 tidings，
# 免得库的 -wal、-shm 文件变成 root 的、网站写不进去。
#   bash scripts/server.sh settings     打印服务器上的设置（没存过就什么都不打）
#   bash scripts/server.sh picks-state  打印精选标签清单和固定的卡（JSON）
#   bash scripts/server.sh apply        Mac 推完数据后：数据交给 tidings，把 data/pick-pool.json 写进库并补卡
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
  *)
    echo "用法：bash scripts/server.sh settings | picks-state | apply" >&2
    exit 2
    ;;
esac
