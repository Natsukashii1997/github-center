# Github·Tidings（GitHub 快速中心）

个人自用、可以给伙伴开账号的 GitHub 生态情报与能力选型中心。每天自动出涨星榜和几个发现榜，给上榜项目配中文简介、使用条件和 Skill 列表；看中的项目可以收藏、标决策状态，再用「交给 AI」把研究、试用、安装交给自己的 Claude Code 或 Codex。

**现状**：首版功能已经建成并每天在跑，还没有通过所有者的真实使用验收（#15）。进度、缺口和下一步只看 [CURRENT.md](CURRENT.md)，这里不重复。

## 从这里开始

按这个顺序读：

1. [AGENTS.md](AGENTS.md)：协作约定、不能碰的边界、AI 接入。
2. [CURRENT.md](CURRENT.md)：现在跑成什么样、主线、未完事项。
3. [产品说明](docs/product/产品说明.md)：现状基线。第 6 节是各页面功能，第 7 节是数据方法，第 8、9 节是每日运转和架构。
4. [PRD v2.1](docs/product/PRD-v2.md)：现行需求事实源（2026-11-08 冻结），讲接下来要做成什么。
5. [GLOSSARY.md](GLOSSARY.md)：术语，末尾「代码里的名字」是术语和字段名、目录名的对照。
6. [docs/DECIDED.md](docs/DECIDED.md)：所有者定过的内容，要改先问。没登记不等于没定。
7. 按需：[ADR 0001 涨星榜做法](docs/adr/0001-fast-star-ranking.md)、[ADR 0002 前端不用框架](docs/adr/0002-frontend-without-framework.md)、[部署](docs/deploy.md)、[白雾定稿（视觉规范）](docs/design/白雾定稿.md)、[分享页](docs/share.md)、[周报与猛鬼兽的约定](docs/handoff/weekly-hermes.md)、[踩过的坑](docs/LESSONS.md)。

