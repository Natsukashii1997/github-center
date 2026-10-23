# #12 视觉 · T1b 审查记录

## 结论（2026-10-23，Claude）

所有者选定的“三 导读”已深化为高保真候选包 `design/t1b/`。T1b 审查共 16 条发现：9 条已改进候选包并复审通过，7 条不改、不适用或延后，理由写在下表。没有未处理的发现，结论为 **READY_FOR_USER_APPROVAL**。

请所有者批准的确切版本：**t1b-r2，整包 sha256 `ca5350abb9f8c84a961e12b9fd6612a52d2096f684d294da8654b2892a7ca514`**（清单与算法见“权威包清单”）。

**所有者已于 2026-10-23 批准 t1b-r2，这一版冻结**（批准记录见文末）。#13 生产界面按这一版实现，何时开工由所有者安排。

版本说明：r1 是提交 0c8c033 里的初稿（未审查，整包 sha256 `69106f440c1ac39791893f5904b4b04b83ed5118e6f601d6ee036325a79c2956`），已被 r2 取代。

## Gate 1 design-taste review record

```md
Review stage: T1b implementation-readiness
Status: current
Reviewer: design-taste-frontend（该 Skill 面向落地页；产品界面只取视觉、对比度、动效与 AI 痕迹条款）
Artifact evidence: design/t1b/（标准页 index.html，组件板 components.html）；总览截图 docs/design/shots-t1b/；本机全量截图 design/shots/t1b/（22 张，不提交）
Reviewed version/hash: t1b-r2 / ca5350abb9f8c84a961e12b9fd6612a52d2096f684d294da8654b2892a7ca514
Artifact maturity: high-fidelity
Authority package manifest/version/hash: 见下文“权威包清单”（标准页 + 组件板 + 语义变量 + 注册资产，共 13 个文件）
Protected concerns: stack, architecture, functionality, data/domain behavior, information architecture, SEO, content meaning/structure, component ownership, accessibility, QA gates
Design Read: 一个人每天花两分钟看的私人涨星榜。左边是按名次的索引，右边常驻阅读卡，回答“它是做什么的、要不要装”；冷灰底、陶土色单一强调，宋体只给页面标题和阅读正文，数字用 Iowan Old Style 的等高等宽数字。刻度沿用 T1a：版式变化 5、动效 4、密度 5。
Preserve: 名次索引加常驻阅读卡的两栏结构；选中块平移与上下方向键切换；走势图只用一处强调（窗口内的柱子）；全站一个强调色，状态色只用于状态；页头一行小字说清数据来历；明暗两套共用同一套语义变量并跟随系统；只动 transform 与 opacity，减少动态效果时直接切换；有信息的小字对比度不低于 4.5:1。
Deferred dimensions: 见下文“延后项”
Recommendation: READY_FOR_USER_APPROVAL
Next owner: primary workflow（所有者已批准；#13 由所有者安排开工）
Freshness: CURRENT for t1b-r2 / ca5350abb9f8c84a961e12b9fd6612a52d2096f684d294da8654b2892a7ca514
```

## 发现与处置

“决定”取 accepted（采纳并已改）、rejected（不改）、N/A（不属于视觉权威包，或延后）。“状态”中 resolved 表示改动已进入 r2 并复审通过。

