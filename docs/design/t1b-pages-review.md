# 其余 5 页视觉 · T1b 审查记录

## 结论（2026-10-24，Claude）

所有者 10-24 01:00 选定的五个版式（其他榜单版一三榜同屏、项目页版一正文加侧栏、日报版三主次结构、我的收藏版一卡片网格、登录版一左右分栏，见 `docs/design/t1a-pages-review.md` 末尾“选择记录”）已深化为高保真候选包 `design/t1b-pages/`。T1b 审查共 16 条发现：9 条已改进候选包并复审通过，7 条不改、不适用或延后，理由写在下表。没有未处理的发现，结论为 **READY_FOR_USER_APPROVAL**。

请所有者批准的确切版本：**t1b-pages-r1，整包 sha256 `cca2bfefb31ada88572de236afe96d9e559265268da3215928f8d0696c0870f4`**（清单与算法见“权威包清单”）。这个包依赖冻结的 t1b-r2（`ca5350ab…`，复核未变）：变量、组件样式、图标直接引用 `../t1b/`，不复制。

**所有者已于 2026-10-24 批准 t1b-pages-r1，这一版冻结**（批准记录见文末）。#14 按这一版实现其余 5 页。

## Gate 1 design-taste review record

```md
Review stage: T1b implementation-readiness
Status: current
Reviewer: design-taste-frontend（该 Skill 面向落地页；产品界面只取视觉、对比度、动效与 AI 痕迹条款）
Artifact evidence: design/t1b-pages/（标准页 boards.html、project.html、daily.html、favorites.html、login.html；组件板补充 components.html）；总览截图 docs/design/shots-t1b-pages/；本机全量截图 design/shots/t1b-pages/（50 张，不提交）
Reviewed version/hash: t1b-pages-r1 / cca2bfefb31ada88572de236afe96d9e559265268da3215928f8d0696c0870f4（依赖 t1b-r2 / ca5350abb9f8c84a961e12b9fd6612a52d2096f684d294da8654b2892a7ca514）
Artifact maturity: high-fidelity
Authority package manifest/version/hash: 见下文“权威包清单”（5 个标准页 + 组件板补充 + 版式样式 + 拼装脚本 + 组件脚本副本 + 示例数据，共 10 个文件；变量、组件、图标引用 t1b-r2）
Protected concerns: stack, architecture, functionality, data/domain behavior, information architecture, SEO, content meaning/structure, component ownership, accessibility, QA gates
Design Read: 私人涨星榜的 5 个次级页面，和已落地的首页同一套“导读”风格（冷灰底、陶土色单一强调、宋体只给标题和阅读正文、Iowan 等宽数字），只换版式：其他榜单三榜并排一眼扫完；项目页左读右装；日报“今天”是主角、其余收在跟随栏；收藏是工具箱网格；登录左说明右表单。刻度沿用 T1a：版式变化 5、动效 4、密度 5。
Preserve: 三榜并排各前 20、分类胶囊同筛三榜；项目页常驻侧栏（数字、走势、安装、收藏）、使用条件每条附原文、Skill 超过 8 个折叠；日报近 1 天主条目带走势、近 7/30 天与版本发布在跟随栏；收藏卡上直接复制与取消、三种异常收藏写明；登录页三句话说清来源；名字是真正的链接、焦点外框跟随整行或整卡；全站一个强调色，状态色只用于状态；明暗共用同一套变量；只动 transform 与 opacity，减少动态效果时直接切换。
Deferred dimensions: 见下文“延后项”
Recommendation: READY_FOR_USER_APPROVAL
Next owner: primary workflow（所有者已批准；#14 按这一版实现）
Freshness: CURRENT for t1b-pages-r1 / cca2bfefb31ada88572de236afe96d9e559265268da3215928f8d0696c0870f4
```

## 发现与处置

“决定”取 accepted（采纳并已改）、rejected（不改）、N/A（不属于视觉权威包，或延后）。“状态”中 resolved 表示改动已进入 r1 并复审通过。候选稿指 `design/candidates/pages/` 的选定版。

