# Transport 离线验证与接口交接

验证日期：2026-10-22。结果：27 项离线测试全部通过；未发真实 GitHub 请求，未读取凭据文件，未安装依赖。

## 接入约定

```python
from pathlib import Path
from transport import Transport, ApiError, StopRequested

transport = Transport(Path("隔离运行目录"), initial_usage_path=Path("上轮 requests.jsonl"))
# 可省略 initial_usage_path；若传入，则必须存在。
# 仅在 root 已取得独占 worker 进程锁后调用一次：
transport.recover_unknown_attempts()

result = transport.get("repositories/123/stargazers/history?per_page=6", "cold", conditional=False)
# 跨日同 endpoint：仍发送真实 HTTP，有 ETag 时携带 If-None-Match。
result = transport.get("repositories/123/stargazers/history?per_page=6", "day1")
# 仅用于 root 的已完成单元恢复；此调用不是 HTTP，也不增加 304 统计。
saved = transport.response(result["request_id"])
print(transport.stats("day1"))
print(transport.status())
transport.note("caller_event", "day1", {"safe_detail": True})
```

`get()` 返回 `request_id/body/status/cache_revalidated/started_at/finished_at/elapsed_seconds/body_hash`，以及白名单响应头、接收正文字节数、缓存来源 request/job/实际检查时间、累计工人等待时间。`force=True` 和 `conditional=False` 均关闭条件头。搜索端点始终发非条件请求。

异常分工：

- `ApiError(status, reason, retry_at=None, request_id=None, fatal=False)`：单次 HTTP 或解析失败；root 控制有限重试。`retry_at` 是 Unix 秒。
- `ApiError.fatal=True`：所有 401，或错误消息明确说明全局凭据无效、必须认证、访问令牌过期/撤销的 403。写入 `fatal_auth` 门禁，重启不自动恢复；修复认证并明确决定恢复后，须由维护者单独解除该门禁。本模块不自动修复或读取认证配置。
- 仓库级 `Resource not accessible by personal access token` 403 不标成全局认证故障；按保守退避交由 root 决定重试/跳过。
- 独立 `StopRequested(reason)`：不可重试。`root/STOP` 存在、`plan.json.stop_after` 到期、截止配置损坏或无时区、调用 `cancel_pending()` 时触发。`stop_after` 支持带时区 ISO 8601 或 Unix 秒。

root 发现批次终止条件后调用 `cancel_pending()`，再关闭线程池。该方法即时唤醒默认额度等待；并发槽等待至多约 0.5 秒响应；正在发出的 HTTP 允许返回，单次 subprocess 最多 90 秒。额度/退避睡眠每段不超过 60 秒，每段前后检查停止条件。`STOP` 或截止时间本身在等待中至多约 60 秒被识别。进程的默认 SIGTERM 仍会终止执行，不捕获屏蔽。

## 持久化与节流

独立 `transport.sqlite` 使用 WAL、线程锁和 FULL 同步。每次尝试先写 requests ledger，网络阶段不持 SQLite 锁。成功正文以规范 JSON 的 SHA-256 和 zlib blob 去重；完成的响应行与原正文保留，cache 仅移动最新成功指针。304 引用发送 ETag 时所用的原正文和原 request，接受 gh 的退出码 1。没有已验证缓存或正文时的 304 记失败，不能成为成功缓存。

单进程所有 Transport 工人共享最多 4 个网络槽、0.25 秒总间隔、3.1 秒搜索间隔。滚动小时最多 4,000 个非 304 core 尝试；未完成/中断不明的尝试保守计入。可从旧 requests.jsonl 导入最近一小时 core 非 304 用量，按指纹去重。core 响应剩余额度小于 1,000 时等到 reset+5；search 小于 3 时等到 reset+3。429/疑似 secondary 403 全局遵守 Retry-After，无该值则 60 秒递增至最多 15 分钟。

headers 仅保留 `date/etag/retry-after/x-ratelimit-*`；不存 stderr/env/认证材料。search 仅保留计数、incomplete 与紧凑仓库字段；仓库元数据同样精简；history JSON 内容保留。`note()` 的 details 由调用方保证仅含非敏感诊断数据。

## 指标口径

- `responses_200/responses_304/errors/unfinished/unknown_outcomes` 分开统计，失败的 HTTP 200/304 不计成功。
- `conditional_attempted`：真正发送了有效 ETag 的尝试；`conditional_success_count`：其中成功 200/304 的数量；`cache_hit_rate` 为真实成功 304 / 该有效分母，分母为 0 时为 null。
- `core_*`、`history_*` 提供同口径条件尝试、条件成功分母、304 数和命中率。搜索不混入条件命中分母。
- `cross_job_304` 仅代表跨 job；`cross_date_304_shanghai` 才代表来源和本次实际检查跨北京时间日期，两者不可互换。
- `http_429/http_5xx/timeouts` 可直接用于验收；`bytes_received/bytes_200/bytes_304` 是正文 UTF-8 字节，不包括响应头、TLS 或连接开销，不能称实际网络总流量。
- `network_elapsed_seconds/wait_seconds/queue_wait_seconds` 为工人累计时间，不是任务墙钟耗时；实际总耗时必须由 root 的 job 起止时间计算。

## 离线覆盖与限制

覆盖：200/304（包含 gh exit 1）、跨 job 真实 GET、跨日期区别、body hash/缓存来源、旧响应不可变、缓存缺失失败、429 保留旧缓存、超时落盘、投影/响应头脱敏、分页搜索间隔、滚动预算、低剩余额度、退避、未知请求恢复、bootstrap 去重、JSON 失败、4 工人并发、停止文件、截止前/中途停止、取消事件、无效截止失败、持久认证中止及仓库级 403 区分。

验证命令：`python3 outputs/github-center-sustained-run/tests_transport.py`；最后一次结果：`Ran 27 tests in 0.108s — OK`。

源文件 SHA-256：

- transport.py：`91299a7e27bb5f7832dbc209198d94f9a41f1e775e2e25a53a923a2f22e28522`
- tests_transport.py：`b740314f59fa086df15e01fd05f80e8e8d118f2a3dc77c25266411eb69ea0f22`

上述仅证明传输层模拟分支通过，不证明真实全站榜单、GitHub 实际 304 比例、实际耗时或连续 3 日稳定。网络调用只支持一个独占 owner 进程；多个 worker 进程不受本实现信号量保护，root 必须持有进程锁。其他工具对同一 GitHub 身份的同时用量无法逐请求获知，只能依靠导入预留和真实响应头保守约束。