| # | 发现 | 证据 | 修改方案 | 决定 | 状态 | 处置证据 | 理由 |
|---|---|---|---|---|---|---|---|
| 1 | 中文页面里英文短横被显示成长横：`dsh-our-free-model`、`Wi-Fi` 里的短横看起来像连接号 | r1 首页截图放大；对照页实测：`lang="zh-CN"` 时 `-apple-system` 按 PingFang 出短横字形，`system-ui` 与 Helvetica Neue 正常 | `--font-ui` 改为 `system-ui` 打头 | accepted | resolved | r2 `tokens.css`；`shots-t1b/1-index-light.jpg` 项目名短横正常 | 违反“不用长横”，并且会让人认错项目名 |
| 2 | 失败色与强调色几乎同色：浅色 #B4432F 对 #B4532A 色差约 10，深色 #E07A63 对 #E8865A 约 11；登录框“聚焦”和“出错”外观一样，“更新失败”像普通强调 | r1 组件板“表单”；色差计算 | `--c-bad` 浅色改 #B3263E、深色改 #F07385（与强调色色差约 29、31）；键盘焦点改为 2px 深灰外框 `--focus`；强调色只用于当前窗口、选中名次、窗口内柱子、已收藏，删去不再使用的 `--c-accent-soft` | accepted | resolved | r2 `tokens.css`、`components.css`；`shots-t1b/4-states.jpg`（更新失败、登录失败）；组件板“表单”“键盘焦点” | 状态色必须一眼可辨，强调色不能兼做错误 |
| 3 | 登录输入框描边对比度 1.52:1，占位字 3.69:1，低于表单对比要求 | 对比度计算 | 描边改 `--c-ink-4`（浅 3.69:1、深 3.93:1），悬停 `--c-ink-3`，聚焦 `--c-ink-2`；占位字改 `--c-ink-3`（浅 5.57:1、深 5.78:1） | accepted | resolved | r2 `components.css`；组件板“表单” | taste 表单对比检查；输入框边界要能看清 |
| 4 | 名次下的“并列”只有 10px，低于中文可读字号，也不在字号变量里 | r1 组件板“榜单行·边界” | 改用 `--fs-micro`（11.5px） | accepted | resolved | r2 `components.css`；组件板“榜单行” | 并列是有信息的标注，必须可读 |
| 5 | 官方热门榜阅读卡里“页面标注今日 +287”和统计格“近 1 天新增 +646”相邻，两个口径容易混 | r1 其他榜单·官方热门榜截图 | 卡片抬头只写“官方热门日榜第 N 名”（与新项目榜一致）；“今日 +287”只留在列表行，榜单切换下方已说明“数字为官方页面标注” | accepted | resolved | r2 `boards.html`、组件板阅读卡示例；`shots-t1b/3-pages-light.jpg` 右上 | 不改数据和口径，只减少同屏并列两个“今天”的数字 |
| 6 | 组件板不完整：缺键盘焦点态；“简介生成中”卡宽约 456px，操作栏被截断（实际最窄 600px）；`tokens.css` 写“不写裸字号、裸间距”，实际组件里有 12、13、13.5、15、16、21px 等固定值 | r1 组件板截图；`components.css` 统计 | 新增“键盘焦点”一节；“简介生成中”按 600px 展示；规则改写为“颜色和阴影只用变量；字号、间距、圆角、动效以变量为主档，微调值在 components.css 定义一次，实现照抄”；字号表补 5 档，写明数字比同行中文大 0.5 到 1px | accepted | resolved | r2 `components.html`、`tokens.css`；`shots-t1b/5-components-light.jpg` | 组件板要覆盖全部主要状态，规则要与实际一致，避免实现时猜 |
| 7 | 复审发现：分类胶囊、次按钮、输入框的键盘焦点被各自的描边盖住，用 Tab 移上去看不到焦点 | r1 `:focus-visible` 用 box-shadow，与组件自身 box-shadow 冲突 | 焦点改用 outline（2px，偏移 2px，圆角跟随元素），不与描边冲突 | accepted | resolved | 首页 Tab 实测：时间窗口标签、分类胶囊外框均为 2px #62696F、偏移 2px，胶囊保持全圆角；组件板“键盘焦点” | 键盘焦点必须处处可见 |
| 8 | 复审发现：组件板页面实际高 8660px，r1 截图只拍到 6400px，“单栏页的条目”“图标”两节没进截图 | 组件板实测页面高度 | 按全长 8700px 截图 | accepted | resolved | `design/shots/t1b/components-light.png`、`components-dark.png`；`shots-t1b/5-components-light.jpg` | 审查证据要覆盖组件板全部内容 |
| 9 | 复审发现：阅读卡、我的收藏、日报的头像读不到时显示“?”，与组件板“读不到时用首字母”不符 | 头像网络中断时的截图 | 头像元素自带仓库名，回退时取首字母 | accepted | resolved | r2 `app.js`、`favorites.html`、`daily.html`；项目页手动触发加载失败显示“M” | 回退状态要与组件板一致 |
| 10 | 走势图窗口外灰柱对卡片底只有 1.44:1（深色 1.34:1），低于非文字图形 3:1 | 对比度计算 | 不改颜色；正式实现给走势图加文字摘要（交给 #13） | rejected | N/A | 窗口内柱对窗口外柱 3.47:1（深 4.86:1），窗口内柱对卡片底 4.99:1（深 6.52:1） | 图表要传达的是“窗口内外”，这一层达标；准确数字已有文字（四格统计与“最高一天”）；灰柱加深到 3:1 会与强调柱抢视线 |
| 11 | 选中某行后它会浮起，被选中的第 5 名可能比第 1 名显眼（能力矩阵：视觉强调不能改变排序） | 首页、组件板“榜单行” | 不改 | rejected | N/A | 默认选中第 1 名；名次本身只给前三名加深，且不随选中改变 | 浮起表示“你正在看这一项”，由点选或方向键触发，不是排序强调 |
| 12 | 衬线体用在数据界面（taste：衬线不用于仪表盘） | `tokens.css` 字体变量 | 不改 | rejected | N/A | 宋体只用于页面标题和阅读正文；界面控件全是无衬线；数字为等高等宽，列对齐 | 所有者 2026-10-23 选定的“三 导读”以阅读为核心 |
| 13 | 图标用 Heroicons v2.2.0，不在 taste 推荐的 Phosphor、HugeIcons、Radix、Tabler 之列 | `icons.js` | 不改 | rejected | N/A | 许可 `icons-LICENSE.txt`（MIT）；线框 1.5 描边一套，只有“已收藏”用实心星 | 条款本意是禁止手画图标；Heroicons 是维护中的正规图标库，换库没有视觉收益 |
| 14 | 所用字体只在 macOS 上有 | `tokens.css` 字体变量 | 延后 | N/A | N/A | 见“延后项” | 目前只在这台 Mac 上使用 |
| 15 | 左下角演示面板（切状态、切明暗） | `components.css` 的 `.gc-demo`、`app.js` 的 `demo()` | 不进入正式界面 | N/A | N/A | 权威包清单中注明 | 只用于候选页演示，#13 不实现 |
| 16 | 榜单的列表语义与键盘：行没有 `role="option"`、不能用 Tab 聚焦，方向键是全局监听 | `index.html`、`boards.html`、`app.js` | 交给 #13 实现：行可聚焦、`role="option"`、焦点外框跟随行圆角（`--r-lg`）、图表文字摘要 | N/A | N/A | 本记录与 #13 | 属于受保护的可访问性与实现范围，不由视觉审查改动 |