| # | 发现 | 证据 | 修改方案 | 决定 | 状态 | 处置证据 | 理由 |
|---|---|---|---|---|---|---|---|
| 1 | 候选稿没有加载、空、失败状态；能力矩阵 13 项状态里加载中、空、可能不完整、更新失败、简介生成中、登录失败都要在每套方案里表达 | 候选稿只有正常态 | 每页用地址参数 `?state=` 切换：其他榜单（loading 三栏骨架、partial、failed 提示条）；项目页（loading 骨架、generating、noprofile 资料没读到、missing 找不到、partial / failed 顶栏）；日报（loading、empty 今天还没生成、partial / failed）；我的收藏（loading 骨架卡、empty、edge 三种异常收藏）；登录（failed） | accepted | resolved | `shots-t1b-pages/4-states.jpg`；组件板“页面状态”表 | 实现时不能猜状态长什么样 |
| 2 | 候选稿紧凑行、网格卡的名字不是链接，整行靠脚本点击，键盘 Tab 到不了 | `pages.js` 候选版 `compactRow`、`gridCard` | 名字改成真正的 `<a>`，点整行仍进项目页；焦点落在链接上时外框画在整行或整卡（`:has(a:focus-visible)`），跟随各自圆角 | accepted | resolved | r1 `pages.js`、`pages.css`；组件板“键盘焦点” | 键盘必须能到每个入口；焦点外框要处处可见 |
| 3 | 项目页 Skill 列表最多 200 个（affaan-m/ECC、ruvnet/ruflo 等），候选稿全列，页面极长 | 数据统计：Skill 超过 8 个的项目 33 个 | 超过 8 个先列 8 个，其余收在“展开其余 N 个”后面，展开错峰进场、按钮变“收起”；从收藏页直达折叠区里的 Skill 时先展开再滚到那一条 | accepted | resolved | `project-expanded.png`、`project-200.png`（本机）；组件板“Skill 列表折叠” | T1a 延后项；长列表不用更长的列表 |
| 4 | 候选稿迷你走势的刻度字 10.5px，低于字号表最小档（并列标注那条同样的问题） | 候选 `pages.css` `.spark-k` | 改 `--fs-micro`（11.5px） | accepted | resolved | r1 `pages.css` | 有信息的小字不低于最小档 |
| 5 | 项目页“资料还没读到”和“简介生成中”用同一条形、同一个强调色闪光图标，两种含义分不开 | 候选 `readOf` | 资料没读到改用收件箱图标、灰色（`data-tone="muted"`），并写明会在出榜后补上；强调色只给“生成中”的闪光 | accepted | resolved | `project-noprofile.png`、`project-generating.png`（本机，`4-states.jpg` 里有） | 强调色只表达“正在生成” |
| 6 | 1280 宽三榜并排时列间距 32px，名字截得多 | 1280 实测 | 1320 以下列间距收到 24px；1280 宽实测无横向溢出 | accepted | resolved | `boards-1280.png`、`boards-cat-1280.png`（本机，`4-states.jpg` 右上） | T1a 延后项（1280 宽） |
| 7 | 登录页左右两个 `h1` | 候选 `login-1.html` | 左栏口号改成 `p.claim`，页面只剩“登录”一个 `h1` | accepted | resolved | r1 `login.html` | 标题层级 |
| 8 | 复审发现：登录说明列的版式写在 `.login-split` 之下，组件板里单独展示时掉成普通有序列表 | 组件板首次截图 | 选择器放宽为 `.intro`、`.claim`、`.how` | accepted | resolved | `6-components-light.jpg` 登录说明列 | 组件板必须与页面一致 |
| 9 | 我的收藏的三种异常（Skill 已不在、资料没读到、项目已改名，#8 验收要求写明且能取消）候选稿没有 | 能力矩阵“我的收藏” | 卡片用提示色一行写明；Skill 已不在时不给复制按钮；改名的卡点进去是新名字的页面 | accepted | resolved | `favorites-edge.png`；组件板“网格卡” | 异常也要能取消收藏 |
| 10 | 三榜并排时官方热门榜多一行周期分段，三列首行不齐 | `1-boards-light.jpg` | 不改 | rejected | N/A | 列头底线已对齐 | 版一结构是所有者选定的；周期切换是该榜必需的控件 |
| 11 | 日报主条目的走势在多数项目上只有最后几天有柱 | `3-pages-light.jpg` | 不改 | rejected | N/A | 走势取官方星数历史 | 近 1 天涨星的项目前面本来就平，图表表达的正是“突然涨” |
| 12 | 收藏卡高度不一（分类标签行数不同） | `favorites-edge.png` | 不改 | rejected | N/A | 底栏贴底（`margin-top:auto`），差异只在空白 | 网格按行对齐已足够 |
| 13 | 数据文本里 6 个项目的简介含长横（AI 生成的简介） | `data.js` 统计 | 不属于视觉包；交 #14：生成提示里要求不用长横 | N/A | N/A | 本记录 | 简介由 #6 生成器产出 |
| 14 | “项目已改名”的判断与数据来源 | 能力矩阵“我的收藏” | 视觉只定提示写法；判断逻辑交 #14 | N/A | N/A | 本记录 | 受保护的数据行为 |
| 15 | 紧凑行、网格卡的列表语义（`role`）、骨架的 `aria-busy`、日报走势的文字摘要 | 本包 | 交 #14 照 #13 做法实现 | N/A | N/A | 本记录与 #14 | 受保护的可访问性与实现范围 |
| 16 | 示例文案：日报概览、版本发布、收藏项、登录失败的用户名 | `data.js` `meta.note` | 不进入生产 | N/A | N/A | 权威包清单注明 | 真实数据等 #11、#14 |

