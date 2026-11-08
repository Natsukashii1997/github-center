#!/bin/bash
# B0-02（#75）：每 15 分钟记一次几个样本仓库最近两周的官方日桶，到指定的 UTC 时刻为止，用来看"新的一天什么时候出现、上一天什么时候停止增长"。
# 用法：bash scripts/poll-star-buckets.sh <输出文件> <截止 UTC，如 2026-11-08T10:30:00Z> owner/repo ...
out=$1; until=$2; shift 2
end=$(date -j -u -f "%Y-%m-%dT%H:%M:%SZ" "$until" +%s)
while [ "$(date -u +%s)" -lt "$end" ]; do
  for r in "$@"; do
    body=$(gh api "repos/$r/stargazers/history?per_page=2" 2>/dev/null | tr -d '\n')
    echo "{\"at\":\"$(date -u +%FT%TZ)\",\"repo\":\"$r\",\"weeks\":${body:-null}}" >> "$out"
  done
  sleep 900
done
