# 名次变化、连续上榜、维护信号 · T1a / T1b 审查记录（#16）

## 结论（2026-10-24，Claude）

所有者 2026-10-24 同意开源借鉴评估推荐的三项（名次变化、连续上榜、项目页维护信号），并拍板样稿只出 1 版。这三项是在冻结的视觉系统上加新的可见元素，不是新方向：首页 t1b-r2、其余页 t1b-pages-r1 都不改，新元素只用冻结的变量和组件。样稿包 `design/candidates/signals/` 用正式的数据组装函数和真实数据生成，覆盖首页、项目页、日报三页，另有一页组件板列出全部状态，浅色和深色都有。

T1a（方向）：**DIRECTION_READY**。T1b（实现就绪）共 12 条发现：4 条已改进样稿包并复审通过，8 条不改、不适用或延后，理由写在下表。没有未处理的发现，结论为 **READY_FOR_USER_APPROVAL**。

请所有者批准的确切版本：**signals-r1，整包 sha256 `92fdbe50ec4567d537f68faa6bdc35b4aedce4b5ad9f9df40f23d2bbecaa35f3`**（清单与算法见“权威包清单”）。

## Gate 1 design-taste review record

```md
Review stage: T1a early direction check → T1b implementation-readiness
Status: current
Reviewer: design-taste-frontend（该 Skill 面向落地页；产品界面只取视觉、对比度、动效与 AI 痕迹条款）
Artifact evidence: design/candidates/signals/（index.html 首页、project.html / project-new.html / project-down.html / project-norel.html 项目页、daily.html 日报、components.html 组件板）；总览截图 docs/design/shots-t1-signals/（9 张）；本机全量截图 design/shots/signals/（25 张，不提交）
Reviewed version/hash: signals-r1 / 92fdbe50ec4567d537f68faa6bdc35b4aedce4b5ad9f9df40f23d2bbecaa35f3（建立在 t1b-r2 / ca5350ab… 与 t1b-pages-r1 / cca2bfef… 之上，两者都未改动）
Artifact maturity: high-fidelity（真实数据、正式组件函数、深浅色）
Authority package manifest/version/hash: 见下文“权威包清单”（24 个文件）
Protected concerns: stack, architecture, functionality, data/domain behavior, information architecture, SEO, content meaning/structure, component ownership, accessibility, QA gates
Design Read: 私人涨星榜上三类“事实型”小信号，加在已冻结的导读风格里（冷灰底、陶土色单一强调、宋体只给标题和阅读正文、Iowan 等宽数字）。它们不是状态（成功 / 警示 / 失败），也不是当前选择，所以不用状态色、不用强调色，只用文字灰阶和 ▲▼ 字形区分。刻度沿用 T1a：版式变化 5、动效 4、密度 5；本次不加任何新动效。
Preserve: 冻结稿一个字不动；榜单行高、名次栏宽、“并列”字样位置不变；全站一个强调色，状态色只用于状态；名字是真正的链接；明暗共用同一套变量；只动 transform 与 opacity。
Deferred dimensions: 见下文“延后项”
Recommendation: READY_FOR_USER_APPROVAL
Next owner: 所有者（批准 signals-r1 的确切版本）；批准后 #17（等 #10 关单）、#18 按这一版实现
Freshness: CURRENT for signals-r1 / 92fdbe50ec4567d537f68faa6bdc35b4aedce4b5ad9f9df40f23d2bbecaa35f3
```

## T1a 方向检查

| 维度 | 来源 | 状态 | 说明 |
|---|---|---|---|
| 结构 | 冻结稿 t1b-r2、t1b-pages-r1 | approved（继承） | 新元素只挂在已有位置：名次栏、阅读卡顶行、项目页名次胶囊、项目名下面、日报概览末尾 |
| 风格 | `design/t1b/tokens.css` | approved（继承） | 没有新变量、新颜色、新字号；`signals.css` 只引用已有变量 |
| 素材 | `design/t1b/icons.js` | approved（继承） | 提示条用已有的 calendar 图标；▲▼ 是文字字形，不是新图标 |

方向结论：**DIRECTION_READY**。生图预算为零（继承已批准的权威，不需要生成）。

## 发现与处置

“决定”取 accepted（采纳并已改）、rejected（不改）、N/A（不属于视觉权威包，或延后）。“状态”中 resolved 表示改动已进入 r1 并复审通过。

