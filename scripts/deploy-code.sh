#!/bin/bash
# 把代码发到服务器并重启网站（#46，见 docs/deploy.md）：bash scripts/deploy-code.sh [提交，默认 origin/main]
# 只发仓库里的文件（git archive），不碰服务器上的 data/；连接配置读 data/remote.json。
# 发完在服务器代码目录写 VERSION（全 sha 和发布时间），健康检查据此看服务器代码落后 main 多少（#105）。
set -euo pipefail
cd "$(dirname "$0")/.."
REF=${1:-origin/main}
read -r SSH KEY DIR < <(node -e 'const c=JSON.parse(require("fs").readFileSync("data/remote.json","utf8"));console.log(c.ssh,(c.key||"").replace(/^~(?=\/)/,require("os").homedir()),c.dir)')
git fetch -q origin
SHA=$(git rev-parse "$REF^{commit}")
AT=$(date -u +%Y-%m-%dT%H:%M:%SZ)
echo "发 ${SHA:0:7} 到 $SSH:$DIR"
git archive --format=tar "$SHA" | /usr/bin/ssh -i "$KEY" -o IdentitiesOnly=yes -o BatchMode=yes "$SSH" \
  "set -e; mkdir -p '$DIR/data'; tar x -C '$DIR'; echo '$SHA $AT' > '$DIR/VERSION'; chown tidings:tidings '$DIR/data'; systemctl restart tidings; sleep 1; systemctl is-active tidings"
