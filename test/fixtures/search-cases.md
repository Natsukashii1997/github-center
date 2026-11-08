# 检索测试集（B0-04，#77）

`search-cases.json` 是 P0-01 统一检索（和 P0-02 能力关键词对比）的验收依据，见 `docs/product/PRD-v2.md` 的 B0-04、P0-01。2026-11-08 冻结，所有者逐条确认过问题和预期结果。之后检索的每次改动都要用它跑一遍。

问题来自所有者近期真实工作（各项目的 CURRENT、README、Issue，Vault 里记下的需求）。按 Vault 的外发规则，这里只放问题文字和出处指针，不放受限笔记的标题和原文。

## 改动规则

- 不能为了让检索通过去改预期。要改问题、候选或规则，先经所有者确认，再改 `version`、`frozenAt`、`confirmedBy`。
- 本机数据更新后，候选可能改名、掉出收录范围或换级别。`test/search-cases.test.js` 能读到本机 `data/` 时会逐条核对，核对不过就找所有者重新确认那一条，不要直接删。

## 顶层字段

| 字段 | 含义 |
|---|---|
| `version` | 测试集版本，改动一次加一 |
| `frozenAt` / `confirmedBy` | 冻结日期、谁在什么时候怎么确认的 |
| `dataAsOf` | 预期结果核对时用的本机数据日期 |
| `corpusAtFreeze` | 冻结时的检索范围规模：已分类项目数（`categorizedProjects`，含资料级和描述级）、资料级项目数、Skill 数（资料级 + 名称级，未按 PRD 4.3 合并去重） |
| `rules` | 判定规则，见下一节 |
| `cases` | 测试条目 |

## 判定规则（`rules`）

所有者 2026-11-08 确认（确认页 R1–R3）。

1. **库里有候选**（`expect: "found"`）：`candidates` 里**任意一个**出现在前 `topN`（10）条结果里，这条通过（`foundPass: "anyCandidateInTopN"`）。候选是几个同样合格的答案，不要求全部出现。
2. **门槛**：`found` 条目通过的比例 ≥ `foundPassRate`（80%，14 条至少通过 12 条）；中文、英文、中英混合三类的 `found` 条目各至少通过 `minFoundPassPerLang`（3）条。
3. **不应出现**：任何条目的 `mustNotAppear` 里只要有一个出现在前 `topN` 条，这条失败（`failIfMustNotAppearInTopN`）。`expect: "none"` 的条目结果为 0 条时，页面要如实提示"已收录范围内没有找到"（P0-01 验收 2）。`weakOk` 只作说明，出现了也不判失败。

## 条目字段（`cases[]`）

| 字段 | 取值 | 含义 |
|---|---|---|
| `id` | `S01`…（库里有）、`N01`…（库里没有） | 唯一编号 |
| `query` | 文字 | 用户在搜索框里输入的原话 |
| `lang` | `zh` / `en` / `mixed` | 中文、英文、中英混合 |
| `style` | `describe` / `keyword` | 描述式（一句话说需求）、关键词式 |
| `target` | `project` / `skill` | 主要想找项目还是 Skill；候选里可以两种都有 |
| `expect` | `found` / `none` | 库里明确有候选、库里明确没有 |
| `candidates` | 引用数组 | `found` 至少一个；`none` 为空 |
| `mustNotAppear` | 引用数组 | 词面撞车等明显误命中；`none` 至少一个，`found` 可选 |
| `weakOk` | 文字数组，可选 | 可以作为弱相关出现的结果，只作说明 |
| `source` | 文字 | 出处指针（哪个项目的哪份文档，或 Vault 里的哪类笔记） |

### 引用（`candidates[]`、`mustNotAppear[]`）

| `kind` | `ref` 写法 | 对应 |
|---|---|---|
| `project` | `owner/repo`，另带 `projectId`（GitHub 仓库 id） | 已收录项目，资料级或描述级。比对时优先用 `projectId`，仓库改名也认得出 |
| `skill` | `owner/repo#SKILL.md 所在路径`（PRD 4.3 资料级唯一标识；路径指 SKILL.md 所在的目录，不含文件名，和项目资料里 `material.skills[].path` 一致） | 项目资料里识别出的 Skill |
| `skills.sh` | `skills.sh:<来源>/<skillId>`（PRD 4.3 名称级唯一标识） | skills.sh 排行里的 Skill |

`level` 是冻结时的级别（资料级、描述级、名称级），只作参考，级别变了不影响判定。`why` 写这个候选为什么合格，或者这个结果为什么不该出现。

同一个 Skill 有两级时（如 S08 的 `vercel-labs/skills#skills/find-skills` 和 `skills.sh:vercel-labs/skills/find-skills`），检索按 4.3 合成一条后，结果的标识命中其中任何一个都算。

## 配比（冻结时）

共 20 条：库里有 14、库里没有 6；中文 9、英文 6、中英混合 5（`found` 里中文 6、英文 4、中英混合 4）；描述式 12、关键词式 8；找项目 12、找 Skill 8。N01 和 N06 是同一个需求的中文描述式和英文关键词式，用来看中英文结果是否一致。
