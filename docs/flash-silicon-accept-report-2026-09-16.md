# Flash / Silicon accept — 2026-09-16（缺陷修复后重跑）

状态只标 **通过 / 失败 / 未测 / 测试方法无效**。不使用 “Pass, with defects”。

本地 Admin：http://127.0.0.1:3000/admin  
助手与 Silicon 路由：`qwen-dashscope` / `qwen3.8-flash` / `medium`  
原始 NEW 2 未改：`proj_1789528664732_yxyt5slek`，`draftUpdatedAt=2026-09-16T07:05:54.794+00:00`，8 页 / 28 题。  
不要用已被覆盖的预测试副本 `proj_1789546883504_14a45400e1`（2 页，`draftUpdatedAt=2026-09-16T08:48:24.172+00:00`）。

四条短路径留给研究者手测，见文末。

---

## 1. 保存、撤销、结果卡、轮询

| 项 | 状态 | 证据 |
|---|---|---|
| `save_project_draft` 最小 SQL | 通过 | `supabase/save_project_draft_revision_id.sql`；`gen_random_uuid()` + `search_path=public` + `GRANT EXECUTE` |
| 浏览器保存遇 `gen_random_bytes` 回退 REST PATCH | 通过 | `saveProjectDraftOptimistic` 对齐 worker |
| 撤销：先保存恢复稿 → 回读 → 再 `applySurveyConfig` | 通过（代码） | `handleRevertAiChange`；失败不清 snapshot、不 autosave |
| 结果卡四态（已保存 / 已保存并核对 / 保存失败 / 核对未完成） | 通过（代码 + Generate 卡文案） | G1/G2/G3 卡片「已生成 N 页问卷，保存已核对」 |
| 「查看修改」字段差 | 通过（代码） | 读该 run 的 before/after，`summarizeDraftDiff` |
| `waitForAgentRun` 只跟 `parent_run_id === current`，子失败不吞 | 通过（代码） | `src/lib/agentApi.js` |
| AI 改主题色 → 撤销 → 刷新 | 未测 | 留给手测 1 |
| 第二窗口已改稿后撤销不得覆盖 | 未测 | 留给手测 1 |

---

## 2. 题目 / 页面工作副本提交

| 项 | 状态 | 证据 |
|---|---|---|
| PageEditor 上报 `dirty` + `workingCopy` | 通过（代码） | `PageEditor.js` |
| `commitEditorWorkingCopy`：题 → 页 → `surveyConfig` → 校验 → 保存 → 新 `draftUpdatedAt` | 通过（代码） | `AdminApp.js`；`SurveyBuilder` `editorCommitKey` 重挂载 |
| 「保存后执行」先提交再发 AI；`skipConflict` 仅表示已提交 | 通过（代码） | `onPrepareWrite` |
| 保存失败保留输入与待发请求 | 通过（代码） | 失败不向模型发旧稿 |
| 问答读 workingCopy，标尚未保存 | 通过（代码） | `summarizeWorkingCopy` 含 `page.*` / `question.*` |
| 键盘改题标题不保存，问「刚改的标题」；再「设为必答」+ 保存后执行 | 未测 | 留给手测 2 |

总标题 3s 自动保存保留。不把标题 autosave 当成 Assistant 偷写。

---

## 3. 混合会话排队

副本：`proj_1789550895154_74540273d4`  
会话：`3d41687f-4a3d-4b4e-8d18-cd672eab5df1`  
草稿前：`2026-09-16T09:28:15.154+00:00`（8 页 / 28 题）  
草稿后：`2026-09-16T09:54:22.315+00:00`（仍 8 页 / 28 题）

| 项 | 状态 | 证据 |
|---|---|---|
| Inbox `payload`（assistantMode / projectId / parentRunId / editorContext） | 通过 | `supabase/ai_agent_inbox_payload.sql`；`enqueueSessionInput` 写当前请求模式 |
| 原子领取 1 条 + 领取成功后 `createRun` | 通过（代码） | `claimAfterRunInput`；失败 `markInboxFailed` |
| 去掉 `startDesignerRun(...).catch(() => null)` | 通过（代码） | `designerChat.mjs` 持久 `dispatchAgentRun` |
| 同一会话 Question + Adjust 后 after-run 写入 | 通过 | Question `974e0e2c-cdb1-4bd2-88f0-80b18d6324ed`「现在有几页？」无写；Adjust 主题 `#2E7D32` `e2135c31-d7a8-46fe-8303-a9aed04a4620`；完成页 `c8e8a2a9-9852-42d5-b3e5-b0bce48f9609`；父背景 `#E8F5E9` `0ff06945-c639-4877-985b-045d10fca5ba`；after-run 子 `d884580a-96bd-4307-9830-62c0f4297cfa` 写入首页标题「混合队列首页」 |
| 子 run 列表 `mode` 等于 inbox payload | 失败 | 子 run 列表为 `mode=agent`，steer payload 为 `adjust`。写入已发生，字段未对齐 |
| 取消 void 已排队项 | 通过（代码） | `voidQueuedSessionInput` 只 void `queued` |

