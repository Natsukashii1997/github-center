# Domain Docs

## 布局：single-context

本项目使用根目录 `GLOSSARY.md` 维护术语，`docs/adr/` 维护架构决策。当前不是大型多包仓库，不建立GLOSSARY-MAP或多上下文目录。

## 阅读规则

探索相关代码前，读取存在的 `GLOSSARY.md` 以及 `docs/adr/` 中与当前任务有关的记录。若未来存在 `GLOSSARY-MAP.md`，先按映射定位相关上下文。

这些文件不存在时直接继续，不为补齐模板而创建。domain-modeling在术语或决策真正明确时按需建立。

Issue、方案、代码和检查说明采用术语表已有用词；遇到缺词先判断是否真实领域概念。与既有ADR冲突时明确指出对应编号及重新讨论理由，不静默覆盖。
