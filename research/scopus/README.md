# Scopus → 论文库 / 模板

## 粗筛怎么做（方法说明）

输入：你放到 `exports/*.csv` 的 Scopus 导出（须含 **Title + Abstract + Keywords**）。

对每一行拼成文本：`Title + Abstract + Author Keywords + Index Keywords`，然后用正则做 **AND** 判断：

```text
通过 = 城市图像/街空间视觉方法命中
       AND (问卷调查  OR  人类感知/步行活动评估)
       AND 摘要长度 ≥ 60
       AND （若命中硬排除词，则必须同时有经典 survey/questionnaire 才保留）
```

同一 CSV 内按 DOI（无 DOI 则标题+年份）去重。  
不在 CSV 里的重要文章写入 [`seeds.md`](./seeds.md)，合并进导入清单。

重跑：

```bash
npm run research:filter
npm run research:enrich
```

当前版本：**v6**（相对 v5：补 street space/activity + CV/MLLM 街景方法；人类侧不再只认 survey）。

---

## 必须 1 — 城市图像 / 街空间视觉（任一命中）

| 类别 | 关键词 / 模式 |
|------|----------------|
| 街景 | `streetscape(s)`, `street view(s)`, `street-view`, `street-level`, `GSV`, `SVI`, `baidu street`, `tencent street`, `street imagery` |
| 窗景 | `window view(s)`, `window-view` |
| 城市视觉 | `townscape(s)`, `urban scene(s)`, `urban image/images/imagery`, `visual street` |
| 其它视觉 | `sidewalk`+(image/photo/view), `façade/facade`+(image/photo/visual), `eye-level`+(image/photo/green), `green view`, `public space`+(image/photo/view) |
| **v6** 街空间 | `street space(s)`, `street activity/activities`, `street multi-activity` |
| **v6** 方法邻近 | `street(s)/streetscape/street space` 邻近 `computer vision` / `multimodal` / `MLLM` / `large language model` / `street-view` / `imagery`（双向） |

---

## 必须 2 — 问卷 **或** 人类感知/活动评估（任一命中）

| 类别 | 关键词 / 模式 |
|------|----------------|
| 问卷本体 | `survey` **或 `surveys`**, `questionnaire(s)` |
| 在线/实地 | `online … survey(s)`, `in-field survey(s)` |
| 众包评价 | `crowdsourced/crowdsourcing` + (survey/rating/perception/human) |
| 任务表述 | `visual preference survey`, `photo elicitation`, `participants/participant` + (asked/rated/compared/evaluated/recruited), `respondent(s)` |
| 量表/实验 | `likert`, `pairwise comparison(s)`, `paired comparison(s)`, `stated preference`, `choice experiment(s)`, `human rating(s)`, `subjective rating(s)` |
| **v6** 感知 | `(human\|subjective\|visual) perception(s)`, `perceived safety/quality/walkability/…`, `visual assessment/preference/quality/evaluation` |
| **v6** 活动评估 | `pedestrian activity/activities`, `evaluate … street multi-activity / street space / multi-activity potential` |

> **v4→v5：** `\bsurvey\b` 漏掉复数 `surveys` → 已改为 `surveys?`。  
> **v5→v6：** SMAP 等「街空间 + MLLM/CV、无 questionnaire」文章在 v5 被误杀；人类侧扩展为感知/步行活动评估，图像侧补 street space/activity。

---

## 硬排除（弱）

若文本含下列且 **没有** 经典 survey/questionnaire 路径，则丢弃：  
`autonomous driving`, `object detection`, `semantic segmentation`, `traffic flow prediction`, `crash prediction`, `building energy`, `homelessness`, `clinical trial`, `epidemiolog`, `covid-19 vaccine`, `pavement distress`, `image inpainting`

---

## 已知漏检类型

| 原因 | 例子 | 处理 |
|------|------|------|
| 不在 Scopus CSV | [Quintana SPECS / Nature Cities](https://arxiv.org/abs/2505.12758) | [`seeds.md`](./seeds.md) 强制收录 |
| 规则 bug（已修） | Thermal comfort in sight：`surveys` 复数 | v5+ 已进粗筛 |
| v5 过严（已修） | [SMAP](https://www.sciencedirect.com/science/article/pii/S0198971525001036)（`10.1016/j.compenvurbsys.2025.102350`） | **v6** 应自动命中 |

---

## 精筛（模板）

在已入库论文上标 `template_fit`：`likely` / `unknown` / `unlikely`（另见 `relevance_score`）。  
仔细检查的是「谁适合做成模板」，不是卡死进库。

---

## 你要我重跑时

> 用 `exports/某.csv` 按 README 粗筛 **v6** 重跑（去重，保留 seeds）

```bash
npm run research:filter
npm run research:enrich
```

然后在 **论文库 → 导入粗筛进论文库**。

## 模板

不从摘要自动生成壳模板。读完论文后，把可用问卷写进 `public/project_templates/`（并更新 `index.json`），再在管理端导入 / 批量匹配 DOI。

## 去重

DOI 唯一；无 DOI 用标题+年份；重复导入只补新行。

## 论文库画像 metadata

粗筛 JSON 可附带 `analysis_meta`（感知维度 / 图像来源 / 尺度 / 调查方法 / 样本量等），由规则从 Title+Abstract+Keywords 提取：

```bash
npm run research:enrich
```

会更新 `research/scopus/shortlists/2026-07-12_library_coarse.json` 与 `public/research/scopus-shortlist.json`。  
公开页 `/papers` 用这些字段做 Library profile；**不是**作者原生结构化字段。