独立 Adjust 会话只作补充，不替代本行。

---

## 4. Generate 意图 + 三次八页 Flash

意图：`GENERATE` 含 `重新生成|regenerate|rebuild`，中文允许修饰语后再接 `问卷|调查`；`EXPLAIN` 仍优先。回归在 `taskIntent.test.js` / `taskIntent.test.mjs`。

每条以保存后 `survey_get_draft` 为准。两页小卷 / 加单题 / 只读问答不计通过。原始 NEW 2 未碰。

| 副本 | 提示 | 状态 | 页/题 | 前 `draftUpdatedAt` | 后 `draftUpdatedAt` | runId / sessionId |
|---|---|---|---|---|---|---|
| G1 `proj_1789550893149_7b17647fb6` | 「重新生成一个至少 8 页、覆盖多数题型的问卷」 | 通过 | 9 / 38 | ~09:28 | `2026-09-16T09:37:55.291+00:00` | `c5231873-4231-4e8e-9ea3-619d292a9092` / `faae97f6-f52b-4cf7-88e1-b2ac783b45eb` |
| G2 `proj_1789550892945_c502f08cf8` | 「请重新生成一份覆盖多数题型、至少八页的问卷」 | 通过 | 9 / 38 | `2026-09-16T09:28:12.945+00:00` | `2026-09-16T09:44:02.649+00:00` | `9da4d377-6225-4a91-b03e-af3d4a1d3bc8` / `126113dd-a217-413c-beeb-01a4f111d037` |
| G3 `proj_1789550892912_2d04df5983` | 「帮我重建一份至少 8 页、题型尽量全的问卷」 | 通过 | 10 / 40 | ~09:28 | `2026-09-16T09:49:34.659+00:00` | `c6ca3315-c5e6-44b1-9930-79558e52a5d2` / `fdbbbb4e-e915-4be1-9450-e6d78bf686b5` |

验收细节（三份均满足）：

- 标题：G1 城市街道视觉感知调查（全题型版）；G2 城市街景视觉感知综合调查（全题型版）；G3 城市街景舒适度感知调查（全题型版）
- 卡片：「已生成 N 页问卷，保存已核对」
- `name` 唯一；滑块 `id`/`label` 齐全；选项存在；校验 `valid: true`
- 参与者预览可开（本地 `/survey?project=…`）：G1 / G2 / G3 首页均可点「下一页」

「告诉我如何设计问卷」仍为问答：回归覆盖，本轮未再烧一次 Flash。

---

## 5. Silicon 结果与图片流

媒体副本：`proj_1789551035192_c15a48d4da`（Silicon media accept）  
草稿：`2026-09-16T09:43:30.844+00:00`  
Personas：Walker A `32eeb8c0-061f-42ec-ac2b-a667a9101267`，Walker B `f7f8dc16-9e6a-4d50-9fb8-6ca982b8665e`  
预测试页：`si_rating` / `si_choice` / `si_rank` / `si_slider`（`trialCount=1`）  
文件夹标识：dataset tags `sun` / `no sun`（对象 folder 字段被打平为空；CSV `media_folders=sun|no sun|features`）  
真人 `survey_list_responses`：`total=0`（全部 Silicon 跑完后仍为 0）  
截图：`docs/accept-silicon-list-2026-09-16.png`  
CSV 样例：`docs/silicon-export-9ce2fe63-sample.csv`

| 项 | 状态 | 证据 |
|---|---|---|
| 列表 refresh 水合 compare；未返回前「加载中」，空对象不当 0 | 通过 | 列表行：4 / 16 / 3+1 / 1+1 等，不是假 0 |
| Compare 含 persona_name / valid / status / error / images / responses | 通过（代码 + 1×1 答） | `getSiliconCompare` |
| 历史 run 用该行 snapshot，不用当前草稿解释 | 通过（代码） | 行上 `Draft version: 2026-09-16T09:43:30.844+00:00` |
| `selectedQuestionNames === []` 零题并禁用开始 | 通过 | 桌面点掉全部 Chip 后 `Run silicon pretest` 为 disabled |
| 无图在调用模型前 skip | 通过（代码） | `questionNeedsShownMedia` + `pickMediaForSilicon` 空则不 `askVlm` |
| CSV 列含来源 / run_id / 模型 / 草稿版本 / 媒体文件夹 | 通过 | 表头 `response_source,run_id,model,provider,draft_updated_at,media_folders,media_ids,...` |
| 1 persona × 1：评分 / 选择 / 排序 / 滑块组 | 通过 | run `9ce2fe63-2033-4f32-a6ae-3b3b54c911ba` completed，4/0/0，tokens 9146；si_rating=6，si_choice=image_3，si_rank，si_slider `{shade:3,safety:5}`；真实 R2 图 |
| 2 personas × 2 | 通过 | run `94b10527-f4e3-4c1a-902b-e10c07f7d464` completed 4/4，16 answers，tokens 36805 |
| 换 seed 小样 | 通过 | seed 99 run `8f47fc93-33a5-4756-96f2-ac268c1cc8a7` completed，3 answer / 1 error（si_choice 缺）；rating 图 29044 vs seed42 73989 |
| 取消 | 通过 | `59108b18-d3bb-4b55-a00e-b63d75e0974c` cancelled |
| 预算不足 | 通过 | budget 80 run `dac50d9c-10b9-4147-827f-ed93fbf28dd5` partial，tokens 847，「Token budget exhausted」 |
| 中断恢复 | 通过 | `908e259d-e7cc-4c92-995b-8beabc305244` process 再 process → completed 1/1，tokens 817 |
| trial / set / Skill / annotation | 未测 | 平台仍标暂不支持；与「基础图片题」分开。`comfort (imagepicker): Multi-trial / set media assignment is not supported` |

