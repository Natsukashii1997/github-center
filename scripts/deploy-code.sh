#!/bin/bash
# 把代码发到服务器并重启网站（#46，见 docs/deploy.md）：bash scripts/deploy-code.sh [提交，默认 origin/main]
# 只发仓库里的文件（git archive），不碰服务器上的 data/；连接配置读 data/remote.json。
set -euo pipefail
cd "$(dirname "$0")/.."
REF=${1:-origin/main}
read -r SSH KEY DIR < <(node -e 'const c=JSON.parse(require("fs").readFileSync("data/remote.json","utf8"));console.log(c.ssh,(c.key||"").replace(/^~(?=\/)/,require("os").homedir()),c.dir)')
git fetch -q origin
echo "发 $(git rev-parse --short "$REF") 到 $SSH:$DIR"
git archive --format=tar "$REF" | /usr/bin/ssh -i "$KEY" -o IdentitiesOnly=yes -o BatchMode=yes "$SSH" \
  "set -e; mkdir -p '$DIR/data'; tar x -C '$DIR'; chown tidings:tidings '$DIR/data'; systemctl restart tidings; sleep 1; systemctl is-active tidings"
