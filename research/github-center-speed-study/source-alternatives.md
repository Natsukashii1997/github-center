# 日榜提速：官方接口与免费公共聚合源核验

核验时间：2026-10-22。范围是当前口径的全站公开仓库（含 fork）、官方统计日的存续新增 Star、Top 20 含末位并列。本轮只阅读主源文档和公开项目材料；没有调用本机采集所用的 GitHub CLI、没有改采集程序或参数、没有停止/重启进程、没有开通云资源。公开 issue #323 经 GitHub 连接器只读取得两次；连接器与本机 CLI 的配额归属未另作核验，不能将本轮笼统说成零 API 请求。

**结论：没有找到一个已验证能免费、直接替换当前全站候选采集，并保留相同统计口径与覆盖证明的公共聚合接口。可确认的提速主要仍在官方接口的条件缓存、范围缩小和有证明的候选排除。公共榜单可以先帮助挑选种子，不能独自证明“榜单之外没有遗漏”。**

## 官方接口能省什么

| 路线 | 核验结果 | 对当前任务的价值 |
|---|---|---|
| 一个请求批量读取多仓库日涨星 | REST star-history 公开参数只有单仓库路径、`page`、`per_page`；未发现文档化的多仓库或日期筛选接口 | 暂不能作为架构前提 |
| GraphQL 批量拿日/周历史聚合 | 当前 Repository / Starrable 文档有 `stargazerCount` 与 `stargazers` 连接，没有查到聚合 history 字段 | 不应把 GraphQL 的批量能力等同于已有批量日榜数据 |
| 日榜只读目标所在周 | history 按周分页，最多一页 30 周；可取 1 周并按实际 `week` 键校准 | 相比当前 6 周响应，能减少正文与服务端时间范围；每仓的调用数仍至少一次，不解决主要请求额度成本 |
| 保持固定请求格式并使用条件缓存 | 正确认证的条件请求返回 304，不计入 primary rate limit；需要实际 HTTP 校验 | 推荐继续实测，收益取决于真实跨日命中率，不是本地缓存文件存在即省额度 |

