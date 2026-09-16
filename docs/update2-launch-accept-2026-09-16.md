# update2 导航简化与上线收尾 — 2026-09-16

正式站发布是最后一步。本轮结论：**仍阻塞**。未执行 `wrangler deploy`，`sp-survey.org` 路由未切。

截图中文会豆腐字，以无障碍文本为准。

## 本轮改动

- Admin 顶栏：`Introduction` / `1. Dataset` / `2. Builder` / `3. Share` / `4. Results` / `Practice` / `Silicon`；中文 `简介` / `1. 媒体` / `2. 设计` / `3. 分享` / `4. 结果` / `试填` / `硅基`。正文标题仍用完整句。Tab 索引未改（Practice=5，Silicon=6）。
- 顶栏 `variant="scrollable"`，缩小 padding / minHeight，`whiteSpace: nowrap`，选中后 `scrollIntoView({ inline: 'nearest', block: 'nearest' })`。
- Jest 真实渲染 `react-markdown`（不再整模块 mock）；`transformIgnorePatterns` + vfile/`unist` mapper；CSS mapper 避免 `survey-core` 样式被当成 JS。
- `scripts/check-sql-idempotency.mjs` + PGlite 对增量 SQL 连续执行两次。
- Silicon 租约失败即停：独立 `claimedBy`、RPC 空行即退、失租约写拒绝、限流 `delaySeconds: 15`。`createRun` 同时写 `mode` 与 `assistant_mode`。草稿 RPC 缺失返回 `DRAFT_SAVE_RPC_MISSING`。
- 操作拆成：继续未完成 / 仅重试失败项 / 复用设置重新运行。完成 Snackbar 按 run id 一次。Skill / annotation 标未验证。
- 过程页补上缺失的 `onRetryFailed` 参数（否则打开已结束任务会白屏）。

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
| `ai_agent_inbox_after_run.sql` | inbox 表可读（target/status） | 未执行 |
| `ai_agent_inbox_payload.sql` | **缺** `payload`；**缺** `ai_runs.parent_run_id` | **未执行** |
| `save_project_draft_revision_id.sql` | `save_project_draft` RPC 存在（`not authenticated`） | 未执行 |
| `silicon_background_runs.sql` | **缺** `claimed_by` / `silicon_answer_units` / `claim_silicon_*` | **未执行** |

失败即停码：本地新代码 `POST /api/agent/silicon/runs` → **503 `SILICON_LEASE_UNAVAILABLE`**。

## Cloudflare

- `AGENT_QUEUE` = `sp-agent-runs`（wrangler.jsonc producers/consumers）。
- 预发布：`npx wrangler versions upload` → Version `d1276e54-ee93-4afe-bdb7-eb218e24f3b0`。
- Preview URL：`https://d1276e54-sp-survey.sijieyangyang.workers.dev`（不切 `sp-survey.org`）。
- 匿名 `GET /api/agent/silicon/runs` → 401 `UNAUTHENTICATED`（Worker 已起来）。
- 浏览器从 localhost 跨源 POST preview 被 CORS 挡住；未在 preview 上跑通带图 Flash。
- 正式路由：未 `wrangler deploy` / `versions deploy`。

## 预发布 Flash

**未跑成。** 共享库缺租约对象，新 Worker 会 503，不能再走旧的无 CAS PATCH。历史 Express Flash（`9ae9ccb8` / `19488252`）不能替代本轮 preview。

误触发：旧 Express 进程曾 `202` 出 run `8796bec7-a559-41e7-85cb-b557b32720b4`，已 `POST .../cancel` → 200。重启 Express 后新创建为 503。

## 用户数据验收

项目 `proj_1789566423826_956702be0f`（Silicon counts media accept）。

| 项 | 结果 | 证据 |
|---|---|---|
| 工作副本标题 | 部分 | 未保存标题先出现在输入框；自动保存后服务端 `draftUpdatedAt=2026-09-16T16:08:39.68+00:00`，title=`Working copy title accept` |
| 第二窗口冲突 | 通过 | MCP `survey_apply_operations` 用过期 token → `CONFLICT`「Project draft changed. Re-read before updating.」未覆盖新 `draftUpdatedAt` |
| 保存后改必答 | 通过 | MCP `replaceConfig` 恢复标题并设 `comfort.isRequired=true`；`draftUpdatedAt=2026-09-16T16:10:11.302Z` |
| 刷新读服务端稿 | 通过 | 刷新后标题回到 `Silicon counts media accept`，不再是 `Stale window title` |
| AI 改主题色 → 撤销 → 刷新 | **未完成** | 未再跑助手改色；撤销依赖助手 snapshot |
| 混合 after-run 模式对齐 | **阻塞** | 缺 `ai_runs.parent_run_id` / inbox `payload` |
| Silicon 切项目 | 部分 | 侧栏点了 `Queue mixed session`；列表随项目过滤的代码已在 |
| Silicon 刷新 / 中途停止 | 通过（停止） | 取消 `8796bec7` 200 |
| 真人结果不混 Silicon | 通过 | `survey_list_responses` / `survey_results_summary` / `survey_export_responses` 均为 n=0；硅基答案不在人结果里 |
| 真人完整提交 | **未完成** | 打开了混合队列问卷并填了城市；8 页带图未走完 |

## 回退

- Worker：`wrangler versions deploy` 指回上一正式版本；预发布 `d1276e54` 未切流量，可忽略。
- 增量 SQL：本轮未应用到共享库，无需回滚。落地后也不整库回滚，只停用未就绪功能。
- 误改标题已恢复为 `Silicon counts media accept`。`comfort.isRequired` 仍为 `true`（本轮保存后改必答留下的服务端稿）。

## 结论

**仍阻塞**

1. 共享库未应用 `supabase/silicon_background_runs.sql` — 新代码无法创建/执行 Silicon。
2. 共享库未应用 `supabase/ai_agent_inbox_payload.sql` — 混合会话 after-run 的 `assistant_mode` / `parent_run_id` / inbox `payload` 无法落库。
3. Cloudflare 预发布未跑通真实图片 Flash（缺 1，且 localhost→preview CORS）。
4. AI 撤销与真人完整提交未在本轮闭环。

需要：用有 DDL 权限的连接只执行上述两条增量，再在 preview Worker 上跑一次 Flash 图片 Silicon，然后才能写「可以正式发布」。
