# Manual seeds（Scopus CSV 可能漏掉、但必须进粗筛）

格式：每行一篇，导入/重跑粗筛时与 CSV 结果合并，按 DOI 去重。

| DOI | Title | Why |
|-----|-------|-----|
| 10.1038/s44284-025-00330-x | Global urban visual perception varies across demographics and personalities | [arXiv:2505.12758](https://arxiv.org/abs/2505.12758)；不在 2026-07-12 Scopus CSV |
| 10.1016/j.buildenv.2025.112569 | Thermal comfort in sight: Thermal affordance and its visual assessment for sustainable streetscape design | 在 CSV 中；曾因 `surveys` 复数被 `\bsurvey\b` 误杀（v5 已修，应随粗筛自动命中；留作回归用例） |
| 10.1016/j.compenvurbsys.2025.102350 | Identifying street multi-activity potential (SMAP) and local networks with MLLMs and multi-view graph clustering | [ScienceDirect PII S0198971525001036](https://www.sciencedirect.com/science/article/pii/S0198971525001036)；在 CSV 中；**v5 未过**（无 survey/street-view 字样）；**v6 应自动命中**（留作回归） |
