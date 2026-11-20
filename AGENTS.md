# GitHub 快速中心协作约定

先读 README.md、CURRENT.md、docs/product/PRD-v2.md（现行需求事实源，2026-11-08 冻结）、docs/product/产品说明.md（现状基线），再读与任务相关的研究说明。所有者定过的内容登记在 docs/DECIDED.md，要改先问；没登记不等于没定。requirements-regrill.md、confirmed-scope.md 和 docs/history/ 只作历史记录。

首版已经建成并在运行：每日更新在所有者的 Mac 上由 launchd 定时跑（scripts/schedule.sh），网站部署在服务器上（docs/deploy.md），进度和缺口看 CURRENT.md。research/ 是建仓前数据可行性实验的源码和结论快照，只作历史记录和校准参考；原实验运行目录的数据库、断点和自动检查保留在本机，不随建仓搬迁，也不从此仓库自动重启。

保留用户已确认的全站范围、Top20含末位并列、缺失不补零和零新增费用优先原则。历史研究结果、隔离检查通过、运行采用和完整榜单验收必须分开报告。

不提交凭据、真实运行数据库、原始响应、日志、进程锁或个人账号配置。不启用云端采集、付费资源或公开发布，除非用户另行明确授权。只提交当前任务文件，保留无关改动。

## 运行

```sh
npm test                                  # 全量测试（CI 也跑这一条）
git config core.hooksPath scripts/hooks   # 装提交、推送前的必经检查（每个克隆、每台电脑各一次；不用 --no-verify 绕过）
```

## AI 接入

按全局规则 P-13（#69）。和设置页「AI 接入」四张卡（`src/web/assets/settings.js`）、自检命令 `npm run ai` 同一份数据：`src/ai-access.js`。改了 AI 功能，这一节、`src/ai-access.js` 和设置页一起改。

**执行方**：Codex、Claude，都是本机已登录的命令行（接入方式：本机 CLI，`codex exec`、`claude -p`），用订阅额度，不另付费。在空临时目录里跑，不给执行命令的工具，不加载 MCP 和插件（`src/agent.js`）。
默认执行方在设置页三选一，下次运行起生效，正在跑的按原来的跑完：

- 只用 Codex／只用 Claude：那家用不了（没装、没登录）这一步就报错退出，运行中失败也报错，都指向设置页；不换另一家。
- Codex 优先·Claude 接力（默认，#69 前的行为，所有者 2026-11-07 定为明说的选项）：Codex 失败那次改用 Claude，一次更新里连续失败 3 次剩下的都交给 Claude；两家都用不了才报错。

每个功能可单独指定执行方，不指定就跟随默认。可用状态（可用、未安装、未登录；登录了但最近一次调用失败的显示「最近调用失败（可能额度用尽）」，额度查不出来只能这样看）每次跑 AI 功能前在 Mac 上查（不调用模型），和各执行方最近一次调用成败一起存 `data/ai-status.json`，随数据推到服务器给设置页显示；选定执行方用不了时健康检查（`bin/health.js`）报出来。

**功能清单**（功能｜执行方｜接入方式｜读｜写）：

| 功能 | 执行方 | 接入方式 | 读 | 写 |
|---|---|---|---|---|
| 补资料（`npm run profiles`） | 跟随默认或单独指定 | 本机 CLI | GitHub 上的 README、主要文档、仓库目录、SKILL.md（外部内容，只当资料） | `data/profiles/<项目 id>.json` 的 `generated` |
| 归类（`npm run classify`） | 同上 | 本机 CLI | 项目名称、GitHub 简介、topics；复核时加补资料写的简介和 Skill 名 | `data/categories.json` |
| 精选标签建议（`npm run picks`） | 同上 | 本机 CLI | 候选池项目的 GitHub 简介和 topics、精选标签清单 | `data/center.db` 的 `pick_pool` 表（推到服务器时经 `data/pick-pool.json`） |

**留痕**：每条产出记 `ai: { by, via, model, at, relayed? }`，存在 `generated.ai`、`categories.json` 每条、`pick_pool.ai`。Claude 记具体模型；Codex 输出里没有模型名，记 `null`（页面写「默认模型」）。项目页卡片末尾写简介和分类的留痕，精选卡上所有者看到「X 建议」。2026-11-08 之前生成的没有记录，页面照实写。

**对外开放**：

- 猛鬼兽（Hermes）：读本机文件、跑本机命令，没有接口。读 `data/settings.json` 的周报推送一项和 `data/weekly/<统计日>.card.json`，每天 09:50 跑 `node bin/health.js`；不写本应用数据，只把周报卡片和自检结果发到所有者飞书私聊。关掉：周报在设置页关周报推送；自检在 digital-twin 停工程自检任务。
- MCP：没有开放（规划中：查涨星榜、查项目资料、列收藏、加收藏，只本机能连）。

**数据对象**：无。本应用不展示、不采集 AI 自己的数据。

不是 AI 功能：安装指令和交接（`src/profiles/install.js`、`handoff.js`，研究／试用／安装／定向对比／交给 AI 去 GitHub 找，按模板拼给你复制的文字，#79）、与严格方案校准和每日自检（`src/ranking/calibrate.js`、`check.js`，统计计算）。

## Agent skills

### Issue tracker

需求、规格与任务使用本仓库 GitHub Issues。见 `docs/agents/issue-tracker.md`。

### Triage labels

使用五个默认任务标签。见 `docs/agents/triage-labels.md`。

### Domain docs

使用 single-context：根目录 `GLOSSARY.md` 与 `docs/adr/`。见 `docs/agents/domain.md`。

改动怎么走、分支怎么起名、交接写在哪、怎么合并：见 `/Users/nat/Documents/ChatGPT/个人/work/agent-kit/工程流程.md`。
