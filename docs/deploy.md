# 放到服务器上（#46）

网站在阿里云轻量服务器上跑，用 https://tidings.natsukashii.cn 打开，要登录。每日更新照旧在 Mac 上跑（大陆服务器连不上 GitHub、GH Archive、OpenAI），跑完把数据推到服务器；Mac 关机时网站照常打开，显示最后一次推上去的数据。

## 谁写什么

| 数据 | 谁写 | 怎么同步 |
|---|---|---|
| 榜单、快照、候选、资料、归类、周报、status.json 等 | 只有 Mac | 每日更新最后一步 rsync 推上去（只增改，不删服务器上的文件） |
| `settings.json` | 服务器的设置页 | 每日更新开头从服务器拉回 Mac |
| `center.db`：账号、会话、收藏、精选标签、换卡、投票 | 服务器的网页 | 不推、不覆盖 |
| `center.db`：精选榜候选池和 Codex 建议的标签 | Mac 的精选榜步骤 | 先拉服务器的标签清单和固定的卡，算完写 `pick-pool.json` 推上去，服务器写库并补卡 |
| `runs/`、`logs/`、`update-state.json` | Mac | 不推 |

代码在 `src/remote/`、`bin/push.js`、`scripts/server.sh`。

## 服务器布局

- 代码 `/srv/tidings`（root 所有），数据 `/srv/tidings/data`（网站账号 `tidings` 所有）。
- Node 24 在 `/opt/node24`（系统自带的 Node 不用）。
- 网站：systemd `tidings`（`deploy/tidings.service`），只监听 127.0.0.1:5310，带 `--origin https://tidings.natsukashii.cn`，不加 `--guest`。
- 反向代理：Caddy（`deploy/Caddyfile`），自动 HTTPS。
- Mac 用专用密钥 `~/.ssh/github_center_aliyun` 以 root 登录；Mac 的 `data/remote.json`（不入库）：

```json
{ "ssh": "root@47.100.185.175", "key": "~/.ssh/github_center_aliyun", "dir": "/srv/tidings" }
```

## 常用操作

发代码（合并到 main 之后）：

```bash
bash scripts/deploy-code.sh
```

手动推一次数据：

```bash
node bin/push.js
```

在服务器上开账号（伙伴）：

```bash
ssh -i ~/.ssh/github_center_aliyun root@47.100.185.175 'cd /srv/tidings && runuser -u tidings -- /opt/node24/bin/node bin/account.js add <名字> --partner'
```

看网站日志：`journalctl -u tidings -n 50`。

## 注意

- 服务器在中国大陆，域名要做 ICP 备案；没备案时阿里云随时可能拦掉域名的访问。
- 在服务器上读写库一律切到 `tidings`（`runuser -u tidings`），不要用 root 直接开库：root 建出的 `-wal`、`-shm` 文件网站写不进去。
- Mac 上原来的本机网站（免登录）还能开，但设置会被每日更新拉回的服务器设置覆盖；以服务器为准。