| # | 发现 | 证据 | 修改方案 | 决定 | 状态 | 处置证据 | 理由 |
|---|---|---|---|---|---|---|---|
| 1 | 项目页胶囊里持平写“–”，跟在“第 1 名”后面像个落单的标点 | 初版 `project.html` 胶囊“近 1 天第 1 名 –” | 胶囊里持平写“持平”；榜单行名次栏只有 34px 宽，仍写“–” | accepted | resolved | `4-project-light.jpg`；组件板“项目页名次胶囊” | 有空间的地方用字说清楚；读屏两处都读“和上一期名次相同” |
| 2 | 连续期数用描边小胶囊，和首页可以点的分类筛选胶囊同形，看起来能点 | 初版 `.streak` 用 `inset 0 0 0 1px var(--c-line-2)` | 改灰底不描边（`--c-sunk`），和项目页名次胶囊这类“只读信息”同一种画法 | accepted | resolved | `1-home-light.jpg`、`2-home-dark.jpg` 顶行 | 能点的和不能点的要一眼分开 |
| 3 | 日报概览写“新进前 10 的有 N 个”，和榜单行里的“新进”（上一期不在前 20）同词异义 | 初版 `daily.html` 概览 | 改成“近 1 天前 10 里有 5 个上一期不在前 10，morluto/rea 连续 2 期第 1。”，不用“新进”二字 | accepted | resolved | `7-daily-light.jpg` 概览末句 | 同一个词在一个站里只能有一个意思；所有者要的内容（几个新进前 10、谁连续第 1）不变 |
| 4 | 项目页连续期数和名次胶囊同样大小同样间距，像第四个独立胶囊，看不出它属于哪个窗口 | 初版截图三个胶囊加一个描边胶囊等距排开 | 胶囊和它的连续期数编成一组：组内间距 4px、组间 12px；连续期数降到最小一档字号、次一级灰 | accepted | resolved | `4-project-light.jpg`；组件板“项目页名次胶囊” | 从属关系靠距离和字号表达，不加线 |
| 5 | Taste 9.G 禁用 en-dash，持平记号“–”就是 en-dash | `gc.js` 的 `MV.flat` | 不改 | rejected | N/A | 所有者 2026-10-24 拍板的记号：“– 持平” | 这是数据记号，不是分隔符或装饰；产品规则由所有者定，Taste 不改内容含义 |
| 6 | “–”在 11.5px 下很轻，几乎看不见 | `1-home-light.jpg` 第 1 行 | 不改 | rejected | N/A | 对比度：浅色名次栏 4.92:1（底色）/ 5.57:1（选中行），深色 6.24:1 / 5.78:1 | 持平是信息量最低的状态，轻一点正好；对比度达标，读屏有完整说法 |
| 7 | 升降要不要用红绿 | 设计决定复核 | 不用；▲▼ 字形区分升降，“新进”用次一级灰、字重 500 | rejected | N/A | `signals.css` 开头注释 | 冻结规则：状态色只用于状态，强调色只给当前窗口和选中；红绿也对色弱不友好 |
| 8 | 切换窗口时记号直接替换，没有单独的动效 | `gc.js` `rowUpdate` | 不加 | N/A | N/A | 冻结动效：行按名次滑到新位置、新上榜的淡入，记号跟着行走 | 不加新动效；“动效只为状态变化服务”，行的位移已经表达了变化 |
| 9 | 新元素的对比度 | 计算 | 不改 | N/A | N/A | 最低一处：浅色灰底上的次一级灰字（项目页连续期数）4.53:1；深色最低 5.28:1；全部 ≥ 4.5 | 达标 |
| 10 | GitHub“最新正式版”接口只排除标了预发布的版本：有的项目把 rc 版本发成正式版（如 xerj-org/xerj 的 `v1.0.0-rc.98`），也会显示成“最新版本” | 2026-10-24 取数结果 | 不改，照 GitHub 的标记写 | N/A | N/A | 写进 #18 的注意事项 | 只写事实；“正式版”以项目作者在 GitHub 上的标记为准，不自己猜版本号 |
| 11 | “最近推送”取的是项目资料读取时的 pushedAt，不是实时 | `data/profiles/<id>.json` | 不改 | N/A | N/A | 项目页底部“依据”一行已写资料读取时间 | 和简介同一来源、同一时间点，口径一致；实时取数是 #18 的实现选择，不是视觉问题 |
| 12 | 分类筛选时，名次变化和连续期数按分类榜自己算，还是沿用总榜 | 设计决定复核 | 按分类榜自己算（分类榜第 3 名旁边写总榜的“连续第 1”会矛盾）；分类榜从 10-24 那期起才有可比的上一期 | N/A | N/A | `build.mjs` `boardAt`、`moves`、`streak` 的 cat 参数；`3-home-d7-nopre-light.jpg` 同类提示条 | 写进 #17 的实现原型 |

## 审查依据与检查

