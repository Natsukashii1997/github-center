# 研究与数据验证资料

> 2026-11-22 从仓库根目录的 `research/` 原样移到 `archive/research/`（#112），离线检查入口 `check_offline.py`、`test_offline_entry.py` 也从 `scripts/` 移到本目录（`python3 archive/research/check_offline.py`）。下文、`import-manifest.json` 和 `docs/verification/bootstrap.md` 里写的 `research/…`、`scripts/check_offline.py` 是当时的路径，没改。

本目录是 2026-10-23 的研究及源码快照，尚未形成可直接使用的 GitHub 快速中心应用，也不代表完整日榜或连续日更已经通过验收。仓库建档不会移动或启动本机采集任务。

## 当前边界

- 已保存的运行数据有 65,935 个候选；8 个星数漂移在隔离副本中找到通过验证的覆盖方案，1 个空项仍没有安全补齐证据。运行版未接入该方案，采集未恢复。
- `github-center-sustained-run/CURRENT.md` 是导入时快照；实际运行状态继续以原本机工作目录中的实时文件、进程和数据库为准。历史报告按各自日期阅读，后续分路结论补充此前排查结论。
- 原始数据库、搜索和历史响应、缓存、备份、进程状态、运行计划、自动化配置与日志均未入库。未上传原始证据不代表原件丢失。
- `<LOCAL_EVIDENCE_ROOT>/` 表示仅存在本机的证据目录占位符，不是一个可点击访问的远端地址。正文保留的证据路径可能指向未入库材料。

## 源码和测试

- `github-center-sustained-run/` 保存当前 `runner.py`、`transport.py`、`start_worker.py` 的原字节；不因建仓修改运行逻辑。
- 当前核心离线检查为 `test_runner.py`、`tests_transport.py`、`test_recovery.py`、`test_atomic_mismatch.py`、`test_leaf_drift.py`。后 3 个从已审查修复候选目录汇入，使其与当前 `runner.py` 保持同目录引用。暂存复制阶段未执行；随后根代理通过 `scripts/check_offline.py` 在临时副本验证五组检查，5/5通过，见 `../../docs/verification/bootstrap.md`。
- 采集器需要未入库的本地 `plan.json` 和运行数据。`start_worker.py` 保留本机 Python 3.14 路径；`transport.py` 和传输测试保留 Homebrew `gh` 路径。这是实验源码快照，不是安装完成的可运行发行包。不要直接启动采集或重新生成已保留的数据。
- `github-center-safe-recovery/validate_coverage.py` 和 `validate_monotone.py` 是隔离验证候选，依赖未入库的 `snapshot` 数据库和 `probes` 原始证据。它们不是生产迁移工具。
- 建仓阶段仅运行上述隔离离线检查，没有运行真实采集或诊断探测，没有改变本机断点、有效数据、失败与重试记录。

## 资料组织

六个 `github-center-*` 目录保留原名，便于理解既有相对指针。顶层三份报告涵盖开源参考、数据与免费 AI 日报可行性、全站采集与每日运行核验。AIHOT 在报告中仅作为来源及设计参考，未复制第三方仓库，也尚无已实现的产品 UI。

`../../import-manifest.json` 记录每份入库文件的来源相对路径、源与目标哈希、大小和脱敏替换；原件全部保持不变。
