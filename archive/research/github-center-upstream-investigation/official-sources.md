# 上游缺项：官方语义核验

核验日期：2026-10-22。仅浏览公开文档；未调用 gh/API、未访问采集数据库、未操作采集进程。本文件由 upstream_official_sources 独立整理。

## 已核实的官方语义

| 项目 | 官方定义 | 对本次排查的用途 |
|---|---|---|
| `fork:true` | 所有匹配仓库，包含fork | 保持当前总体范围 |
| `fork:only` | 仅匹配fork | 可与去掉fork限定词的默认非fork查询构成互补分解 |
| 默认fork行为 | 搜索默认不显示fork | 不应把去掉fork:true单独当完整查询 |

依据：[Searching in forks](https://docs.github.com/en/search-github/searching-on-github/searching-in-forks)。所读官方页面未定义 `fork:false`；安全方案优先使用上表明确有文档支持的组合，而不依赖未经核验的拼法。

`archived:true` 与 `archived:false` 分别筛选已归档和未归档仓库，语义上互补。`created` 可使用 ISO8601 日期并细化到时、分、秒及UTC偏移。`stars:n` 是精确星数。`is:public` 是公开仓库限定。依据：[Searching for repositories](https://docs.github.com/en/search-github/searching-on-github/searching-for-repositories)。

REST repository search 默认按 best match；显式支持 `stars`、`forks`、`help-wanted-issues`、`updated` 排序，`order` 仅在指定 sort 时生效。每页最多100条。超时通常返回已找到结果并设置 `incomplete_results:true`。文档也说明权限过滤可省略无权访问资源，但未承诺会如何调整本异常的 total_count。依据：[REST Search](https://docs.github.com/en/rest/search/search#search-repositories)。

## 尚不能认定的原因

未找到 GitHub 官方文档或可确认的维护者说明，将“仓库搜索 total_count=1 / items=[] / incomplete_results=false”明确归因为某个已知故障。因此，索引残留、权限可见性变化、搜索后端不一致和排序路径异常只能作为待验证假设，不能写成已证实根因。普通超时的官方解释不足以单独解释当前 false 标记。

检索曾出现社区用户对 code search 相似症状的讨论，但既非相同端点，也无可确认维护者定论，未将其作为修复依据。

## 建议的有限探测与安全采用条件（独立分析）

1. 保留同一个q，优先仅改变排序：去掉sort/order、stars升序、updated。官方把这些参数定义为排序；若由此获得完整对象，属于同范围探测，不是收窄目标。
2. 若仍矛盾，尝试 `archived:true/false` 的互补分解，或默认非fork查询加 `fork:only`。必须两侧均完整、ID不重叠、合并条目与各自计数一致。不能只保留有结果的一侧。
3. 找到具体仓库后，读回其稳定ID、public状态、created_at、当前星数及归档/fork字段，证明它满足原坏叶条件；名称重定向不替代ID验证。
4. 保存每次原始响应与请求时间；同范围或完整分解的再次读取应稳定。若仍与原查询计数冲突，继续标记未解决，不能凭“另一个查询返回0”消除缺项。
5. 以上仅是安全候选。直接读取一个已知repo能验证其存在，但不能单独证明该查询范围只有这一项；还需完整搜索结果/互补分解及计数证据，并沿用后续新鲜候选复核。

不建议：取消is:public后把私有结果混入、仅排除fork或archive来获得一致数、用网页展示数量替代API原始证据、直接把原total_count改0、重置原采集断点。