- **冻结稿未动**：`git diff --stat 6cf1b5b -- design/t1b design/t1b-pages` 为空；`signals/assets/tokens.css` 与 `design/t1b/tokens.css` 一致。
- **只读正式数据**：`build.mjs` 只调读取函数（`homeData`、`projectData`、`dailyData`、`findSnapshot`、`readCandidates`、`findProfile`），不调 `buildDaily`，不写 `data/`；日报读的是正式 data 里已有的 `data/daily/2026-10-23.json`（#11 已生成）。
- **只用已提交的代码**：拼装时工作区里有别人未提交的 `src/web/` 改动（#10 进行中），样稿用 `git archive 6cf1b5b src` 导出的干净副本拼（`SIGNALS_SRC`），资源副本也取自 6cf1b5b。
- **副本改动范围**：`assets/` 里只有三处改动，其余文件与 6cf1b5b 的 `src/web/assets/` 一字不差：`gc.js`（+9 −2：`mvHTML`、行里的 `.mv-slot`）、`home.js`（+2 −1：阅读卡顶行加连续期数）、`project.js`（+7 −2：名次胶囊、维护信号行）。新文件：`signals.css`（新样式）、`sample.js`（`?theme=` 切深浅色）、`board.js`（组件板）。
- **真实数据覆盖**：近 1 天 10-23 对比 10-22，四种记号都有真实例子（rea 持平、peach ▲1、cleanyourtv ▼1、dsh-purge 新进、graphify ▼10），rea“连续 2 期第 1”；近 7/30 天和全部分类榜按规则显示“没有上一期，暂不显示名次变化。”；维护信号三种写法里，“有正式版”和“还没发过正式版”是真实项目（rea、peach），“未知”用 `?state=unknown` 演示。
- **AI 痕迹**：没有新颜色、新字体、装饰点、渐变或新动效；新增文字全部是功能性说法；中点只沿用原有的“第 1 名 · 近 1 天”一处。
- **键盘与读屏**：记号旁的读屏文字写完整说法（“比上一期升 3 名”“上一期不在前 20”“和上一期名次相同”）；版本号链接有焦点外框，跟随圆角。

## 延后项

| 维度 | 状态 | 说明 |
|---|---|---|
| 生产实现 | DEFERRED | #17 等 #16 批准且 #10、#11 关单；#18 等 #16 批准 |
| 近 7/30 天与分类榜带记号的真实样子 | DEFERRED | 10-24 那期出榜后才有；组件板用示例数据画出了同一组件的全部状态 |
| 运行态视觉（T2） | DEFERRED | 实现后按批准版本做 |

## 实测与证据（r1）

- 拼装：`SIGNALS_SRC=<6cf1b5b 导出目录> node design/candidates/signals/build.mjs` 生成 7 个页面；版本数据 `releases.json` 于 2026-10-24 02:43 UTC 用 `--fetch` 从 GitHub 取得（4 个项目，只读，零费用）。
- 截图：本机无头 Chrome 打开 `file://` 页面（不起服务，不碰 5310/5311/5313），1440 宽深浅色各 11 张、1280 宽 3 张，共 25 张，页面没有脚本错误；总览 9 张在 `docs/design/shots-t1-signals/`。
- 1280 宽：阅读卡顶行（名次、连续期数、新增）不折行；项目页维护信号一行放得下。

本机打开：直接用浏览器打开 `design/candidates/signals/index.html`（其余 `project.html`、`project-new.html`、`project-down.html`、`project-norel.html`、`project.html?state=unknown`、`daily.html`、`components.html`；加 `?theme=dark` 看深色；首页可加 `?w=d7`、`?cat=Agent%20%2F%20MCP`、`?sel=debpalash/VoiceStudio`）。

## 权威包清单（signals-r1）

整包校验码算法：在 `design/` 目录下按路径排序后逐个算 sha256，再对这份清单整体算 sha256。

```sh
cd design && find candidates/signals -type f | LC_ALL=C sort | xargs shasum -a 256 | shasum -a 256
```

整包 sha256：`92fdbe50ec4567d537f68faa6bdc35b4aedce4b5ad9f9df40f23d2bbecaa35f3`