## 审查依据与检查

### 能力矩阵覆盖（docs/design/capability-matrix.md）

| 能力矩阵 | 落在哪里 |
|---|---|
| 全局顶部导航：用户名、更新时间、统计日、四个入口与退出；正常、可能不完整、更新失败 | 各页顶栏（冻结组件）；`?state=partial / failed` |
| 其他榜单：新项目榜（创建于）、官方热门榜日周月（官方顺序）、累计高星榜；切换 → 列表替换；分类过滤 | `boards.html` 三列并排；周期分段控件；分类胶囊同筛三榜（#10 决定） |
| 日报：日期、统计日、概览；三个窗口各前 10，重复写“见上”；Release 附链接 | `daily.html`：近 1 天主条目（简介＋走势）；近 7/30 天前 10 在跟随栏（紧凑行）；版本发布行 |
| 项目页：头部（头像、名字、分类、总 Star、三窗口新增、原项目链接）、简介两句、使用条件（每条附原文；没有就写一句）、Skill 列表（单个收藏与复制）、安装目标与范围、复制成功、简介生成中 | `project.html`：标题区、名次胶囊、阅读正文、使用条件清单、Skill 列表（折叠）、依据行；侧栏统计、走势、安装到、复制、收藏、GitHub |
| 我的收藏：项目与 Skill 两类、收藏时间、取消收藏、空状态；直达项目页或页上那一条 Skill；改名、Skill 删掉、资料不在都写明且能取消 | `favorites.html` 网格卡；种类胶囊；Skill 卡链接带锚点；三种异常提示 |
| 登录：用户名、密码、错误提示 | `login.html` 右栏（冻结表单）；左栏说明 |
| 状态清单 13 项 | 加载中（四页骨架）、空（分类无项目、没有收藏、日报未生成、找不到项目）、最长中文简介与超长 owner/repo（组件板紧凑行边界）、并列（名次胶囊写“并列”；数据里无并列）、五到七位数（组件板）、可能不完整与更新失败（提示条）、简介生成中、不足 20 个（三榜各列）、收藏与取消、复制成功、登录失败 |
| 必须体验的动效：切换分类、进入项目页、收藏、复制安装指令 | 其他榜单切分类列表重进场；项目页正文淡入与柱子升起；收藏轻弹；复制勾号与气泡（切换时间窗口在首页） |
| 不变的约束：不加推荐、对比、历史回看、搜索；不显示事件计数；数字均为官方数据；排序不被视觉强调改变 | 页面中无这些入口；名次只给前三名加深；每页脚注“所有数字来自 GitHub 官方数据” |

### 对比度（新用法，取值同 t1b-r2，WCAG 相对亮度公式）