任务在 [GitHub Issues](https://github.com/Natsukashii1997/github-center/issues)。

## 系统怎么转

```
上游（GitHub、GH Archive、ClickHouse、skills.sh、HN、V2EX）
        │
        ▼
Mac：每日更新（launchd 定时，bin/update.js 按顺序跑十步）
        │   其中三步调本机已登录的 Codex / Claude 命令行
        ▼
data/（JSON 快照 + SQLite，不入库）──► 本机网站 127.0.0.1:5310
        │ rsync 推送
        ▼
服务器：同一套网站代码，要登录；账号、收藏、精选、投票写在服务器的库里
        ▲
猛鬼兽（Hermes）读周报卡片发飞书，每天跑一次健康检查
```

- **采集在 Mac，不在服务器**：大陆服务器连不上 GitHub、GH Archive 和 OpenAI。Mac 关机时网站照常能开，显示最后一次推上去的数据。
- **十步的顺序**：出榜 → 全站 Star 前 100 → 历史榜（Skill 安装量）→ 热点榜 → 精选榜 → 补资料 → 归类 → 周报 → 校准报告 → 推到服务器并备份库。定义在 [src/update-steps.js](src/update-steps.js)，每步的命令和产出见产品说明第 8 节。一步失败照样跑后面的，失败的当天重试。
- **谁写哪份数据**：榜单、资料、归类只有 Mac 写；设置在服务器的设置页改，每日更新开头拉回 Mac；账号和收藏只在服务器的库里，不推、不覆盖。完整的表在 [docs/deploy.md](docs/deploy.md)「谁写什么」。
- **涨星榜怎么算**：全站事件数据和官方热门榜找候选，GitHub 官方星数历史核数，每日自检估计漏失概率，前 20 含末位并列，缺失不补零。见 ADR 0001。

## 代码地图

| 位置 | 管什么 |
|---|---|
| `bin/` | 命令入口，每个文件对应一条 `npm run`；`update.js` 是每日更新的总入口 |
| `src/update-steps.js` | 每日更新的十步、到点判断、当天重试 |
| `src/ranking/` | 涨星榜：统计日（`stat-day.js`）、找候选（`sources.js`）、官方核数和出榜（`rank-day.js`）、自检（`check.js`）、名次变化（`moves.js`）、校准（`calibrate.js`） |
| `src/boards/` | 发现页的几块：历史榜、热点榜、精选榜，和给精选榜当候选池的全站 Star 前 100 |
| `src/profiles/` | 项目资料：读项目原文、生成简介和使用条件、安装指令和交接文字 |
| `src/categories/` | 把项目归进 9 个分类，按分类筛榜 |
| `src/agent.js`、`src/ai-access.js` | 调本机 Codex / Claude 命令行；AI 接入的清单和可用状态 |
| `src/settings/` | 设置的默认值、校验和读写 |
| `src/web/` | 网站：`server.js` 是路由和接口，其余文件把数据整理好嵌进页面；`assets/` 是浏览器端的样式和脚本 |
| `src/weekly/`、`src/share/` | 周报和飞书卡片；导出只读分享页 |
| `src/remote/` | 和服务器同步：拉设置、推数据、备份库；健康检查的判断也在这里 |
| `scripts/` | launchd 安装（`schedule.sh`）、服务器端脚本（`server.sh`）、发代码（`deploy-code.sh`）、提交和推送钩子 |
| `test/` | 全量测试，不联网；上游数据用 `test/fixtures/upstream/` 里录制的 |
| `design/`、`docs/design/` | 设计候选稿、审查记录和截图 |
| `research/`、`docs/history/` | 建仓前的数据可行性实验和早期交接，只作历史记录 |

### 名字容易误会的地方

这些是现在代码里的实际情况，读代码前先知道，能省不少时间：

- **`src/boards/history.js` 不是产品里的「历史榜」**。它是 GitHub 全站 Star 前 100，现在只给精选榜当候选池、不展示。产品里的「历史榜」（按 Skill 安装量）在 `src/boards/skills.js`。
- **`hot` 有两个意思**。`src/ranking/rank-day.js` 里的 `hotPage`、`hot` 指 GitHub 官方热门榜（trending）；`src/boards/hot.js` 是 Hacker News 和 V2EX 的热点榜。
- **三个 `codex.js` 不只管 Codex**。`src/profiles/codex.js`、`src/categories/codex.js`、`src/boards/picks-codex.js` 是补资料、归类、精选标签的提示词和输出格式，实际由哪家执行看设置页「AI 接入」。
- **`src/ranking/store.js` 是全项目的文件存储**。`readJson`、`writeAtomic`、快照读写都在这里，设置、调度、资料、周报都用它。并发工具 `mapLimit` 在 `src/ranking/rank-day.js`。
- **`src/web/home.js` 不只是首页**。它同时放着涨星页的数据、各页共用的项目卡转换和 HTML 外壳（`frame`）。
- **榜单在代码里有三个词**。windows 是涨星榜的三个窗口（`d1`、`d7`、`d30`），lists 是新项目榜、官方热门榜、累计高星榜（`new`、`trending`、`top`），boards 是 `history`、`skills`、`hot`、`picks`；存快照时统一叫 board。
- **`daily` 有两个意思**。设置里的 `daily` 是每日更新的开关和时间；`data/daily/` 和 `/daily` 地址是 2026-11-03 已删除的日报留下的。
- **前端文件名是缩写**。`bw.js`、`bw.css` 是白雾定稿的共用组件，`ho.js` 是决策状态和交接，`gc.js` 是只剩登录页在用的旧组件。

## data/ 目录

运行数据全在 `data/`，不入库。只读不要紧，下面标了哪些会被命令改写。

| 路径 | 内容 | 谁写 |
|---|---|---|
| `snapshots/<榜>/<日期>.json` | 每期榜单的快照，只写一次、不覆盖。`d1` `d7` `d30` `new` `top` `trending` 按统计日存；`history` `skills` `hot` 按抓取那天（UTC）存 | 出榜和各榜步骤 |
| `candidates/<窗口>/<统计日>.json` | 涨星榜每期全部已核数候选，分类榜从这里重新取前 20 | 出榜 |
| `events/<日期>.json` | 每天全站 Star 事件按项目合计，只用来找候选和自检 | 出榜 |
| `runs/<运行号>/raw/` | 每次运行的上游原始响应，榜上数字的证据；不推服务器，目前没有清理 | 出榜、补资料、归类 |
| `profiles/<项目 id>.json` | 项目资料和生成依据 | 补资料 |
| `categories.json` | 每个项目的分类 | 归类 |
| `center.db` | 账号、会话、收藏、精选标签和卡、投票。本机和服务器各有一份，互不覆盖 | 网站；精选榜步骤 |
| `pick-pool.json` | 精选榜候选池，推到服务器后由服务器写进库 | 精选榜 |
| `weekly/` | 每期周报、飞书消息和卡片 | 周报 |
| `status.json` | 每个榜单最近一次更新的成败，网站据此提示 | 出榜和各榜步骤 |
| `update-state.json`、`logs/update.log` | 每日更新今天跑没跑、哪步失败 | `bin/update.js` |
| `settings.json` | 设置页存的设置；没存过就没有这个文件，用默认值 | 设置页 |
| `ai-status.json` | 两家 AI 命令行的可用状态和最近一次调用成败 | AI 步骤、`npm run ai` |
| `remote.json` | 服务器连接配置；没有它就只在本机跑 | 手写 |
| `backups/` | 服务器库的每日备份，留 14 份 | 推送步骤 |
| `share/` | 导出的分享页 | `npm run share` |
| `evidence/` | 验收和排查留的证据 | 人和 AI 手动放 |
| `daily/` | 已停用的日报留下的两个文件 | 无 |

## 常用命令

```sh
npm test                           # 全量测试，不联网、不写 data/
npm run ai                         # 打印 AI 接入现状（会刷新 data/ai-status.json）
node bin/health.js                 # 健康检查，没问题不输出
bash scripts/schedule.sh status    # 两个 launchd 任务的状态
npm run serve                      # 本机起网站，默认 127.0.0.1:5310
```

下面这些会联网、会写 `data/`，其中补资料、归类、精选榜还会用 Codex 或 Claude 的订阅额度。平时由定时任务跑，手动跑之前先想清楚：

```sh
npm run update                     # 整套每日更新（十步）
npm run rank                       # 只出榜；已发布的期次不会重跑
npm run profiles                   # 补资料
npm run classify                   # 归类
npm run picks                      # 精选榜
bash scripts/deploy-code.sh        # 把 main 的代码发到服务器
```

第一次克隆后装提交和推送前的检查：`git config core.hooksPath scripts/hooks`。

## 边界

不提交凭据、真实运行数据库、原始响应、日志和个人账号配置；不启用云端采集、付费资源或公开发布，除非所有者另行明确授权。完整约定见 [AGENTS.md](AGENTS.md)。
