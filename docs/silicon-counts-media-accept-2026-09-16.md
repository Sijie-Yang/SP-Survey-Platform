# Silicon 计数 / 媒体对齐 — Flash accept 2026-09-16

本地 Admin：http://127.0.0.1:3000/admin  
模型：`qwen-dashscope` / `qwen3.8-flash`  
空媒体草稿项目：`Silicon counts media accept` `proj_1789566423826_956702be0f`  
人设：林女士 `d9f85740-dd44-42e2-bbd9-e8dafbfd53f8`  
`silicon_background_runs.sql` 额外列未远程套用；列表卡用 `question_names` + `progress_total` 回退。

截图中文会豆腐字，以无障碍文本为准。

| # | 项 | 状态 | 证据 |
|---|---|---|---|
| 1 | 4 轮是 trial，不是 4 个人设 | 通过 | 冻结问卷 `comfort` `trialCount=4`；run `9ae9ccb8-f121-4d84-a48c-77d2ac40ef2e`：`question_names=['comfort']`，`progress_total=4`，1 人设 × 1 答卷 × 1 题 × 4 轮。过程页「1 个人设 · 1 份模拟答卷 · 1 道题，共 4 轮」 |
| 2 | 题目详情按原题号 + 4 张预览图 | 通过 | 「林女士 · 第 1 份答卷」→「第 1 题｜街景舒适度评分 已处理 4/4 轮」；答案 4 / 4 / 6 / 5，每轮一张 `skill-preview` 街景。`docs/silicon-process-comfort-4trials-2026-09-16.png` |
| 3 | 草稿空媒体回退预览库 | 通过 | 项目 `preloadedImages` 空；`media_snapshot.source=preview_library`，`availableCount=24`。文案「本次使用平台预览媒体库 · 可用 24 张图片」 |
| 4 | 已发布空媒体不得改用当前预览库 | 通过 | 对 published-empty 项目 `POST /runs` → `400 SILICON_NO_MEDIA_SOURCE` |
| 5 | 历史全跳过仍失败 | 通过 | `fa40be68` 保持 failed，skipped 4，valid 0。已结束卡「已结束，未获得有效答案」 |
| 6 | 任务列表分进行中 / 已结束 | 通过 | 进行中：「1 个人设 · 1 份模拟答卷 · 1 道题，共 1 轮」。已结束同时出现成功（有效 4 / 有效 1）与失败（有效 0）。`docs/silicon-tasks-active-2026-09-16.png` `docs/silicon-tasks-ended-2026-09-16.png` |
| 7 | 单轮题不算 4 轮 | 通过 | `single` `trialCount=1`「Single-trial comfort」。run `19488252-d0c6-4828-97fe-8a51a5e4f143`：`progress_total=1`，completed，valid 1，预览库 24 张，事件含图片 |
| 8 | 复用设置创建新 run | 通过（代码） | `useSiliconTasks.reuse` → `createSiliconRun`；按钮文案「复用设置重新运行」，不是续跑 |
| 9 | 选题刷新不重置 | 通过（单测） | `SiliconSamples.test.js`：supported-list 刷新后仍只选中原题 |

单测：`CI=true npx react-scripts test --watchAll=false --testPathPattern='siliconSupport.test|SiliconSamples.test'`；`node --test worker-lib/silicon/*.test.mjs`。