| 用途 | 浅色 | 深色 |
|---|---|---|
| 提示色小字 `--c-warn`：收藏卡异常提示、使用条件类别（卡片底 / 页面底） | 5.64 / 4.97:1 | 7.61 / 8.21:1 |
| 说明小字 `--c-ink-3`：紧凑行次数字、收藏时间、走势刻度、依据行（卡片底 / 页面底 / 凹陷底） | 5.57 / 4.92 / 4.53:1 | 5.78 / 6.24 / 5.28:1 |
| 次要正文 `--c-ink-2`：名次胶囊（凹陷底）、紧凑行简介（卡片底） | 8.38 / 10.31:1 | 9.56 / 10.46:1 |
| 失败色 `--c-bad`：更新失败提示条标题（凹陷底） | 5.23:1 | 5.59:1 |

没有新增颜色；其余取值见 `t1b-review.md` 的对比度表。

### 动效

- 新增：紧凑行、网格卡、日报条目进场（上移 6px 淡入，错峰最多 14 档）；Skill 展开错峰进场；取消收藏卡片右移淡出；项目页正文淡入。
- 沿用冻结方案：侧栏柱子升起与换窗口扫色、复制勾号与提示气泡、收藏轻弹、登录失败轻摆、悬停 140ms。
- 全部只动 transform 与 opacity；系统开启“减少动态效果”时 CSS 关掉过渡与动画，脚本里的动画直接跳过。截图在这一模式下拍。

### taste 终检（适用条目）

长横（破折号与连接号）：5 个页面、组件板、`pages.js`、`pages.css`、`app.js` 均为 0（示例数据里 AI 简介含 6 处，见发现 13）；渐变、辉光、纯黑：0；同一套圆角规则、一个强调色；每行最多一个中点；状态点只在顶栏表达真实数据状态；没有表情符号、Inter、Fraunces；空、加载、错误状态齐全；明暗两套都已实测；页面只有一个 `h1`。

## 延后项

- 跨平台字体、手机适配：同 t1b-r2。
- 日报概览、版本发布、收藏项为示例文案，真实数据等 #11、#14。
- 并列名次在真实数据里没有出现（10-22 三个窗口都没有并列），名次胶囊的“（并列）”写法只在代码里，未实看。

## 实测与证据（r1）

- 无头 Chrome，`--force-prefers-reduced-motion`；50 张截图在本机 `design/shots/t1b-pages/`（不提交），`report.json` 记每张的页高、是否横向溢出、脚本与 console 错误：全部无错误、无横向溢出。
- 宽度与主题：1440 与 1280 宽；浅色、深色。
- 页面与状态：其他榜单（正常、整页、分类筛选、1280、加载中、可能不完整、更新失败、深色）；项目页（38 个 Skill 收起与展开、200 个 Skill、没有走势、加载中、生成中、资料没读到、找不到、更新失败、从收藏直达折叠区里的 Skill、1280、深色）；日报（整页、1280、深色、加载中、未生成、更新失败）；我的收藏（正常、只看 Skill、三种异常、加载中、空、1280、深色）；登录（正常、失败、1280、深色）；组件板全长（明暗，6880px）。
- 交互（脚本触发）：分类胶囊筛三榜、Skill 展开、种类胶囊、锚点直达并自动展开；复制与收藏只改内存与剪贴板。
- 总览截图（提交）：`docs/design/shots-t1b-pages/` 下 `1-boards-light.jpg`、`2-project-light.jpg`、`3-pages-light.jpg`（日报、收藏含异常、登录、登录失败）、`4-states.jpg`（15 种状态）、`5-dark.jpg`（6 张深色）、`6-components-light.jpg`（组件板补充全长，缩到 960 宽）。

## 权威包清单（t1b-pages-r1）

整包校验码算法：在 `design/` 目录下按路径排序后逐个算 sha256，再对这份清单整体算 sha256。

```sh
cd design && find t1b-pages -type f | LC_ALL=C sort | xargs shasum -a 256 | shasum -a 256
```

整包 sha256：`cca2bfefb31ada88572de236afe96d9e559265268da3215928f8d0696c0870f4`