## 审查依据与检查

### 能力矩阵覆盖（docs/design/capability-matrix.md）

| 能力矩阵 | 落在哪里 |
|---|---|
| 全局顶部导航：用户名、更新时间、统计日、四个入口与退出；正常、可能不完整、更新失败 | 各页顶栏；组件板“顶栏”三种状态 |
| 首页：近 1、7、30 天切换；全部加 9 个分类；榜单行（名次与并列、头像、owner/repo、一句话简介、窗口新增、总 Star、分类不超过 2 个）；点行看详情；行内收藏 | `index.html`；组件板“切换与筛选”“榜单行”“阅读卡” |
| 首页状态：可能不完整（含原因）、更新失败（上次成功日期）、不足 20 个 | 首页示例状态；组件板“提示条” |
| 其他榜单：新项目榜（创建于）、官方热门榜日周月（官方顺序）、累计高星榜 | `boards.html`；组件板“榜单行·其他榜单” |
| 日报：日期、统计日、概览；三个窗口各前 10，重复写“见上”；Release 附链接 | `daily.html`；组件板“单栏页的条目” |
| 项目页：头部、简介两句、使用条件（没有就不显示）、Skill 列表（单个收藏与复制）、安装目标与范围、复制成功、简介生成中 | `project.html`；组件板“阅读卡” |
| 我的收藏：项目与 Skill 两类、收藏时间、取消收藏、空状态 | `favorites.html`；组件板“空状态”“单栏页的条目” |
| 登录：用户名、密码、错误提示 | `login.html`；组件板“表单” |
| 状态清单 13 项：加载中、空、最长中文简介、超长 owner/repo、并列、五到七位数、可能不完整、更新失败、简介生成中、不足 20 个、收藏与取消、复制成功、登录失败 | 全部在组件板与各页示例状态中出现 |
| 必须体验的动效：切换时间窗口、切换分类、进入项目页（阅读卡换内容）、收藏、复制安装指令 | 首页实测；组件板“动效”可点例子 |
| 不变的约束：不加推荐、对比、历史回看、搜索；不显示事件计数；数字均为官方数据；排序不被视觉强调改变 | 页面中无这些入口；名次强调只给前三名，见发现 11 |