---

## 6. 手机入口与废副本审批

| 项 | 状态 | 证据 |
|---|---|---|
| 抽屉宽 `min(420px, 100vw)` | 通过 | 360：paper 宽 360、Close 右缘 346；390：paper 宽 390、抽屉内 Close 右缘 376 |
| 360 真点：溢出菜单 → AI → Close 在视口内 | 通过 | Close AI sidebar 可点，抽屉关闭 |
| 390 真点：AI / Preview / Builder / Silicon | 通过 | Preview 右缘 346；Silicon / Builder 可切 |
| 桌面真点：设置、预览、助手、Silicon、编辑保留 | 通过 | Survey Settings 展开；Open AI；Assistant settings；Silicon 选中；题目列表仍在 |
| 输入不被键盘挡住 | 未测 | 仿真视口无真实软键盘 |
| 真机 | 未测 | 未接物理手机 |
| MCP 发布无 `confirm` 拒绝 | 通过 | `survey_publish` → `Set confirm:true to publish.` |
| MCP 删除无 `confirm` 拒绝 | 通过 | `survey_delete_project` → `Set confirm:true to permanently delete...` |
| Agent 发布审批拒绝 | 通过 | 废副本 `proj_1789550895644_6eefef4db1`；run `fc984454-b90f-4943-814a-3f69ad06928f` `awaiting_approval`；approval `e1061dea-158d-43e6-b445-38ae20839a10` denied；run `cancelled`；`publishedVersion=0` |
| Agent 删除审批拒绝 | 通过 | run `2dc4ba70-d935-4995-aefe-e5a965492759`；approval `e3aec0aa-daa2-4940-858e-da625e130c8b` denied；项目仍在，`draftUpdatedAt=2026-09-16T09:28:15.644+00:00` |
| 取消后审批失效 | 通过 | 对已 denied 再 `approved:true` → `APPROVAL_NOT_FOUND` / `already decided` |

废副本未发布、未删除。未碰真实研究项目。

补充：`请发布这个问卷到参与者链接` 未命中 `PUBLISH`（要「发布到参与者」或「正式发布」），第一次 Agent 只解释。正式发布用语后才出审批。此项记意图缺口，不改本轮 Generate 结论。

---

## 7. 离线测试

| 项 | 状态 |
|---|---|
| 本轮相关 Jest（taskIntent / siliconSupport / SiliconSamples / useSurveyAssistant / surveyAssistantUtils） | 通过 |
| `AiAssistantSidebar.test.js` | 测试方法无效 | 预存 `react-markdown` ESM，与本轮改动无关 |

---

## 留给你的四条手测

1. **撤销**：任意验收副本上 AI 改主题色 → 撤销 → 刷新，颜色与结果卡一致；另一窗口先改稿，本窗口撤销不得覆盖。
2. **工作副本**：开一道题，键盘改标题不保存，问「这道题刚改的标题是什么」（应答尚未保存的标题）；再说「把这道题设为必答」并点保存后执行 → 刷新后标题与必答仍在。
3. **混合排队**：同一会话先 Question 再 Adjust，运行中再发 after-run，刷新后两条都落地。
4. **360 关闭**：真机或 360 视口打开助手，关闭/返回始终在视口内可点。

---

## 总表

| 轨道 | 状态 |
|---|---|
| 保存 / 撤销 / 结果卡 / 轮询（代码） | 通过 |
| 撤销 / 并发窗口（手测） | 未测 |
| 题目/页面 working copy（代码） | 通过 |
| 键盘脏稿 + 保存后执行（手测） | 未测 |
| 混合会话 after-run 写入 | 通过 |
| 子 run `mode` 对齐 payload | 失败 |
| Generate 八页 ×3 + 预览 | 通过 |
| Silicon 图片四步 + 取消/预算/恢复/导出/真人数 | 通过 |
| trial / set / Skill / annotation | 未测 |
| 360 / 390 / 桌面点击 + 抽屉 | 通过 |
| 真机软键盘 | 未测 |
| 废副本发布/删除审批拒绝 | 通过 |