| 文件 | 角色 | sha256 |
|---|---|---|
| t1b-pages/boards.html | 标准页：其他榜单（三榜同屏） | 564fd7bc8a3d09737950db62a5853235a45f7a3ec9a46b4f55333d5715240055 |
| t1b-pages/project.html | 标准页：项目页（正文加侧栏） | 6fc5bade6118740a64c53ae031a0e16207d11d356b8f8590492d7b6fb6fd5fc5 |
| t1b-pages/daily.html | 标准页：日报（主次结构） | 6e0b08f6c00182eecd3ec911e55013fe0c7ad0b316909a0a974e0fc913e0e6c3 |
| t1b-pages/favorites.html | 标准页：我的收藏（卡片网格） | c367a3ef2b57cfe595e0c95fc5b1d457156bc8dcd48e875e23eec765e5ee2628 |
| t1b-pages/login.html | 标准页：登录（左右分栏） | 268f564f815767f4400cd9ca7b3b86f0f10e98accfc5e3ddf60111f2920c6da0 |
| t1b-pages/components.html | 组件板补充（只列这 5 页新增的组件与状态） | ba43d4d7ed7071e23243d1021baa9d214f883b3cf79be5524724645fab4ced42 |
| t1b-pages/pages.css | 这 5 页的版式与新组件样式（值全部取自 t1b/tokens.css） | 4b483b7610f49d8552b5581b413ab033d3f6d56a9fc5c0f8771c841e8c93cb92 |
| t1b-pages/pages.js | 这 5 页的拼装函数（紧凑行、网格卡、侧栏、折叠、骨架、状态） | b1e8778ab951503e54c13f275b4c7ffea065280cf52f6ad823ecb3a269790b5b |
| t1b-pages/app.js | t1b/app.js 的副本，改动四处（暂缺、头像回退、去演示面板、导航指向本目录） | 320bd59c856995f26998ccf7b1452fadf806db35ebf7fde151346c5b82ca73e6 |
| t1b-pages/data.js | 示例数据（与候选包同一文件：10 月 22 日真实运行的项目、星数、走势、简介、分类；收藏、日报概览与版本发布为示例）；不进入生产 | b68673e551a2a97965c5aa22fe687443cdeb9f7333b829ffe764314b0222200b |

引用的冻结文件（不在本目录，属于 t1b-r2）：`t1b/tokens.css`、`t1b/components.css`、`t1b/icons.js`、`t1b/icons-LICENSE.txt`，以及导航里的首页 `t1b/index.html`。`design/t1b-pages/` 或 `design/t1b/` 里任何一个文件改动都会使本审查与批准失效，需要重新过 T1b 并重新批准。

本机打开：在仓库根目录运行 `python3 -m http.server 5303 --bind 127.0.0.1 --directory design`，访问 http://127.0.0.1:5303/t1b-pages/boards.html （其余 `project.html?repo=mattpocock%2Fskills&from=boards`、`daily.html`、`favorites.html?state=edge`、`login.html?state=failed`、`components.html`；加 `?theme=dark` 看深色，`?state=` 见组件板“页面状态”表）。

## 常浩 visual-direction approval record

```md
Decision: approved
Approver: 常浩
Approved authority package manifest: docs/design/t1b-pages-review.md#权威包清单t1b-pages-r1
Package version/hash: t1b-pages-r1 / cca2bfefb31ada88572de236afe96d9e559265268da3215928f8d0696c0870f4（依赖 t1b-r2 / ca5350abb9f8c84a961e12b9fd6612a52d2096f684d294da8654b2892a7ca514）
Package members: 标准页 boards.html、project.html、daily.html、favorites.html、login.html；组件板补充 components.html；版式样式 pages.css；拼装脚本 pages.js；组件脚本副本 app.js；示例数据 data.js；引用 t1b-r2 的 tokens.css、components.css、icons.js
Decision evidence: 所有者在 Claude 会话中回复“批准 t1b-pages-r1（cca2bfef），冻结，开始 #14 落地。”（审查记录与 6 张总览截图发给其之后）
Date: 2026-10-24T01:55+08:00
Freshness: current
Implementation allowed: yes（只限按 t1b-pages-r1 冻结版本实现 #14；design/t1b-pages/ 或 design/t1b/ 任何改动都会使本批准失效）
```
