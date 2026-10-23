# Issue tracker: GitHub

需求、规格与任务存放在本仓库 GitHub Issues；使用现有登录的 gh CLI。目标仓库从 origin 核验，预期为 Natsukashii1997/github-center。

## 操作约定

- 创建：`gh issue create --title "标题" --body-file /path/to/body.md`。
- 读取：`gh issue view <number> --json number,title,body,labels,comments`。
- 列表：`gh issue list --state open --json number,title,body,labels`，按需要过滤状态和标签。
- 评论：`gh issue comment <number> --body-file /path/to/comment.md`。
- 标签：`gh issue edit <number> --add-label "标签"` 或 `--remove-label "标签"`。
- 关闭：只有验收满足后才用 `gh issue close <number>`；先记录结果、证据和遗留。
- 多行正文通过临时正文文件传入，避免命令行转义改变内容。
- 子任务优先使用 GitHub 原生 sub-issues；不可用时在正文写 `Part of #<parent>` 并在父任务维护任务清单。
- 依赖优先使用 GitHub 原生 issue dependencies；不可用时正文写 `Blocked by: #<n>`。阻塞任务未关闭前不声称可执行。

## Skill 消费规则

“publish to the issue tracker”表示在本仓库创建 Issue；“fetch the relevant ticket”表示读取对应 Issue。实际外部写入仍须在当前任务授权范围内。

wayfinder 使用一张 `wayfinder:map` Issue 保存 Notes / Decisions-so-far / Fog，子Issue承载 research/prototype/grilling/task。读取子任务与 blocker 后再认领；本次设置不创建这些额外标签或任务。

## Pull requests as a triage surface

**PRs as a request surface: no.**

GitHub Issues与PR共用编号；编号类型不明时先核对，不能把PR当普通Issue处理。