依据：[REST star-history 参数](https://docs.github.com/en/rest/activity/starring#get-repository-star-history)、[GraphQL Repository](https://docs.github.com/en/graphql/reference/repos#repository)、[Starrable](https://docs.github.com/en/graphql/reference/activity#starrable)、[条件请求最佳实践](https://docs.github.com/en/rest/using-the-rest-api/best-practices-for-using-the-rest-api#use-conditional-requests)。

GitHub 工程说明表明，新接口先按周对应的日期范围筛选，再聚合。因此少取周数确实减少参与聚合的范围，但热门仓库的密集周仍可能较慢；不能由“正文小了”推断固定倍数提速。它统计当前仍存在的 Star；移除 Star 会移除原记录，不是不可变的历史事件账本。[GitHub 接口实现说明](https://github.blog/engineering/architecture-optimization/from-2500-requests-to-24-rebuilding-star-history-without-the-stargazers/)

**缓存限制（分析推断）**：周页是相对位置；跨周时响应中的 `week` 序列可能变化，没有新增 Star 的仓库也不一定返回 304。查询目标周时必须重新定位并验证桶键。没有文档化的固定日期 URL，不能假定每天永久保持同一高命中率。日榜减为一周还可能与未来 7/30 日榜重复取数，应按仓库合并所需窗口后再决定是否划算。

## 免费公共源：能加速发现，但不能独自托底全站覆盖

| 数据源 | 已核验事实 | 可采用方式与限制 |
|---|---|---|
| GH Archive 原始小时文件 | 来自 GitHub Events API，按小时归档，也提供 BigQuery 公共数据集 | 可以在本机汇总或用公共查询提取候选；不是官方 star-history 的同口径完整副本 |
| ClickHouse GitHub demo / SQL Playground | 厂商说明 GitHub 数据集来自 GH Archive，介绍为按小时更新、供研究查询 | 聚合查询可以很快；查询引擎不能补回上游漏掉的事件。介绍中的更新频率不等于本轮已验证实时延迟 |
| OSSInsight 公共 API | FAQ 明确历史来自 GH Archive、实时来自 GitHub Events；免费 beta 无需认证，当前文档限每 IP 600 次/小时，另有全局限额 | Trending 适合产生优先读取的种子；逐仓历史接口更不是绕开全量请求成本的办法。官方 FAQ 自认无取消 Star 事件及其他差异 |
| OpenDigger 兼容归档 | 发布者说明从 2026-09-06 提供小时文件，轮询公开 Events 的全部 3 页，自适应采集间隔；同时明确不能保证绝对完整 | 可作为额外线索源与交叉检查；不能将“比另一个源多”当完整性证明 |
| BigQuery sandbox | 官方允许无信用卡/计费账户试用，计算免费额度 1 TiB/月，存储有生命周期额度，表有过期限制 | 提供免费计算能力，不修正 GH Archive 的数据语义或缺漏。是否满足长期日更容量仍须按实际扫描量核算；本轮未创建项目 |

主源：[GH Archive](https://www.gharchive.org/)、[ClickHouse demo](https://clickhouse.com/demos)、[OSSInsight FAQ](https://ossinsight.io/docs/faq)、[OSSInsight API 额度](https://ossinsight.io/docs/api)、[OpenDigger 发布说明](https://github.com/igrigorik/gharchive.org/issues/323)、[BigQuery sandbox](https://docs.cloud.google.com/bigquery/docs/sandbox)。

覆盖与统计口径的硬差异：

- GitHub Events API 的时间线最多 300 个事件，当前文档保留最近 30 日，事件延迟可能为 30 秒至 6 小时；不是带持久游标、可任意补齐的完整事件流。[GitHub Events API](https://docs.github.com/en/rest/activity/events#list-public-events)
- `WatchEvent` 只记录 `started`，没有对应的取消 Star 事件。即使某个小时文件完全收齐，这个计数也不等于读取时仍存续、按官方日桶分组的 Star；UTC 事件日也不能直接当作官方未承诺 UTC 的日桶。[WatchEvent 定义](https://docs.github.com/en/rest/using-the-rest-api/github-event-types#watchevent)
- GH Archive 的公开问题 #320 包含用户针对两个仓库的 API/归档对照，报告 2026 年漏收显著；#323 发布者也明确说明有限窗口带来的完整性边界。前者是有方法的用户报告，不是已完成的全站普查；但足以否定未经核验便拿它保证全站不漏的做法。[对照问题 #320](https://github.com/igrigorik/gharchive.org/issues/320)

## 一个值得保留但尚未实测的 GraphQL 候选

GraphQL `stargazers` 连接支持按 `STARRED_AT` 排序。理论上可批量只请求各仓库最新一颗存续 Star 的时间；若它严格早于目标统计日的安全边界，则该目标日必为零，不必再读整段历史。这是时间上界排除，而非用“总 Star 没变化”冒充没新增。

但目前不能把它计入确定收益：

1. 当前官方 schema 仍公开该连接，不代表本账户可以对全部非协作仓库读取它。
2. GitHub 2026 年公告已经收紧 stargazers 的 REST/UI 访问；公告未明确写 GraphQL，不能自行推断其一定可用，也不能遇到权限拒绝后绕过限制。
3. 需要先核验字段真实可用性、空列表/权限错误含义、批量额度与时区边界，再做与 history 的同样本对照。只返回时间、不要收集用户身份。

依据：[GraphQL star 排序字段](https://docs.github.com/en/graphql/reference/activity#starorderfield)、[访问限制公告](https://github.blog/changelog/2026-06-30-upcoming-access-restrictions-to-public-api-endpoints-and-ui-views/)。**本轮没有发出此类认证探测，不承诺可用或提速倍数。**

## 对当前方案的建议

1. 当前采集保持原样，先拿到冷启动基线。
2. 优先验证条件缓存与可证明候选排除；如果要缩短历史响应，先用隔离样本比较 1 周/6 周的实际延迟、命中率和窗口正确性。
3. 免费榜单或事件源只用于更早找到可能的高分项目，从而改善读取顺序；最后仍由官方数据和全站搜索边界证明完整性。
4. 不把换成 ClickHouse、OSSInsight 或 BigQuery 的快速返回，写成同口径全站采集已被替代。
