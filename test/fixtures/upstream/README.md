# 录制的上游数据（#2、#3、#9 离线测试用）

2026-10-23 录制。测试通过 `test/helpers/recorded-upstream.js` 按网址回放，不访问网络。

| 文件 | 来源 | 说明 |
|---|---|---|
| `gharchive-2026-10-22-12.ndjson` | 真实 | 取自 `https://data.gharchive.org/2026-10-22-12.json.gz` 的开头：前 4000 条事件里的 14 条 Star 事件（WatchEvent）原样保留，另有 6 条真实的其他事件用来验证过滤。按原来的第 12 小时回放，其余小时回放为空文件。 |
| `gharchive-2026-10-22-13.ndjson` | 编写 | 1 条 Star 事件：php/php-src（id 1903522）用旧名 `php/php-src-legacy`，模拟当天改名，测试按仓库 id 去重。 |
| `trending-daily.html` | 真实 | `https://github.com/trending?since=daily` 当天页面里的 9 个项目块原样保留，外层页面已删去。 |
| （周榜、月榜） | 回放日榜 | 没有单独录制，`?since=weekly`、`?since=monthly` 回放上面的日榜页面。 |
| `search/new.json`、`search/top.json` | 真实，按真实格式裁剪 | 2026-10-23 录制的 GitHub 官方搜索：`created:2026-09-23..2026-10-22 fork:true` 与 `stars:>=10000 fork:true`，都按总 Star 降序、每页 100。各保留前 30 个，每个只留 `id`、`full_name`、`stargazers_count`、`created_at`、`fork`、`description`。新项目榜第 18、19 名同为 9,535，正好测并列。 |
| `history/42976210.json`、`repos/42976210.json` | 真实 | star-history/star-history 的官方星数历史与仓库信息。 |
| `history/<其余 id>.json` | 按真实格式编写 | 每个候选当天（第 1792281600 周、第 4 格，即 2026-10-22）的新增 Star 是设定值：5 名和 6 名同分、20 名和 21 名同分，用来测并列。DietrichGebert/ponytail 只有最近 2 周（模拟新建仓库），用来测更早统计日时它还不存在。 |
| `repos/<其余 id>.json` | 按真实格式裁剪 | 只保留 `id`、`full_name`、`stargazers_count`。 |
| `clickhouse-2026-10-22-05.jsonl` | 按真实格式编写 | ClickHouse 公开库按小时统计 Star 事件的返回格式；测试第 5 小时 GH Archive 缺失时用它补。 |
