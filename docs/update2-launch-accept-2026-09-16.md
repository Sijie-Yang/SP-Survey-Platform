# update2 导航简化与上线收尾 — 2026-09-16

正式站发布是最后一步。两条增量已由人工应用到共享库。续租修复后本地 Flash 已 4/4。本轮结论：**仍阻塞（Cloudflare workers.dev 登录后的 Flash / 闭环验收尚未完成）**。未执行 `wrangler deploy`，`sp-survey.org` 路由未切。PR 保持未合并。

截图中文会豆腐字，以无障碍文本为准。

## 本轮改动

- Admin 顶栏：`Introduction` / `1. Dataset` / `2. Builder` / `3. Share` / `4. Results` / `Practice` / `Silicon`；中文 `简介` / `1. 媒体` / `2. 设计` / `3. 分享` / `4. 结果` / `试填` / `硅基`。正文标题仍用完整句。Tab 索引未改（Practice=5，Silicon=6）。
- 顶栏 `variant="scrollable"`，缩小 padding / minHeight，`whiteSpace: nowrap`，选中后 `scrollIntoView({ inline: 'nearest', block: 'nearest' })`。
- Jest 真实渲染 `react-markdown`（不再整模块 mock）；`transformIgnorePatterns` + vfile/`unist` mapper；CSS mapper 避免 `survey-core` 样式被当成 JS。
- `scripts/check-sql-idempotency.mjs` + PGlite 对增量 SQL 连续执行两次。
- Silicon 租约失败即停：独立 `claimedBy`、RPC 空行即退、失租约写拒绝、限流 `delaySeconds: 15`。`createRun` 同时写 `mode` 与 `assistant_mode`。草稿 RPC 缺失返回 `DRAFT_SAVE_RPC_MISSING`。
- 操作拆成：继续未完成 / 仅重试失败项 / 复用设置重新运行。完成 Snackbar 按 run id 一次。Skill / annotation 标未验证。
- 过程页补上缺失的 `onRetryFailed` 参数（否则打开已结束任务会白屏）。
- 续跑把同一 `claimedBy` 传回队列（限流 15s 与下一 unit 都复用），不再新开租约撞自己。空 claim 仍是 `lease_held`，失主写仍拒绝。
- Worker 对 localhost / workers.dev Origin 放开 Agent API CORS；`*.workers.dev` 只接受来自 localhost 的 preview session postMessage。

## 导航验证

| 视口 | 语言 | 结果 |
|---|---|---|
| 1280 桌面 | EN | 七个工作区标签单行 `nowrap`，当前 Silicon 可见。`docs/update2-nav-desktop-1280-en.png` |
| 390 | EN | 选 Introduction 后该标签滚入视口（x=56）。 |
| 360 | EN | 选 Silicon 后该标签可见（x=239）。`docs/update2-nav-360-en.png` |
| 1920 | ZH→EN | 中文标签为简介/1. 媒体/…/试填/硅基；切换后 Introduction/1. Dataset/…/Practice/Silicon。 |

## 检查结果

| 检查 | 结果 |
|---|---|
| `catalog:check` / `schema:check` / `sql:check` | 通过 |
| PGlite `scripts/tests/incremental-sql.mjs` 双次执行 | 通过 |
| `test:ci` | 113 suites / 611 tests |
| `test:agent` + adminResults/skill + media-pipeline + Worker smoke import | 通过 |
| `npm run build` | 通过 |
| `npx wrangler deploy --dry-run` | 通过；绑定 `AGENT_QUEUE`=`sp-agent-runs` |

## SQL 探测（共享库 `wskhzjfrhjueiqauhpmb.supabase.co`）

探测脚本：`node scripts/probe-launch-sql.mjs`。未把「以前跑过 SQL」当成已落地。本环境没有 `psql` / `DATABASE_URL` / Supabase CLI 登录，**未能执行 DDL**。

| 增量 | 探测 | 本轮执行 |
|---|---|---|
| `ai_runtime.sql` / `silicon_samples.sql` | `silicon_runs`、`ai_agent_inbox` 可读 | 未重跑整套 |
| `ai_agent_inbox_after_run.sql` | inbox 表可读（target/status） | 未重跑 |
| `ai_agent_inbox_payload.sql` | `payload` 可读；`parent_run_id,inbox_id,assistant_mode` 200 | **已执行（人工）** |
| `save_project_draft_revision_id.sql` | `save_project_draft` RPC 存在（`not authenticated`） | 未重跑 |
| `silicon_background_runs.sql` | `claimed_by` / `silicon_answer_units` / `claim_silicon_*` 均 200 | **已执行（人工）** |

`node scripts/probe-launch-sql.mjs` → `applyNeeded: []`。创建 Silicon 不再 503。续跑必须把同一 `claimedBy` 传回队列，否则下一 unit 会撞还没过期的租约。

## Cloudflare

