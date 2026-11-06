# 只读快照：对外分享（#63）

域名还没批下来前，对外分享用 Claude Artifact 上的一份只读快照：<https://claude.ai/artifact/1iKdvvQhdqQn8hqoQEAqmL>（分享设置为「拿到链接的人都能看」）。

## 出一份最新的

```bash
npm run share
```

- 本进程起一个临时网站（端口 0，不碰常驻的 5310），取发现、涨星、收藏、设置四页和全部安装指令，再下载项目头像，写到 `data/share/`（`data/` 不进仓库）。约 20 秒。
- 参数：`--data`（默认 `data`）、`--out`（默认 `<data>/share`）、`--as <账号名>`（用哪个账号打开页面，默认所有者；账号名和收藏都不进快照）。
- 头像要联网（`--use-env-proxy` 走本机代理）；下不到的那几个页面上留灰底，输出里会说。

## 发布

只导出、不发布。让 Claude 用 Artifact 工具更新上面那个链接（保留原地址）：

- 主页面：`data/share/index.html`（已去掉外层 html/head/body，Artifact 发布时会套壳）。
- 附带文件，按同名路径：`stars.html`、`favorites.html`、`settings.html`、`tidings-avatars.js`、`tidings-install.gz.txt`。

## 快照里是什么

- 访客视角：不带账号名、收藏、投票和换卡；收藏页为空，设置页只读。页头写「只读快照 · M 月 D 日」（北京时间）。
- 能用：切换近 1 / 7 / 30 天、点项目看详情、搜索、复制安装指令（整个项目和单个 Skill）。
- Artifact 只放行同源文件和 `data:`：样式脚本全内联，头像存成四页共用的 `tidings-avatars.js`，安装指令 gzip 后 base64 存成 `.txt`（Artifact 不托管 `.gz`）。页面里的垫片 `src/share/shim.js` 负责换头像、改站内链接、从快照文件取安装指令。
- 改了页面结构（页头 `<div class="r">`、`.me`、嵌入数据 `gc-data`、`/assets/` 引用方式）时，跑 `node --test test/share.test.js` 确认导出还对。