### 对比度（r2 实际取值，WCAG 相对亮度公式）

| 用途 | 浅色最低 | 深色最低 |
|---|---|---|
| 正文 `--c-ink` | 14.48:1 | 13.19:1 |
| 次要正文 `--c-ink-2` | 8.38:1 | 9.56:1 |
| 有信息的小字 `--c-ink-3` | 4.53:1（凹陷底） | 5.28:1 |
| 强调小字 `--c-accent-ink` | 5.30:1 | 7.30:1 |
| 正常 `--c-ok`、可能不完整 `--c-warn`、失败 `--c-bad` | 4.74、4.58、5.23:1 | 7.49、6.95、5.59:1 |
| 图标按钮与输入框描边 `--c-ink-4`（非文字，要求 3:1） | 3.26:1（页面底），3.69:1（卡片底） | 3.59:1 |
| 键盘焦点外框 `--c-ink-3` | 4.53:1 | 5.28:1 |
| 主按钮文字、已复制按钮文字 | 15.73:1、5.15:1 | 15.58:1、8.84:1 |

“最低”指该颜色在页面底、卡片底、凹陷底三种底色中最差的一种。`--c-ink-4` 只给不承载信息的字（加号前缀）和图标、描边。

### 动效

- 动画只用 transform 与 opacity：列表进场（上移 6px 淡入）、选中块平移、阅读卡正文淡入上移 4px、走势柱从底部升起、收藏轻弹与复制勾号（缩放）、登录失败左右轻摆、取消收藏条目右移淡出、窗口下划线与分段滑块平移、提示气泡淡入上移。
- 悬停时颜色、底色、描边的过渡统一 140ms（`--dur-fast`）；加载中骨架呼吸只动 opacity。
- 系统开启“减少动态效果”时，CSS 关掉全部过渡与动画，脚本里的动画直接跳过；截图证据就是在这一模式下拍的，保证都是动画结束后的样子。

### taste 终检（适用条目）

长横（破折号与连接号）：界面文案、数据与代码中均为 0；渐变、辉光、纯黑：0；一套圆角规则、一个强调色；每行最多一个中点；顶栏状态点表达真实数据状态，没有装饰性圆点；没有表情符号、没有 Inter 与 Fraunces；空、加载、错误状态齐全；明暗两套都已实测。

## 延后项

- 跨平台字体：现在用 macOS 自带的苹方、宋体、Iowan Old Style、SF Mono，只保证这台 Mac。将来伙伴用其他系统访问时，换成可本地托管的字体并重新过 T1b。
- 手机适配：首版不做（需求最终回放），最小宽度 1280px。
- 走势图某天缺数据的画法：能力矩阵没有列。按 #2 “缺失不补零”的规则，正式实现时该天留空位、不画柱；如需新的视觉表达，重开 T1b。

## 实测与证据（r2）

- 宽度与主题：1440 与 1280 宽；浅色、深色、跟随系统。
- 页面与状态：首页（正常、可能不完整加不足 20 个、更新失败、加载中、简介生成中）、项目页、其他榜单（新项目、官方热门、累计高星）、日报、我的收藏（有收藏、空）、登录（正常、失败）、组件板全长。
- 交互（本机预览，最新文件）：切到近 30 天、选“Skill”分类、方向键换选中、行内收藏与取消、复制安装指令后按钮变“已复制”并出提示气泡、Tab 键焦点外框；页面脚本无报错。控制台里只有头像服务器网络中断时的加载失败，不属于页面问题。
- 总览截图（提交）：`docs/design/shots-t1b/` 下 `1-index-light.jpg`、`2-index-dark.jpg`、`3-pages-light.jpg`（项目页、官方热门榜、日报、我的收藏）、`4-states.jpg`（可能不完整、更新失败、简介生成中、登录失败）、`5-components-light.jpg`（组件板全长，缩到 960 宽）。
- 全量截图（本机，不提交）：`design/shots/t1b/` 22 张 PNG，无头 Chrome，`--force-prefers-reduced-motion`，组件板 1440×8700。

## 权威包清单（t1b-r2）