| 文件 | 角色 | sha256 |
|---|---|---|
| candidates/signals/index.html | 标准页：首页（生成） | e364ddc9b90344ee9d3f7b4fe53be9a05e3b1af167a4d6dfd2f4957ead22dd74 |
| candidates/signals/project.html | 标准页：项目页 morluto/rea，持平、连续 2 期第 1、有正式版（生成） | 44a2eb021f549a31aa5d282e7812fa1dc5f8c97bc0f587c5006e1f2eb9a3f1bb |
| candidates/signals/project-new.html | 项目页：新进（生成） | d2172e17d1cd1b5ac755cc9ed4a4e9d37c4e206ffbf71931b1d57b9d1a6aa301 |
| candidates/signals/project-down.html | 项目页：降 10 名（生成） | 866f3a9a4a15aea4801b4abdf2ac46019ffc63534d751b1ee287b25df0164c45 |
| candidates/signals/project-norel.html | 项目页：还没发过正式版（生成） | de8b9dee04f1770df5f50f7dbb8a31c9f526a50d76c1c3425677d2dbc28db320 |
| candidates/signals/daily.html | 标准页：日报，概览末句（生成） | d30b24b1d73f4eb88de01a76f69265d52bdd0e3ef15cbe03aa89c784f38a575b |
| candidates/signals/components.html | 组件板：全部状态（生成） | 15c868562dc5cc19388a7e7f69d96ba4c59d466b25c2802e6379374242483559 |
| candidates/signals/components.tpl.html | 组件板模板 | a0fb54f61caed729fa8fb06f86c6a48f7de2d0d2b49029d465bf572fbed41475 |
| candidates/signals/build.mjs | 拼装脚本；名次变化、连续期数（#17）与维护信号（#18）的算法原型 | f49abe160e2fc5522b5496d2c2e3d46c7996f832bececfe1b1e5f6b01d321898 |
| candidates/signals/releases.json | 样稿项目的最新正式版（2026-10-24 取自 GitHub） | ffaa400d2792451e26ad8f4cbea80323e8674f6f3930ea85114c04ad101e66d6 |
| candidates/signals/assets/signals.css | 新样式（只用冻结变量） | c01597d7ed84fd065f51f20b31a1afd7849c7c3f738f6d7d856383c686c5bac2 |
| candidates/signals/assets/gc.js | 6cf1b5b 副本，加名次变化记号 | bdfea30548fea65bafb5a5122dd3f7b8c385d1d08ec706b9d6fd16efcf8b90df |
| candidates/signals/assets/home.js | 6cf1b5b 副本，阅读卡顶行加连续期数 | e75ffb9dc1721f8b521146d88acde63eedc16c5b2e5fe13cd537730147483575 |
| candidates/signals/assets/project.js | 6cf1b5b 副本，名次胶囊与维护信号 | 17cd0315723abb8596ae4badb4ebc01aa88d10100675d5905bf9f4148c2e3e54 |
| candidates/signals/assets/board.js | 组件板画法（用同一套组件函数） | 86da3250405677d7fea4791c50eccdb2e972c6aa076c03075867c96677c22f66 |
| candidates/signals/assets/sample.js | 样稿用：`?theme=` 切深浅色 | adc752977b7ee6d0756fc10a70a09ca4be3f07d20139ca05faf8c75b0ddf6873 |
| candidates/signals/assets/tokens.css | 6cf1b5b 副本，未改（与 t1b/tokens.css 一致） | 3cbfd7f21d341278eedb51c02b36970a7ecedc5db9a5c79e04f161e47ab95925 |
| candidates/signals/assets/components.css | 6cf1b5b 副本，未改 | e7c9e95989f9dc0c9246cbfad96e3c2ddbd3735a06f6c116008f5340b630a850 |
| candidates/signals/assets/pages.css | 6cf1b5b 副本，未改 | 700e1350b63458a9166dc1ebf972b3ee92d2601cfc62a728f7bc6aa2133d47dc |
| candidates/signals/assets/pages.js | 6cf1b5b 副本，未改 | 79e02187a724bd6593bc49a7c4d3713a7e354de938be09798e2c0264dad20c72 |
| candidates/signals/assets/daily.js | 6cf1b5b 副本，未改 | 5ef5a21a0dc4616d9a4ab29b16417654cf77b19d55e21a08fcc4a46c4430436b |
| candidates/signals/assets/icons.js | 6cf1b5b 副本，未改 | 2fa9040de4ae2e542ccda736b301fa7bc3420aaf6a8aa2f2f97d8e9b7a3df88f |
| candidates/signals/assets/icons-LICENSE.txt | 6cf1b5b 副本，未改 | 60e0b68c0f35c078eef3a5d29419d0b03ff84ec1df9c3f9d6e39a519a5ae7985 |

`design/candidates/signals/` 里任何一个文件改动（包括用新一期数据重新拼装）都会使本审查与批准失效，需要重新过 T1b 并重新批准。

## 常浩 visual-direction approval record

```md
Decision: 待批准
Approved package: signals-r1 / 92fdbe50ec4567d537f68faa6bdc35b4aedce4b5ad9f9df40f23d2bbecaa35f3
Date:
Conversation evidence:
```