- `AGENT_QUEUE` = `sp-agent-runs`（wrangler.jsonc producers/consumers）。
- 预发布：`npx wrangler versions upload` → 先 `d1276e54`，续租修复后再传 `0ac67fe1-d942-4621-a0ed-35a0ddff6771`。
- Preview URL：`https://0ac67fe1-sp-survey.sijieyangyang.workers.dev`（不切 `sp-survey.org`）。
- 匿名 `GET /api/agent/silicon/runs` → 401 `UNAUTHENTICATED`（Worker 已起来）。
- 浏览器从 localhost 跨源 POST preview 被 CORS 挡住；未在 preview 上跑通带图 Flash。
- 正式路由：未 `wrangler deploy` / `versions deploy`。

## 预发布 Flash

共享库租约落地后，本地 Express（同一 Supabase，新 `claim_*` / `silicon_answer_units`）跑通图片 Flash：

| 项 | 值 |
|---|---|
| runId | `a1e0ea24-b3ff-44e8-9cf3-feacf9002317` |
| 模型 | `qwen-dashscope` / `qwen3.8-flash` |
| 题 | `comfort` × trialCount 4 |
| 媒体 | `preview_library` 24 张 |
| 结果 | `completed`，processed 4 / valid 4 / failed 0 |
| 答案 | 4 / 3 / 6 / 4，每轮 1 张图 |

续跑曾因新 `claimedBy` 撞租约停在 2/4。同一执行者续租后，新开一轮不再卡住：

| 项 | 值 |
|---|---|
| runId | `795a6a83-5c3b-4f88-a34a-9a7605f87fb3` |
| 模型 | `qwen-dashscope` / `qwen3.8-flash` |
| 结果 | `completed`，processed 4 / valid 4 / failed 0 |
| 答案 | 4 / 6 / 4 / 5，1 条 response |
| 再 process / 刷新 | 仍 4/4，答案不变 |
| 排队即取消 | `80095dac-6e2a-4df7-a16a-4b3d0cd85ad3` → `cancelled`，0 答 |
| 运行中取消 | `2ba2f836-f063-421d-8d3f-3298fb768c8a` → `cancelled`，停在 1/4，不再续答 |

workers.dev 登录与预发布 Flash 仍待带会话跑通；已加 CORS + preview session handshake，尚未 `versions upload` 新预发布。

## 用户数据验收

项目 `proj_1789566423826_956702be0f`（Silicon counts media accept）。

| 项 | 结果 | 证据 |
|---|---|---|
| 工作副本标题 | 部分 | 未保存标题先出现在输入框；自动保存后服务端 `draftUpdatedAt=2026-09-16T16:08:39.68+00:00`，title=`Working copy title accept` |
| 第二窗口冲突 | 通过 | MCP `survey_apply_operations` 用过期 token → `CONFLICT`「Project draft changed. Re-read before updating.」未覆盖新 `draftUpdatedAt` |
| 保存后改必答 | 通过 | MCP `replaceConfig` 恢复标题并设 `comfort.isRequired=true`；`draftUpdatedAt=2026-09-16T16:10:11.302Z` |
| 刷新读服务端稿 | 通过 | 刷新后标题回到 `Silicon counts media accept`，不再是 `Stale window title` |
| AI 改主题色 → 撤销 → 刷新 | **未完成** | 已建测试项目 `proj_1789577693817_c4533fee11`；尚未跑助手改色 |
| 混合 after-run 模式对齐 | 列已落地，未复测 UI | `parent_run_id` / `payload` 探测 200 |
| Silicon 切项目 | 部分 | 侧栏点了 `Queue mixed session`；列表随项目过滤的代码已在 |
| Silicon 刷新 / 中途停止 | 通过（停止） | 取消 `8796bec7` 200 |
| 真人结果不混 Silicon | 通过 | `survey_list_responses` / `survey_results_summary` / `survey_export_responses` 均为 n=0；硅基答案不在人结果里 |
| 真人完整提交 | **未完成** | 改到测试项目 `proj_1789577693817_c4533fee11` 三页问卷；尚未提交 |

## 回退

- Worker：`wrangler versions deploy` 指回上一正式版本；预发布 `d1276e54` 未切流量，可忽略。
- 增量 SQL：已人工应用两条；不整库回滚，只需停用未就绪功能。
- 误改标题已恢复为 `Silicon counts media accept`。`comfort.isRequired` 仍为 `true`（本轮保存后改必答留下的服务端稿）。

## 结论

**仍阻塞（缩小后）**

1. Cloudflare preview（workers.dev）尚未用合法登录跑 Flash 问答 / 修改 / 八页生成 / 图片 Silicon 4。本地 Express + 共享库已 4/4，刷新/取消/重复投递未重复答题，并发保护未放松。
2. AI 撤销与真人完整提交仍未闭环（测试项目已建）。
3. `main` 不自动部署 Worker（CI 仅 test/build/dry-run；Pages 只发 templates/docs）。

SQL 两条已不再阻塞。正式站仍未切。PR 保持未合并。
