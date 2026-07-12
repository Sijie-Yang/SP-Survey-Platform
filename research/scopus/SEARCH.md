# Scopus 搜索式

复制下面整段到 Scopus → **Advanced search**：

```text
TITLE-ABS-KEY (
  (
    streetscape* OR "street view" OR "street-view" OR "google street view" OR "baidu street view"
    OR GSV OR "urban scene*" OR "urban imag*" OR "street-level imag*" OR sidewalk*
    OR façade OR facade OR "public space*" OR plaza* OR waterfront OR "residential street*"
    OR "window view*" OR townscape OR "urban canyon" OR "street design" OR "urban design"
    OR ( ( "built environment" OR "urban environment" OR neighbourhood OR neighborhood )
         W/8 ( visual OR image OR photo OR photograph* OR "street view" OR VR OR "virtual reality" ) )
  )
  AND
  (
    perception OR perceived OR perceptual OR preference* OR aesthetic* OR "visual quality"
    OR "visual preference*" OR "scenic beauty" OR restorative* OR walkab*
    OR "perceived safety" OR "sense of safety" OR enclosure OR complexity OR imageability
    OR livel* OR "sense of place" OR "urban vitality" OR "green view" OR "human-scale"
    OR survey OR questionnaire OR rating OR pairwise OR "choice experiment" OR "stated preference"
  )
)
```

左侧筛选：Document type = Article；Language = English；Year 按需（建议 `PUBYEAR > 2015`）。

Export → CSV（勾选 Abstract），存到 `research/scopus/exports/YYYY-MM-DD.csv`。

**注意：** arXiv / 部分新刊（如 Nature Cities）可能尚未进 Scopus 或未进本次检索命中。  
重要文章若不在 CSV，加入 [`seeds.md`](./seeds.md) 或直接把链接给我强制收录。