整包校验码算法：在 `design/` 目录下按路径排序后逐个算 sha256，再对这份清单整体算 sha256。

```sh
cd design && find t1b -type f | LC_ALL=C sort | xargs shasum -a 256 | shasum -a 256
```

整包 sha256：`ca5350abb9f8c84a961e12b9fd6612a52d2096f684d294da8654b2892a7ca514`

| 文件 | 角色 | sha256 |
|---|---|---|
| t1b/app.js | 共用组件拼装（行、阅读卡、切换、提示等）；其中 `demo()` 不进入生产 | 08921e725b6b9ef92610421793da190a8616ae171ad6f7b00273b7e79bd2b009 |
| t1b/boards.html | 其他榜单页 | 7b49b2c22cc9e134c1973e62df4e3fc496979b5913a07ae3d4b8156bc244bfb8 |
| t1b/components.css | 共用组件样式；其中 `.gc-demo` 不进入生产 | 9ae2b66860ea4c660495cfabc03a60da76ddf097aeb6efbcb9a6b002375549c4 |
| t1b/components.html | 组件板 | 513854e9ef851d91c4487ea0a15c511e800a99b6c3ea9a319ba3d6ec2b5648c4 |
| t1b/daily.html | 日报页 | ec295c6c0d3a520daff3af3729a988db2d72550b4139bb636ecbe5d539470fbe |
| t1b/data.js | 示例数据（10 月 22 日真实运行的官方星数历史、官方热门日榜、Release；中文简介等为示例文案）；不进入生产 | e249676b6c75279d722e5f1190c222ea343e007c07eeab1a9845c7b07f30d904 |
| t1b/favorites.html | 我的收藏页 | 1c585dc9124b6d8de20e80330d9052851be21a766328378546c96dc7362ae4ce |
| t1b/icons-LICENSE.txt | 注册资产许可（Heroicons，MIT） | 60e0b68c0f35c078eef3a5d29419d0b03ff84ec1df9c3f9d6e39a519a5ae7985 |
| t1b/icons.js | 注册资产：Heroicons v2.2.0 子集 | 2fa9040de4ae2e542ccda736b301fa7bc3420aaf6a8aa2f2f97d8e9b7a3df88f |
| t1b/index.html | 标准页：涨星榜首页 | 9946365f3b7ebb1eefacf15f8a3871bff91a97e11c83886e1d51abd56e28410f |
| t1b/login.html | 登录页 | 50d2c2d6fb5bc1a4e1bfa6f7fedc5a1603f088f288e93977c6607de273fefbb7 |
| t1b/project.html | 项目页 | a3e92ba96fbde2b373d10c15c482614ef08906a590ad1659548894440a11e721 |
| t1b/tokens.css | 语义设计变量（明暗两套） | 3cbfd7f21d341278eedb51c02b36970a7ecedc5db9a5c79e04f161e47ab95925 |

`design/t1b/` 里任何一个文件改动都会改变整包校验码，本审查与批准随即失效，需要重新过 T1b 并重新批准。

本机打开：直接用浏览器打开 `design/t1b/index.html`；或在仓库根目录运行 `python3 -m http.server 5303 --bind 127.0.0.1 --directory design`，再访问 http://127.0.0.1:5303/t1b/index.html （组件板为 `components.html`）。左下角演示面板可切换状态与明暗。

## 常浩 visual-direction approval record

```md
Decision: approved
Approver: 常浩
Approved authority package manifest: docs/design/t1b-review.md#权威包清单t1b-r2
Approved package version/hash: t1b-r2 / ca5350abb9f8c84a961e12b9fd6612a52d2096f684d294da8654b2892a7ca514
Package members: 标准页 index.html；组件板 components.html；语义变量 tokens.css；共用组件 components.css、app.js；注册资产 icons.js、icons-LICENSE.txt；同一组件拼装的其余页面 project.html、boards.html、daily.html、favorites.html、login.html；示例数据 data.js
Approved authority dimensions: 结构、风格、资产
Decision evidence: 所有者在 Claude 会话中回复“批准 t1b-r2（ca5350ab）。”（审查记录与 Issue #12 评论请其批准这一确切版本之后）
Date: 2026-10-23T19:26+08:00
Freshness: current
Implementation allowed: yes（只限按 t1b-r2 冻结版本实现 #13；design/t1b/ 任何改动都会使本批准失效）
```
