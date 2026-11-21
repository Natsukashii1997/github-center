# 放到服务器上（#46）

网站在阿里云轻量服务器上跑，用 https://tidings.natsukashii.cn 打开，要登录。每日更新照旧在 Mac 上跑（大陆服务器连不上 GitHub、GH Archive、OpenAI），跑完把数据推到服务器；Mac 关机时网站照常打开，显示最后一次推上去的数据。

## 谁写什么

| 数据 | 谁写 | 怎么同步 |
|---|---|---|
| 榜单、快照、候选、资料、归类、周报、status.json 等 | 只有 Mac | 每日更新最后一步 rsync 推上去（只增改，不删服务器上的文件） |
| `settings.json` | 服务器的设置页 | 每日更新开头从服务器拉回 Mac |
| `center.db`：账号、会话、收藏（含决策状态、理由、下一步、最近交接，#78）、精选标签、换卡、投票 | 服务器的网页 | 不推、不覆盖 |
| `center.db`：精选榜候选池和 Codex 建议的标签 | Mac 的精选榜步骤 | 先拉服务器的标签清单和固定的卡，算完写 `pick-pool.json` 推上去，服务器写库并补卡 |
| `runs/`、`logs/`、`update-state.json` | Mac | 不推 |
| 服务器 `center.db` 的备份 | Mac 拉回 | 每日更新最后一步推完后，存 `data/backups/center-<日期>.db`，留 14 份（#48） |

代码在 `src/remote/`、`bin/push.js`、`bin/health.js`、`scripts/server.sh`。

## 服务器布局

- 代码 `/srv/tidings`（root 所有），数据 `/srv/tidings/data`（网站账号 `tidings` 所有）。
- Node 24 在 `/opt/node24`（系统自带的 Node 不用）。
- 网站：systemd `tidings`（`deploy/tidings.service`），只监听 127.0.0.1:5310，带 `--origin https://tidings.natsukashii.cn`，不加 `--guest`。
- 反向代理：Caddy（`deploy/Caddyfile`），自动 HTTPS。
- Mac 用专用密钥 `~/.ssh/github_center_aliyun` 以 root 登录；Mac 的 `data/remote.json`（不入库）：

```json
{ "ssh": "root@47.100.185.175", "key": "~/.ssh/github_center_aliyun", "dir": "/srv/tidings", "url": "https://tidings.natsukashii.cn" }
```

  `url` 可不填，只给健康检查探测域名用（#105）；不填就不探测。
- 代码目录里的 `VERSION`：发代码时写的「提交全 sha 发布时间（UTC）」一行（#105），`bash scripts/server.sh version` 打印它。健康检查靠它知道服务器跑的是哪个提交。

## 常用操作

发代码（合并到 main 之后）：

```bash
bash scripts/deploy-code.sh
```

默认发 `origin/main`，也可以在后面写一个提交。发完会写 `VERSION`；只增改、不删服务器上的旧文件。

手动推一次数据：

```bash
node bin/push.js
```

在服务器上开账号（伙伴）：

```bash
ssh -i ~/.ssh/github_center_aliyun root@47.100.185.175 'cd /srv/tidings && runuser -u tidings -- /opt/node24/bin/node bin/account.js add <名字> --partner'
```

看网站日志：`journalctl -u tidings -n 50`。

健康检查（#48，猛鬼兽每天 09:50 工程自检调用，没问题不输出）：

```bash
node bin/health.js
```

检查每日更新多久没跑、有没有卡住或失败的步骤、服务器上的网站在不在跑、库的备份是否超过 2 天、涨星榜前 5 天有没有缺期（#103）。配了服务器时还查两件（#105）：

- 域名能不能打开（`data/remote.json` 填了 `url` 才查）：请求 `<url>/login`，拿到本站登录页算通；https 连不上再请求一次 http，认得出阿里云的未备案拦截页（403「Non-compliance ICP Filing」），其余报状态码或错误。每次最多等 15 秒，不走代理。用的是 Node 的 fetch，它和 Chrome 一样能打开 https（2026-11-21 实测，curl 被重置），所以这一项回答的是「新式浏览器能不能打开」。
- 服务器代码落后本机 `main` 多少：读服务器的 `VERSION`，只数改了 `src bin scripts deploy package.json` 的提交，只差文档不报；落后就给出发布命令。服务器上没有 `VERSION`（早于 #105 发的代码）时提示重新发一次。服务器连不上时这项不查。

Mac 一直关机时这条也跑不了，靠网站上写明的数据日期。

从备份恢复服务器的库（先停网站）：

```bash
scp -i ~/.ssh/github_center_aliyun data/backups/center-<日期>.db root@47.100.185.175:/srv/tidings/data/center.db.restore
ssh -i ~/.ssh/github_center_aliyun root@47.100.185.175 'cd /srv/tidings/data && systemctl stop tidings && rm -f center.db-wal center.db-shm && mv center.db.restore center.db && chown tidings:tidings center.db && systemctl start tidings'
```

## 注意

- 服务器在中国大陆，域名要做 ICP 备案；没备案时阿里云随时可能拦掉域名的访问。（2026-11-17 已被拦：http 返回「Non-compliance ICP Filing」，curl 访问 https 被重置。2026-11-21 实测 Chrome 和 Node 24 的 fetch 能正常打开 https，curl 仍被重置，http 仍是拦截页；原因推测是拦截按握手包里的域名识别，没抓包证实。）
- SSH 只能用密钥登录（2026-11-17 起，`/etc/ssh/sshd_config.d/00-hardening.conf`）；换电脑先把新公钥加进 `/root/.ssh/authorized_keys`，进不去时用阿里云控制台的 VNC。
- 在服务器上读写库一律切到 `tidings`（`runuser -u tidings`），不要用 root 直接开库：root 建出的 `-wal`、`-shm` 文件网站写不进去。
- Mac 上原来的本机网站（免登录）还能开，但设置会被每日更新拉回的服务器设置覆盖；以服务器为准。
