/** Editorial content checked against the source PDFs on 2026-10-06.
 * Each paragraph distinguishes the source study from the current implementation.
 * Pairs are [English, Chinese]; template settings are read separately at runtime.
 */
const p = (en, zh) => ({ en, zh });
export const guideText = (value, language) => value?.[language === 'zh' ? 'zh' : 'en'] || '';
export const GUIDE_SECTIONS = [
  ['concepts', p('What is being measured?', '研究问题与感知概念')],
  ['design', p('How was the study designed?', '原论文如何设计问卷')],
  ['implementation', p('Build it in SP-Survey', '在 SP-Survey 中实现')],
  ['scoring', p('From answers to scores', '从回答到感知分数')],
  ['interpretation', p('From scores to findings', '从分数到研究结论')],
  ['differences', p('Adaptation & reuse', '改编差异与复用')],
];
export const RESEARCH_GUIDES = {
  '2013-salesses-collaborative': {
    topic: p('Safety & Social Perception', '安全感与社会感知'),
    method: p('Pairwise Comparison', '成对比较'),
    medium: p('Image · SVI', '图片 · 街景'),
    participants: { value: '7,872', label: p('participants', '名参与者') },
    mediaCount: { value: '4,136', label: p('images', '张图片') },
    question: 'safer',
    subtitle: p('Compare two streets. Understand how individual choices become a collective image of the city.', '从两张街景的选择开始，理解个人判断如何形成城市的集体感知。'),
    citation: 'Salesses, Schechtner & Hidalgo (2013). The Collaborative Image of The City: Mapping the Inequality of Urban Perception. PLOS ONE, 8(7), e68400.',
    doi: 'https://doi.org/10.1371/journal.pone.0068400',
    source: p('Methods: “Data collection” and “Quantifying urban perception”; Figure 1; Tables 1–2.', '原文 Methods 的 Data collection、Quantifying urban perception；图 1；表 1–2。'),
    concepts: [
      p('The study examines how a place looks to an observer: perceived safety, perceived social class, and uniqueness. These are three separate judgements, each with its own comparisons and score.', '研究测量的是观察者对地方外观的判断：安全感、社会阶层感知和独特性。这是三个不同的评价维度，应分别收集比较记录、分别计分。'),
      p('Its research question concerns differences within and between cities, including the spread of perceptions. A city average alone does not describe that variation. A safety judgement based on a photograph does not measure the actual probability of crime.', '研究关心城市内部及城市之间的差异，包括感知分布有多分散。只有城市平均分，无法表达这种差异。对照片的安全判断也不能直接当作真实犯罪概率。'),
    ],
    dimensions: [
      [p('Safety', '安全感'), p('Which place looks safer?', '哪个地方看起来更安全？')],
      [p('Social class', '社会阶层感知'), p('Which place looks more upper-class?', '哪个地方看起来更高档？')],
      [p('Uniqueness', '独特性'), p('Which place looks more unique?', '哪个地方看起来更独特？')],
    ],
    design: [
      p('The source study used 4,136 images from New York, Boston, Linz and Salzburg. Participants compared two images on one dimension, with an option to judge them equal. Image locations were not shown during voting.', '原研究使用纽约、波士顿、林茨和萨尔茨堡的 4,136 张图片。每次针对一个维度比较两张图，也可以判断为相等。投票时不显示图片的地理位置。'),
      p('The public website collected 208,738 votes from 7,872 participants in 91 countries. It asked age and gender after five clicks and allowed continued voting. These are properties of the original recruitment and interaction, not the current template defaults.', '公开网站收集到来自 91 个国家的 7,872 名参与者的 208,738 次投票；五次点击后询问年龄和性别，并允许继续投票。这些是原研究的招募与交互安排，不是当前模板的默认设置。'),
    ],
    implementation: [
      p('Create a project from the Place Pulse 1.0 template. Prepare your own study images and keep a stable media ID and city label for each. The template suggests New_York, Boston, Linz and Salzburg folders; replace these with your study sites if adapting it.', '从 Place Pulse 1.0 模板创建项目。准备研究图片，为每张图保留稳定的媒体 ID 与城市标签。模板建议使用 New_York、Boston、Linz、Salzburg 文件夹；迁移到其他城市时，替换为自己的研究地点。'),
      p('Keep one image-choice question per dimension, two images per trial, and the Equal option. Plan image coverage across the whole sample, rather than equating the number of trials per participant with comparisons per image. Preview, pilot, then release a participant version.', '每个维度保留一道双图选择题，并保留 Equal 选项。按整体样本规划每张图的比较覆盖量，不要把“每人轮次”当作“每图比较次数”。先预览、小规模试答，再发布参与者版本。'),
    ],
    scoring: [
      p('Retain the two displayed media IDs, the chosen image or tie, the dimension, and the participant for every trial. In Results, set the question’s Score to Q-score. The current implementation adjusts the win fraction by the performance of opponents; ties enter the comparison denominator, not the win count.', '每轮保留两张展示图片的 ID、选择或平局、评价维度与参与者信息。在结果里把该题的计分方法选成 Q-score。当前实现用对手的表现校正胜率；平局进入比较次数的分母，不计为获胜。'),
      p('Q = (10 / 3) × [win fraction + mean win fraction of defeated opponents − mean loss fraction of opponents that defeated it + 1]. Inspect comparison counts alongside the 0–10 scores. The source’s roughly 22–32 comparisons per image are a study-specific stability finding, not a universal sample-size rule.', 'Q = (10 / 3) ×［自身胜率 + 被击败对手的平均胜率 − 击败自身的对手的平均负率 + 1］。阅读 0–10 分数时，也要检查比较次数。原文约 22–32 次／图是该研究的稳定性发现，不是所有研究通用的样本量要求。'),
    ],
    interpretation: [
      p('Read each dimension separately and compare distributions as well as means. The paper also examines spatial patterns and associations with external data. Q-score computation is one step in that workflow; maps and external-data models need the matching locations and a separate analysis plan.', '分别解释每个维度，同时观察均值与分布。原文还研究空间格局及与外部数据的关系。计算 Q-score 只是其中一步；空间分析和外部数据建模还需要匹配的位置数据与独立的分析方案。'),
      p('Export trial-level data and image scores with their media IDs. TrueSkill is an alternative available in the platform, but switching to it changes the scoring method and should be reported.', '导出带媒体 ID 的逐轮记录与图片分数。平台也提供 TrueSkill，但改用它意味着改变计分方法，需要在研究报告中说明。'),
    ],
    differences: [
      p('The template fixes the number of trials per question and omits the original age/gender prompt after five clicks. It does not recreate unlimited voting.', '模板固定每题轮次，没有复刻五次点击后询问年龄／性别的流程，也没有复刻无限继续投票。'),
      p('The scoring panel starts with a minimum of four comparisons per image. Set and justify a threshold for your sample and check ranking stability; an enabled score is not evidence of adequate coverage.', '计分面板默认最低比较次数为 4。应根据样本设置并说明阈值、检查排序稳定性；能算出分数不代表覆盖量已经充足。'),
      p('The screenshot and interactive example use frames from the platform’s existing homepage video. They are demonstration stimuli, not photographs or responses from Place Pulse.', '截图与交互示例使用平台现有首页视频中的画面，属于演示素材，不是 Place Pulse 的原始照片或研究回答。'),
    ],
    flow: [p('Street-image pair', '两张街景'), p('Choice / Equal', '选择／相等'), p('Q-score per image', '每图 Q-score'), p('City distributions', '城市感知分布')],
  },
  '2009-ewing-measuring': {
    topic: p('Urban Design Qualities', '城市设计品质'), method: p('Video + Rating Matrix', '视频与评分矩阵'),
    medium: p('Video', '视频'),
    participants: { value: '10', label: p('experts', '名专家') },
    mediaCount: { value: '48', label: p('clips', '段视频') },
    question: 'design_qualities',
    subtitle: p('Turn abstract urban design qualities into explicit judgements about the same street videos.', '把抽象的城市设计品质转化为对同一组街道视频的明确评价。'),
    citation: 'Ewing & Handy (2009). Measuring the Unmeasurable: Urban Design Qualities Related to Walkability. Journal of Urban Design, 14(1), 65–84.',
    doi: 'https://doi.org/10.1080/13574800802451155',
    source: p('Methods: expert panel, video clips and physical features; Table 2; the five consensus definitions.', '原文 Methods 中的专家组、视频与物理特征测量；表 2；五项品质的共识定义。'),
    concepts: [
      p('The paper connects perceived street qualities with observable physical features. Ten urban design and planning experts rated 48 street clips. Eight qualities were investigated, but five met the study’s criteria for operational measurement.', '论文把感知到的街道品质与可观察的物理特征联系起来。10 名城市设计与规划专家评价了 48 段街道视频。研究考察八项品质，最终五项达到了建立操作化测量的标准。'),
      p('These are defined judgements about a street environment. They are not interchangeable with a general “beautiful street” score or a direct measure of walking behaviour.', '这些品质是对街道环境的、有明确含义的判断，不能统一替换成“街道好不好看”，也不是对实际步行行为的直接测量。'),
    ],
    dimensions: [
      [p('Imageability', '意象性'), p('Distinctiveness and the capacity to be recognized and remembered.', '让一个地方易于辨认、形成鲜明印象并被记住的品质。')],
      [p('Enclosure', '围合感'), p('How vertical elements define a room-like outdoor space.', '建筑、树木等垂直元素如何界定具有空间边界的室外环境。')],
      [p('Human scale', '人的尺度'), p('Physical size, detail and texture in relation to people and walking speed.', '物体尺度、细节和纹理与人的体量及步行速度的关系。')],
      [p('Transparency', '通透性'), p('How much activity or space can be perceived beyond the street edge.', '能在多大程度上感知街道边界另一侧的空间和活动。')],
      [p('Complexity', '复杂性'), p('Visual richness arising from the variety of elements in a scene.', '场景中不同元素及其多样性形成的视觉丰富程度。')],
    ],
    design: [
      p('Experts used a 1–5 scale from low to high for each quality. The clips were selected to span different combinations of qualities, rather than constitute a random citywide sample.', '专家对每项品质使用由低到高的 1–5 分量表。视频选择旨在覆盖不同品质的组合，并不等于城市范围内的随机抽样。'),
      p('Researchers also coded physical features of the same scenes, interviewed experts about their judgements, and developed statistical models. Collecting expert ratings alone does not reproduce those feature measurements or models.', '研究者还对同一批场景编码物理特征，访谈专家的判断依据，并建立统计模型。只收集专家评分，还没有复现特征测量和建模部分。'),
    ],
    implementation: [
      p('Load the Urban Design Qualities template. Collect a stable rater ID and professional background, upload videos to the clips folder, and set the trial count to your actual clip count. All raters intended for the agreement analysis should evaluate a common set of clips.', '载入 Urban Design Qualities 模板。记录稳定的评分者编号与专业背景，把视频放入 clips 文件夹，将轮次设为实际视频数量。需要参与一致性分析的评分者应评价一组共同视频。'),
      p('The video matrix presents qualities as rows and 1–5 as columns. Keep the definitions available and check the “watch to end” setting in participant preview. Legibility, linkage and coherence appear as optional rows in the template; decide whether your instrument needs them and document definitions if retained.', '视频矩阵以品质为行、1–5 分为列。保留定义说明，在参与者预览中检查“看完视频才能作答”。模板还列出可选的易读性、联结性与协调性；应判断研究是否需要，并在保留时补充定义。'),
    ],
    scoring: [
      p('The basic record is rater × clip × quality → rating. Calculate the mean of each quality for each clip, retaining the number and spread of ratings. Do not average all qualities into a single index without a separate measurement rationale.', '基本记录为“评分者 × 视频 × 品质 → 分数”。按每段视频、每项品质计算均值，并保留评分人数与离散程度。没有额外的测量依据时，不要直接把所有品质平均成一个总指数。'),
      p('The platform also offers ICC(2,1) and ICC(2,k), computed on a complete stimulus-by-rater matrix. The ICC page explains the two coefficients, the complete-matrix rule and the intervals. Report which clips and raters remain after incomplete observations are excluded. This is a platform agreement option; the paper’s ICC discussion concerns reliability of coded physical features and is not proof that the same ICC was used for these matrix answers.', '平台还提供基于完整“刺激材料 × 评分者”矩阵的 ICC(2,1) 和 ICC(2,k)。ICC 页面说明这两个系数、完整矩阵规则和区间。应报告排除不完整记录后保留了哪些视频与评分者。这是平台的一致性分析选项；原文的 ICC 讨论涉及物理特征编码的可靠性，不能据此声称原研究对这份评分矩阵做了同一种 ICC。'),
    ],
    interpretation: [
      p('A clip can be high in enclosure and low in transparency. Read the dimension profile before ranking scenes. Agreement describes consistency among raters, not whether a design quality has been validly defined.', '一段视频可以围合感高、通透性低。应先阅读各维度的组合，再考虑场景排序。评分一致性描述评分者是否接近，不能替代对概念定义是否有效的判断。'),
      p('To study links with physical design, export the clip-level ratings, join measured features by media ID, and specify a suitable model for repeated ratings. The original feature coding and multilevel modelling remain additional research steps.', '若要研究与物理设计的关系，应导出视频层级评分，按媒体 ID 连接实测特征，并为重复评分选择合适的模型。原文的特征编码和多层建模仍是另外的研究步骤。'),
    ],
    differences: [
      p('Individual online viewing replaces the source study’s expert panel setting and discussion. The template’s playback gate is an implementation choice, not a claim about the original software.', '在线独立观看替代原研究的专家组情境与讨论；模板的播放完成限制是平台实现选择，不代表原研究的软件机制。'),
      p('The template includes eight rows, while the paper’s successful operational measures concern five qualities. The extra rows should not inherit the same validation claim.', '模板包含八行，但论文最终成功操作化的是五项品质；额外三行不能直接沿用相同的验证结论。'),
      p('The screenshots show two different scenes from the platform homepage video, and the interactive preview plays one demonstration trial. They are not original research clips. Replace them with your study materials and restore the intended trial count before release.', '截图展示平台首页视频里的两段不同街景，交互预览只播放一轮演示，都不是原研究视频。正式发布前需换成研究材料，并设置计划轮次。'),
    ],
    flow: [p('Street video', '街道视频'), p('Five defined qualities', '五项明确品质'), p('Ratings by clip', '每段视频评分'), p('Features & models', '特征与建模')],
  },
  '1990-nasar-evaluative': {
    topic: p('Urban Imageability', '城市可意象性'), method: p('Map Annotation', '地图标注'),
    medium: p('Map', '地图'),
    participants: { label: p('Residents and visitors', '居民与访客') },
    question: 'liked_areas',
    subtitle: p('Locate liked and disliked places, then ask what makes people evaluate them that way.', '让人们指出喜欢与不喜欢的地方，再理解评价背后的环境特征。'),
    citation: 'Nasar (1990). The Evaluative Image of the City. Journal of the American Planning Association, 56(1), 41–53.',
    doi: 'https://doi.org/10.1080/01944369008975742',
    source: p('Appendix A: Participants and Procedure; city maps and the Discussion.', '原文附录 A 的 Participants 与 Procedure；城市评价地图与 Discussion。'),
    concepts: [
      p('An evaluative image records how people feel about recognizable parts of a city, as well as where those places are. The study elicits visually pleasant and unpleasant areas and the physical features people cite in support of those judgements.', '评价性城市意象同时关心“地方在哪里”和“人们如何评价它”。研究请参与者指出视觉上愉悦或不愉悦的区域，并说明支持这种判断的物理特征。'),
      p('Naturalness, upkeep, openness, order and historical significance emerge as recurring bases of evaluation. They are interpretive categories in the study; the template does not ask participants to rate five independent numerical scales.', '自然性、维护状况、开敞度、秩序和历史意义是研究归纳出的常见评价依据。它们是解释评价的类别；当前模板并没有把它们设计成五道独立数值量表。'),
    ],
    dimensions: [
      [p('Liked places', '喜欢的地方'), p('Where is the area, and why is it visually pleasant?', '区域在哪里？为什么看起来令人愉悦？')],
      [p('Disliked places', '不喜欢的地方'), p('Where is the area, and why is it visually unpleasant?', '区域在哪里？为什么看起来令人不愉悦？')],
      [p('Connection', '与城市的关系'), p('Resident, visitor, or works or studies here. Years lived appear only for residents. Visit count and length of stay appear only for visitors. Familiarity is asked of everyone and is a platform extension.', '居民、访客，或在此工作／学习。只有居民填写居住年数；只有访客填写来访次数和停留天数。熟悉程度每个人都回答，这是平台扩展。')],
      [p('What should change', '最需要改变什么'), p('Knoxville uses the Appendix A list. Chattanooga uses the paper’s open question. Each appears only for its city.', 'Knoxville 用附录 A 的选项。Chattanooga 用论文里的开放题。只在选中对应城市时出现。')],
    ],
    design: [
      p('The study interviewed residents by telephone and visitors in person in Knoxville and Chattanooga. Respondents named up to five pleasant and five unpleasant areas. Interviewers probed boundaries using streets, landmarks and buildings, and recorded reasons.', '原研究在 Knoxville 与 Chattanooga 对居民进行电话访谈、对访客进行面对面访谈。受访者最多指出五个愉悦区域和五个不愉悦区域；访谈者用街道、地标和建筑追问边界，并记录理由。'),
      p('About half were asked about likes first, and the rest about dislikes first. Researchers translated verbal boundaries into maps and overlaid individual evaluations. The online drawing task is an adaptation of that process.', '大约一半受访者先回答喜欢的地方，另一半先回答不喜欢的地方。研究者把口头边界转换成地图并叠加个体评价；在线绘图是对该流程的改编。'),
    ],
    implementation: [
      p('The city question selects the study area. Both map questions carry the same areas, and each area’s city id matches one city choice: knoxville or chattanooga. The preset rectangles are starting extents, not administrative boundaries. Freeze them with the published survey. Participants cannot pick an arbitrary city, and the survey does not read GPS or ask for a home address.', '城市题决定研究范围。两道地图题使用同一组范围，每个范围的城市 id 对应一个城市选项：knoxville 或 chattanooga。预设矩形是起始范围，不是行政边界。发布时把范围冻结在该版本里。参与者不能自选任意城市，问卷也不读取定位或询问家庭住址。'),
      p('Move map / Select pans the map and selects a finished area. Polygon, rectangle and point do not pan. Corners are numbered, and confirm or discard sits beside the latest point. A saved shape is labeled Area 1, Area 2, and so on. Each area asks for a place name and why it was marked. The drawing is the boundary; there is no separate boundary field. Up to five areas. “No area to mark”, “not familiar” and “skip” are different statuses. Points stay off the area grid.', 'Move map / Select 用来拖动地图和选中已画好的区域。多边形、矩形和点不会拖动地图。角点有编号，确认和取消出现在当前点的左上方。保存后的形状标成 Area 1、Area 2。每个区域填写地名和为什么这样标。画出的形状就是边界，没有单独的边界栏。最多五个区域。“没有区域”“不熟悉”和“跳过”是不同状态。点不进入区域网格。'),
      p('Later questions appear only for the matching answer: years lived for residents, visit count and stay for visitors, the Knoxville list or the Chattanooga open question for that city. The progress bar counts only questions that are currently shown. Like and dislike order is balanced per person and stored for the session. Gender options beyond male and female, prefer-not answers, the age band that includes 20, and the non-overlapping income bands are labeled adaptations, not Table 2 wording.', '后续题目只在对应答案下出现：居民填居住年数，访客填来访次数和停留天数，Knoxville 或 Chattanooga 各显示自己的改进题。进度条只计算当前会显示的题。喜欢与不喜欢的先后对每个人固定，并保存在该次作答中。男性／女性之外的性别选项、拒答、把 20 岁纳入 Under 21 的年龄段，以及互不重叠的收入段，都标明为改编，不是 Table 2 的原文表述。'),
    ],
    scoring: [
      p('The geographic grid uses a fixed meter size inside the frozen study extent. The primary denominator is the number of people who completed both map questions. An explicit “no area” counts as completion. Unanswered, unfamiliar and skipped responses are reported separately. One person’s overlapping areas count once per layer per cell. The paper stacked personal maps and tabulated overlap; this grid is the platform’s reproducible count. The results map paints the cells. It does not list every cell’s coordinates.', '地理网格使用研究范围内固定的米制尺寸。主分析的分母是两道地图题都完成的人数。明确选择“没有区域”算完成；未回答、不熟悉和跳过单独统计。同一个人的重叠区域在同一层同一格只计一次。原论文是把个人评价地图逐层叠加并统计重合频率；这个网格是平台提出的可复现计数。结果页把格子画在地图上，不会逐格列出坐标。'),
      p('Switch among the liked layer, the disliked layer and the net layer. Red means the disliked share is higher; green means the liked share is higher. A net of zero can mean nobody mentioned the cell, or that both shares are high. Compare groups splits that same map by one single-choice question, starting from connection to the city. A second map appears only when two answers of that question are in the current set. Do not mix cities, study-area revisions, or older image-annotation coordinates.', '可在喜欢层、不喜欢层和净评价层之间切换。偏红表示不喜欢的比例更高，偏绿表示喜欢的比例更高。净值为零可能是无人提及，也可能是两层都高。Compare groups 用一道单选题拆开同一张图，默认是与城市的关系。只有当前结果里这道题出现了两个答案时，才会再显示一张图。不要混合不同城市、不同范围版本，或旧的图片标注坐标。'),
      p('Participant attributes are the single-choice, dropdown, checkbox and number questions, numbered the same way as the question list. Every selected condition must match. Counts for the improvement question and for city, connection or familiarity stay on those questions. The map question does not repeat them, and it does not add a second paper-methods panel.', '参与者属性筛选包括单选、下拉、多选和数字题，题号与题目列表一致。多个条件要同时满足。改进题以及城市、关系和熟悉程度的人数统计留在那些题目自己的结果里。地图题不再重复它们，也不再附加一份论文方法面板。'),
    ],
    interpretation: [
      p('The map describes the evaluations of the sampled participants on the supplied base map. It does not establish a universal city ranking. Compare resident and visitor patterns with attention to familiarity, recruitment and areas that participants did not mention. A filter that leaves one person does not need a second copy of the same grid.', '地图表达的是这批参与者在指定底图上的评价，不是普遍适用的城市排名。比较居民与访客时，应考虑熟悉程度、招募方式和没有被提及的区域。筛选后只剩一个人时，不需要把同一张格子图再列一遍。'),
      p('Export the participant table, the annotation table, GeoJSON and the grid summary together with the study-area revision, cell size, denominator rule and participant filter. New responses record the study area with the question contract. Image-annotation answers from older projects stay on the image analysis and are not converted to longitude and latitude.', '导出参与者表、标注表、GeoJSON 和网格汇总时，一并记录研究范围版本、网格尺寸、分母规则和人群筛选。新的答卷会把研究范围记在题目契约里。旧项目里的图片标注仍走图片分析，不会被换成经纬度。'),
    ],
    differences: [
      p('Drawing replaces interviewer-assisted verbal descriptions. Participants name the place and give a reason; they do not type a boundary. The shape is the boundary. This changes the cognitive task and needs a map-reading pilot. The original composite overlaid personal maps rather than using a meter grid.', '绘图替代访谈者辅助的口头描述。参与者填写地名和理由，不另写边界；画出的形状就是边界。这改变了作答任务，需要先做地图理解的试答。原文的综合图来自个人地图叠加，不是米制网格。'),
      p('Only the two map tasks are order-balanced, and each person’s order is stored for the session. Zero areas require an explicit “no area” status, which is counted differently from an unanswered question. Questions that depend on city or resident/visitor stay hidden until that answer is chosen, and hidden questions are left out of the progress bar.', '只有两道地图任务做顺序平衡，而且每个人的顺序在会话中保持不变。零个区域必须明确选择“没有区域”，其统计不同于未回答。依赖城市或居民／访客的题目在选出答案前保持隐藏，进度条也不计入这些未显示的题。'),
      p('The card thumbnail is a schematic. The preset rectangles are starting extents for Knoxville and Chattanooga, not official administrative boundaries or a research result.', '模板卡片是示意图。预设矩形只是 Knoxville 与 Chattanooga 的起始范围，不是官方行政边界，也不是研究结果。'),
    ],
    flow: [p('Choose a configured city', '选择已配置的城市'), p('Connection, then its follow-up', '关系以及对应的后续题'), p('Liked and disliked maps', '喜欢与不喜欢的地图'), p('Improvement for that city', '该城市的改进题')],
  },
  '2025-yang-thermal': {
    topic: p('Thermal Perception', '热环境感知'), method: p('Pairwise Comparison', '成对比较'),
    medium: p('Image · SVI', '图片 · 街景'),
    participants: { value: '176', label: p('participants', '名参与者') },
    mediaCount: { value: '500', label: p('street views', '张街景') },
    question: 'thermal_comfort',
    subtitle: p('Trace the path from visual cues to thermal affordance judgements, scores and subsequent models.', '沿着视觉线索、热可供性判断、感知分数与后续模型，理解完整研究路径。'),
    citation: 'Yang, Chong, Liu & Biljecki (2025). Thermal comfort in sight: Thermal affordance and its visual assessment for sustainable streetscape design. Building and Environment, 271, 112569.',
    doi: 'https://doi.org/10.1016/j.buildenv.2025.112569',
    source: p('Sections 2 and 3.2; Table 1; Figure 4; Appendices A–B.', '原文第 2 节、第 3.2 节；表 1；图 4；附录 A–B。'),
    concepts: [
      p('Thermal affordance describes the integrated capacity of an environment to influence outdoor thermal comfort. VATA is its visual assessment: participants infer how thermally comfortable a street environment might be from its appearance.', '热可供性描述环境影响室外热舒适的综合能力。VATA 是对它的视觉评估：参与者根据街道外观，推断其中的热舒适潜力。'),
      p('Keep the target concept, the visual judgement and physical measurements distinct. A photograph-based preference does not directly measure air temperature, humidity, or a person’s experienced thermal sensation at the site.', '应区分目标概念、视觉判断与物理测量。根据照片做出的选择，不直接测量现场气温、湿度或一个人在现场实际经历的热感觉。'),
    ],
    dimensions: [
      [p('VATA', 'VATA'), p('The target judgement of outdoor thermal comfort potential.', '对室外热舒适潜力的目标判断。')],
      [p('Microclimate inference', '微气候推断'), p('Perceived temperature, sunlight, humidity and wind.', '对温度、日照、湿度与风的视觉推断。')],
      [p('Environment & design', '环境与设计'), p('Greenery, shade, material comfort and urban design qualities.', '绿化、遮阴、材料舒适感及城市设计品质。')],
      [p('Evoked emotion', '诱发情绪'), p('Including safety, beauty, liveliness, wealth, boredom and depression.', '包括安全、美感、活力、富裕感、无聊与压抑感。')],
    ],
    design: [
      p('The study collected pairwise judgements from 176 long-term Singapore residents using 500 street-view images. It assessed VATA and 19 visual-perceptual indicators, with 18 comparisons per indicator per participant.', '原研究让 176 名长期居住在新加坡的参与者评价 500 张街景，测量 VATA 和 19 项视觉感知指标，每位参与者对每项指标完成 18 次比较。'),
      p('The indicators cover microclimate inference, built-environment evaluation, streetscape design quality and evoked emotion. Every comparison addresses one indicator; participants do not assign 0–5 ratings directly.', '指标覆盖微气候推断、建成环境评价、街景设计品质与诱发情绪。每次比较只针对一个指标，参与者并不是直接填写 0–5 分。'),
    ],
    implementation: [
      p('Use the Thermal Comfort in Sight template and import its linked dataset or your own matched study media. Keep the same media identifiers across indicators so the resulting scores can later be joined by image.', '使用 Thermal Comfort in Sight 模板，导入其关联数据集或自己准备的研究材料。不同指标使用一致的媒体 ID，确保后续能按图片连接各项分数。'),
      p('Review the VATA question and all 19 indicator questions, their wording direction and trial counts. The full template represents 20 × 18 = 360 comparisons per participant; pilot the burden and document any reduction, splitting or change of population. Two optional extensions sit beside the questions they relate to: overall comfort follows the VATA comparison, and artificial heat sources follows the temperature comparison. They are not part of the original 20 indicators.', '检查 VATA 与全部 19 道指标题的措辞方向和轮次。完整模板为每人 20 × 18 = 360 次比较；应试测作答负担，并记录任何缩减、拆分或受试人群变化。另有两道可选扩展题紧挨相关问题：整体舒适感接在 VATA 比较之后，人工热源接在温度比较之后。它们不属于原文的 20 项指标。'),
    ],
    scoring: [
      p('Score each indicator separately using TrueSkill. The template recommends 20 runs and a 0–5 scale. The platform averages seeded orderings of the outcomes and performs within-indicator min–max scaling; changing the set of images can change the scaled values.', '每项指标分别使用 TrueSkill 计分。模板推荐运行 20 次，缩放至 0–5。平台对有固定随机种子的比较顺序重复计分并平均，再在指标内部做最小—最大缩放；改变图片集合可能改变缩放后的值。'),
      p('The source describes additional distribution normalization, including a target standard deviation of 1. A shared 0–5 label does not establish numerical equivalence. Reproducing published scores requires checking the authors’ normalization, parameter choices, vote order and original data.', '原文还描述了分布归一化，包括标准差设为 1。都标为 0–5，并不能证明数值等价。若要复现发表分数，需要继续核对作者的归一化、参数、投票顺序与原始数据。'),
    ],
    interpretation: [
      p('Read the VATA score as a relative visual assessment within the collected comparisons. Report the number of observations and uncertainty as well as rank. The score is not degrees Celsius or a calibrated on-site comfort index.', '把 VATA 分数理解为这批比较中的相对视觉评价。除排序外，还应报告观测数量和不确定性。这个分数不是摄氏温度，也不是已校准的现场舒适指数。'),
      p('The paper goes on to train a multi-task neural network and use elastic-net regression to connect image features, perceptual indicators and VATA. Those trained models are not produced by opening the platform’s TrueSkill results. Export image-level indicators and follow a separate training and validation workflow.', '原文进一步使用多任务神经网络与弹性网回归，联系图像特征、感知指标与 VATA。打开平台的 TrueSkill 结果并不会自动得到这些训练好的模型。应导出图片层级指标，再独立完成训练与验证。'),
    ],
    differences: [
      p('The template recreates the comparison instrument and provides a scoring route. It does not bundle the original sample, physical validation data or trained prediction models.', '模板重建比较问卷并提供计分路径，不包含原始参与者样本、实测验证数据或训练好的预测模型。'),
      p('Platform 0–5 min–max scaling and the paper’s distribution normalization must be reported separately when numerical reproduction matters.', '若研究要求数值复现，需要分别交代平台的 0–5 最小—最大缩放与原文的分布归一化。'),
      p('The screenshot and the interactive example each show one trial of street views stored with this template. They do not change the saved template.', '截图和交互示例都是该模板已存放街景中的一轮比较，不修改保存的模板。'),
    ],
    flow: [p('Visual street cues', '街景视觉线索'), p('VATA + 19 indicators', 'VATA 与 19 项指标'), p('TrueSkill per indicator', '各指标 TrueSkill'), p('External modelling', '后续独立建模')],
  },
  '2014-quercia-aesthetic': {
    topic: p('Beauty, Quiet & Happiness', '美感、安静与愉悦'), method: p('Pairwise Comparison', '成对比较'),
    medium: p('Image', '图片'),
    participants: { value: '3,301', label: p('participants', '名参与者') },
    mediaCount: { value: '568', label: p('scenes', '处场景') },
    question: 'beautiful',
    subtitle: p('Ask which London scene looks more beautiful, quiet, or happy, then read each scene by the share of votes it received.', '比较伦敦场景哪一处更美、更安静或更令人愉悦，再用得票比例阅读每处场景。'),
    citation: 'Quercia, O’Hare & Cramer (2014). Aesthetic Capital: What Makes London Look Beautiful, Quiet, and Happy? Proceedings of CSCW ’14, 945–955.',
    doi: 'https://doi.org/10.1145/2531602.2531613',
    source: p('The game description; “Selecting Scenes”; Figure 1; the ranking by fraction of votes.', '游戏流程说明；Selecting Scenes；图 1；按得票比例排序的段落。'),
    concepts: [
      p('The study asks which of two London scenes looks more beautiful, more quiet, or happier. Beauty, quiet and happiness are three judgements. A scene can rank differently on each, so the votes are not one overall “pleasantness” score.', '研究每次问两处伦敦场景哪一处更美、更安静，或更令人愉悦。美感、安静和愉悦是三项判断。同一处场景在三项上的排序可以不同，因此这些投票不是一个总的“宜人程度”。'),
      p('The analysed pictures are 258 Google Street Views and 310 Geograph photographs, 568 scenes whose ratings were not sparse. They were drawn near subway stations and within census areas. A vote about a photograph is not a measurement of sound level or of how it feels to stand there.', '进入分析的是得票并不稀疏的 258 张谷歌街景和 310 张 Geograph 照片，共 568 处场景，抽取范围在地铁站附近和人口普查区之内。对照片的投票不是现场声级，也不是站在那里的实际感受。'),
    ],
    dimensions: [
      [p('Beauty', '美感'), p('Which place is more beautiful?', '哪一处更美？')],
      [p('Quiet', '安静'), p('Which place is more quiet?', '哪一处更安静？')],
      [p('Happiness', '愉悦'), p('Which place is more happy?', '哪一处更令人愉悦？')],
    ],
    design: [
      p('UrbanGems showed two random scenes and asked for one of the three judgements. Ten pairs completed a round. After that round the site asked a short questionnaire, and participants could play further rounds. Cookies identified people across rounds. In four months the site recorded 3,301 participants: 36% connecting from London, 35% from the rest of the UK, and 29% from outside the UK. Of those, 515 provided personal details.', 'UrbanGems 每次展示两处随机场景，并询问三项判断之一。十对为一轮。一轮结束后网站询问一份简短问卷，参与者还可以继续玩。跨轮次的人用浏览器 cookie 识别。四个月内记录了 3,301 名参与者：36% 从伦敦连接，35% 来自英国其他地区，29% 来自英国以外。其中 515 人提供了个人信息。'),
      p('Beauty was the default question, so it received far more votes. In the analysed set the median number of answers per scene was 171 for beauty, 12 for quiet and 16 for happiness. The paper ranks scenes by the fraction of votes they received. There were 17,261 annotation rounds, and each round annotated at most ten pairs.', '美感是默认问题，因此得票远多于另外两项。在分析集里，每处场景的答案中位数是：美感 171，安静 12，愉悦 16。论文按得票比例给场景排序。标注共 17,261 轮，每轮最多标注十对。'),
    ],
    implementation: [
      p('Create a project from the UrbanGems template and replace the bundled pictures with your own scenes. Keep a stable media ID, and keep the same IDs across the three questions if you want to compare beauty, quiet and happiness for one scene.', '从 UrbanGems 模板创建项目，用自己的场景替换随模板附带的图片。为每张图保留稳定的媒体 ID；若要比较同一处场景的三项判断，三道题应使用同一套 ID。'),
      p('The template asks one pass: 4 beauty pairs, 3 quiet pairs and 3 happy pairs. The three questions are separate. The final page asks age group, gender and whether the person lives in London; those option wordings are marked as not printed in the paper. Set the trial counts to the coverage your study needs, and do not treat 4 + 3 + 3 as the original voting volume.', '模板只问一轮：美感 4 对、安静 3 对、愉悦 3 对。三道题分开。最后一页询问年龄段、性别和是否住在伦敦，选项措辞标明论文没有印出原文。把轮次设成你的研究需要的覆盖量，不要把 4 + 3 + 3 当成原网站的投票量。'),
    ],
    scoring: [
      p('The paper’s scene score is the fraction of votes that scene received. In Results, the template’s primary method is choice share: times chosen divided by times shown, with a Wilson 95% interval. Score beauty, quiet and happiness separately. A high share on beauty does not transfer to quiet.', '论文的场景分数是该场景获得的投票比例。在结果里，模板的主要方法是选择比例：被选中次数除以被展示次数，并给出 Wilson 95% 区间。美感、安静和愉悦分开计分。美感上的高比例不会自动变成安静上的高比例。'),
      p('The template also offers TrueSkill on the same three questions, scaled to 0–10, with ties excluded. That is a different score. If you report it, say that you changed the method. The original write-up ranks scenes by vote fraction.', '模板也提供这三道题的 TrueSkill，缩放到 0–10，并排除平局。那是另一种分数。如果报告它，需要说明计分方法已经改变。原文按得票比例排序。'),
    ],
    interpretation: [
      p('Read the three rankings separately, and read the number of times each scene was shown next to its share. The original medians already show that quiet and happiness were much thinner than beauty. A share from a handful of views is not as stable as a share from the beauty question’s typical coverage.', '三项排序分开阅读，并把每处场景的展示次数和选择比例放在一起看。原文的中位数已经说明，安静和愉悦的得票比美感稀少得多。只有几次展示得到的比例，不能和美感问题通常的覆盖量同等看待。'),
      p('The paper then looks for colour, texture and visual words that travel with those rankings. Exporting choice shares does not run that image analysis. Join the scene scores to your own visual measures if that is the next question.', '论文接着寻找与这些排序相伴的颜色、纹理和视觉词。导出选择比例并不会自动做那一步图像分析。如果下一步要问视觉特征，需要把场景分数连接到你自己的视觉测量。'),
    ],
    differences: [
      p('One fixed pass replaces a 10-pair round that could be replayed. The original beauty question attracted most of the votes because it was the default; this template asks the three questions in one sitting, with only four, three and three pairs.', '固定的一轮替代了可以反复玩的十对一轮。原文的美感题因为是默认问题而获得大部分投票；这个模板在同一次作答里问完三项，而且只有 4、3、3 对。'),
      p('The age, gender and London questions use wording that the paper does not print. The paper does say a short questionnaire followed the first round, and that 515 people gave personal details.', '年龄、性别和是否住在伦敦这三题使用的措辞，论文没有印出。论文确实写了第一轮之后有一份简短问卷，并且有 515 人提供了个人信息。'),
      p('The bundled pictures are 19 scenes cropped from the paper PDF. They are not the 568-scene study set. The screenshot and the interactive example use those bundled pictures for one trial and do not change the template.', '随模板附带的是从论文 PDF 裁出的 19 处场景，不是研究用的 568 处场景。截图和交互示例用这些附带图片演示一轮，不修改模板。'),
    ],
    flow: [p('Two London scenes', '两处伦敦场景'), p('Beauty, quiet or happy', '美感、安静或愉悦'), p('Vote fraction per scene', '每处场景的得票比例'), p('Separate rankings', '三项分开的排序')],
  },
  '2014-naik-streetscore': {
    topic: p('Perceived Safety', '安全感'), method: p('Pairwise Comparison', '成对比较'),
    medium: p('Image · SVI', '图片 · 街景'),
    participants: { value: '7,872', label: p('participants', '名参与者') },
    mediaCount: { value: '4,109', label: p('training images', '张训练图片') },
    question: 'safety_pairwise',
    subtitle: p('Streetscore learns perceived safety from Place Pulse choices, then predicts it for streetscapes nobody compared.', 'Streetscore 从 Place Pulse 的选择中学习安全感，再为没有被拿来比较的街景做预测。'),
    citation: 'Naik, Philipoom, Raskar & Hidalgo (2014). Streetscore – Predicting the Perceived Safety of One Million Streetscapes. CVPR Workshops 2014, 793–799.',
    doi: 'https://doi.org/10.1109/CVPRW.2014.121',
    source: p('Abstract; “Image Ranking using Trueskill”; the paragraph stating 7,872 participants, 4,109 images and 208,738 comparisons; the 21-city map.', '摘要；Image Ranking using Trueskill；写明 7,872 名参与者、4,109 张图片和 208,738 次比较的段落；21 个城市的地图。'),
    concepts: [
      p('Streetscore is a predictor of perceived safety. Its training labels come from Place Pulse: people saw two streetscapes and answered which place looks safer. The human study and the later map of predicted scores are different products.', 'Streetscore 是一个安全感预测器。它的训练标签来自 Place Pulse：人们看到两处街景，回答哪一处看起来更安全。人类研究，和后来那张预测分数地图，是两件不同的产物。'),
      p('The paper states that 7,872 participants from 91 countries ranked 4,109 images with 208,738 pairwise comparisons. The “one million streetscapes” are about one million Google Street View images, in 21 cities in the Northeast and Midwest of the United States, scored by the trained predictor. Those images were not each compared by the 7,872 participants.', '论文写明，来自 91 个国家的 7,872 名参与者用 208,738 次成对比较，给 4,109 张图片排序。“一百万处街景”是美国东北部和中西部 21 个城市里大约一百万张谷歌街景，由训练好的预测器打分。这 7,872 名参与者并没有逐张比较那一百万张图。'),
    ],
    dimensions: [
      [p('Perceived safety', '安全感'), p('Which place looks safer?', '哪个地方看起来更安全？')],
    ],
    design: [
      p('The crowdsourced game showed two images and collected a click. The paper converts those preferences into a ranked score with TrueSkill, then trains image features to predict that score. Support vector regression on those features is the model; the pairwise question does not itself emit a safety map.', '众包游戏展示两张图并收集一次点击。论文用 TrueSkill 把这些偏好变成排序分数，再用图像特征预测该分数。对这些特征做支持向量回归，才是模型；成对比较题本身不会直接画出一张安全地图。'),
      p('The abstract’s “more than 7,000 participants” and the later count of 7,872 refer to the same Place Pulse training set. This paper’s image count is 4,109. It is the count Streetscore reports for its training images.', '摘要里的“7,000 多名参与者”和后文的 7,872，指的是同一批 Place Pulse 训练数据。本文报告的图片数是 4,109，也就是 Streetscore 写明的训练图片数。'),
    ],
    implementation: [
      p('The Streetscore template’s main question is the pairwise safety comparison. It does not set a trial count. Before release, set how many pairs each participant sees and check how many comparisons each image accumulates. The template’s analysis note uses 29 comparisons per image as its minimum; that threshold is a template setting, and a score can still be unstable below the coverage you justify.', 'Streetscore 模板的主问题是成对的安全比较。它没有设置轮次。发布前要确定每人看多少对，并检查每张图累计了多少次比较。模板的分析说明把每张图 29 次比较当作下限；这是模板设置，在你能说明的覆盖量之下，分数仍然可能不稳定。'),
      p('Three later pages ask for a 1–10 rating of a single image and a reason. Their page title says they are an optional extension and are not part of the original study. Leave them out if the instrument should stay with the pairwise training task. Twelve bundled scenes come from the paper PDF, not from the 4,109 training images.', '后面三页对单张图做 1–10 评分，并询问理由。页标题写明这是可选扩展，不属于原研究。如果问卷只保留成对比较这一训练任务，就不要使用这三页。随模板附带的 12 处场景来自论文 PDF，不是那 4,109 张训练图片。'),
    ],
    scoring: [
      p('Score the pairwise question with TrueSkill. The template scales the rating to 0–10 in one run and excludes ties. Report the scale, the run count and the comparison count with the score. The paper uses TrueSkill as the training label; matching a published Streetscore value also requires the authors’ features, regression and image set.', '成对比较题用 TrueSkill 计分。模板做一次运行，把评分缩放到 0–10，并排除平局。报告分数时同时报告缩放范围、运行次数和比较次数。论文把 TrueSkill 用作训练标签；要对上已发表的 Streetscore 数值，还需要作者的特征、回归和图片集。'),
      p('The optional 1–10 pages have a separate recommendation: the distribution of those ratings, with the template’s minimum of 12 ratings per image. Do not average a 1–10 tick and a TrueSkill score into one safety index.', '可选的 1–10 页有另一条建议：看这些评分的分布，模板的下限是每张图 12 次评分。不要把一次 1–10 的勾选和一个 TrueSkill 分数平均成同一个安全指数。'),
    ],
    interpretation: [
      p('A TrueSkill score from your participants ranks the images they actually compared. It is not the Streetscore of a city, and it is not a crime rate. The paper’s city maps are the predictor applied to about one million street views at 200 images per square mile.', '你的参与者得到的 TrueSkill 分数，只排序他们真正比较过的图片。它不是一座城市的 Streetscore，也不是犯罪率。论文里的城市地图，是预测器应用到大约一百万张街景上的结果，分辨率是每平方英里 200 张。'),
      p('Training that predictor is a separate computer-vision workflow. Export the image scores and the trial file, then fit and validate any model outside the scoring panel.', '训练那个预测器是另一套计算机视觉流程。导出图片分数和逐轮记录后，在计分面板之外拟合和验证模型。'),
    ],
    differences: [
      p('Place Pulse, the source of the training clicks, allowed an equal judgement. This template’s pairwise question does not offer Equal. The optional 1–10 pages are likewise outside the original study.', '训练点击来自 Place Pulse，那个界面允许判断为相等。这个模板的成对比较题没有 Equal。可选的 1–10 页同样在原研究之外。'),
      p('The template does not fix the number of pairs, and it does not include the million predicted streetscapes or the trained model. The 0–10 scaling is the template’s analysis setting.', '模板没有固定比较对数，也不包含那一百万张被预测的街景或训练好的模型。缩放到 0–10 是模板的分析设置。'),
      p('The screenshot and the interactive example show one pair from the pictures bundled with this template. They are paper-PDF crops, not the training set, and the preview does not save an answer.', '截图和交互示例展示随该模板附带的图片中的一对。它们是论文 PDF 的裁图，不是训练集，预览也不会保存回答。'),
    ],
    flow: [p('Which place looks safer?', '哪个地方看起来更安全？'), p('TrueSkill training label', 'TrueSkill 训练标签'), p('Predictor of safety', '安全感预测器'), p('Maps of unscored streets', '未被人比较的街道地图')],
  },
  '2016-dubey-place': {
    topic: p('Six Perceptual Attributes', '六项感知属性'), method: p('Pairwise Comparison', '成对比较'),
    medium: p('Image · SVI', '图片 · 街景'),
    participants: { value: '81,630', label: p('volunteers', '名志愿者') },
    mediaCount: { value: '110,988', label: p('images', '张图片') },
    question: 'safe',
    subtitle: p('Place Pulse 2.0 collects pairwise judgements on six attributes, then learns to predict those judgements.', 'Place Pulse 2.0 收集六项属性上的成对判断，再学习预测这些判断。'),
    citation: 'Dubey, Naik, Parikh, Raskar & Hidalgo (2016). Deep Learning the City: Quantifying Urban Perception at a Global Scale. ECCV 2016, LNCS 9905, 196–212.',
    doi: 'https://doi.org/10.1007/978-3-319-46448-0_12',
    source: p('Abstract; the dataset paragraph; the TrueSkill paragraph; the sentence reporting that 13.2% of comparisons were equal.', '摘要；数据集段落；TrueSkill 段落；写明 13.2% 的比较为相等的句子。'),
    concepts: [
      p('The study measures six attributes of street appearance: safe, lively, boring, wealthy, depressing and beautiful. Each comparison is about one attribute. A street that looks safe is not thereby scored as beautiful.', '研究测量街道外观的六项属性：安全、有活力、无聊、富裕、压抑和美。每次比较只针对一项属性。一条看起来安全的街道，不会因此得到美的分数。'),
      p('The human dataset contains 110,988 images from 56 cities in 28 countries, photographed from 2007 to 2012, and 1,169,078 pairwise comparisons from 81,630 online volunteers. The abstract rounds the comparison count to 1,170,000. The neural network that predicts new comparisons is a later step, not the survey itself.', '人类数据集包含 28 个国家 56 座城市的 110,988 张图片，拍摄于 2007 至 2012 年，以及 81,630 名在线志愿者提供的 1,169,078 次成对比较。摘要把比较次数四舍五入为 1,170,000。预测新比较的神经网络是后面的步骤，不是问卷本身。'),
    ],
    dimensions: [
      [p('Safe', '安全'), p('Which place looks safer?', '哪个地方看起来更安全？')],
      [p('Lively', '有活力'), p('Which place looks livelier?', '哪个地方看起来更有活力？')],
      [p('Beautiful', '美'), p('Which place looks more beautiful?', '哪个地方看起来更美？')],
      [p('Wealthy', '富裕'), p('Which place looks wealthier?', '哪个地方看起来更富裕？')],
      [p('Depressing', '压抑'), p('Which place looks more depressing?', '哪个地方看起来更压抑？')],
      [p('Boring', '无聊'), p('Which place looks more boring?', '哪个地方看起来更无聊？')],
    ],
    design: [
      p('Volunteers compared two street images on one attribute. The paper converts comparisons to a ranked score with TrueSkill. It also reports that 13.2% of the pairwise comparisons judged the two images equal on the attribute being asked.', '志愿者针对一项属性比较两张街景。论文用 TrueSkill 把比较变成排序分数。论文还写明，13.2% 的成对比较把两张图在所问属性上判断为相等。'),
      p('Place Pulse 2.0 is a new collection. It is larger and more varied than Place Pulse 1.0, and it adds lively, boring, wealthy, depressing and beautiful to safety. Scores from the two studies are not one shared scale.', 'Place Pulse 2.0 是新收集的数据。它比 Place Pulse 1.0 更大、更多样，并在安全之外增加了有活力、无聊、富裕、压抑和美。两次研究的分数不是同一把尺子。'),
    ],
    implementation: [
      p('The template has one image-choice question per attribute. None of them sets a trial count, and none offers Equal. Before release, choose a trial count per attribute and plan how many comparisons each image needs. Sixty-two bundled scenes are crops from the paper PDF, not the 110,988-image dataset.', '模板为每项属性设一道双图选择题。它们都没有设置轮次，也都没有 Equal。发布前要为每项属性选定轮次，并规划每张图需要多少次比较。随模板附带的 62 处场景是论文 PDF 的裁图，不是那 110,988 张图片。'),
      p('A final page asks age group, gender and where the person grew up. The paper discusses whether age, gender and location drove the earlier Place Pulse judgements; it does not print this page as the Place Pulse 2.0 form. Keep or remove it explicitly, and do not describe it as a published instrument item unless you have checked the original task.', '最后一页询问年龄段、性别和成长地点。论文讨论过年龄、性别和地点是否驱动了更早的 Place Pulse 判断；它没有把这一页印成 Place Pulse 2.0 的问卷。保留或删除都要写明，在核对过原始任务之前，不要把它说成论文里的正式题目。'),
    ],
    scoring: [
      p('The paper’s image score is TrueSkill, computed per attribute. The template can score the six questions that way: one run, ties excluded, scaled to 0–10. Scaling changes the numbers, so a 0–10 value is not automatically the published TrueSkill.', '论文的图片分数是按属性计算的 TrueSkill。模板可以用这种方式给六道题计分：运行一次，排除平局，缩放到 0–10。缩放会改变数值，所以 0–10 的结果不会自动等于已发表的 TrueSkill。'),
      p('The template also lists Q-score for the same six questions, with a minimum of four comparisons per image. Q-score is a different method, the one used for Place Pulse 1.0. Report which method you used. Because this template has no Equal button, it will not record the equal judgements that were 13.2% of the original comparisons.', '模板也给这六道题列出了 Q-score，每张图至少四次比较。Q-score 是另一种方法，也就是 Place Pulse 1.0 使用的方法。报告时要写明用了哪一种。因为这个模板没有 Equal，它记录不到原文里占 13.2% 的相等判断。'),
    ],
    interpretation: [
      p('Compare cities or images on one attribute at a time, and keep the comparison count beside the score. Safe, lively, beautiful, wealthy, depressing and boring can move in different directions. A global model does not turn six attributes into one quality of life index.', '每次只在一项属性上比较城市或图片，并把比较次数和分数放在一起。安全、有活力、美、富裕、压抑和无聊可以朝不同方向变化。一个全球模型不会把六项属性变成一个生活质量指数。'),
      p('The paper trains a Siamese-like network on the pairwise judgements. Opening TrueSkill results does not train that network. Export the comparisons and fit any predictor separately.', '论文在成对判断上训练了一个类似孪生网络的模型。打开 TrueSkill 结果并不会训练那个网络。导出比较记录后，预测模型要单独拟合。'),
    ],
    differences: [
      p('The original task recorded equal judgements. This template asks for a choice and does not offer Equal. It also does not recreate 1,169,078 comparisons or set the original number of trials.', '原始任务记录了相等判断。这个模板要求做出选择，并且没有 Equal。它也没有复现 1,169,078 次比较，或设置原研究的轮次。'),
      p('Q-score is available beside TrueSkill. Using it changes the score relative to the paper’s ranking method.', 'Q-score 和 TrueSkill 并列提供。改用 Q-score，就改变了相对于论文排序方法的分数。'),
      p('The screenshot and the interactive example use one pair of bundled paper-PDF photographs for the safety question. They are not the 56-city dataset, and they do not save a response.', '截图和交互示例用随模板附带的论文 PDF 照片，演示安全题的一对比较。它们不是 56 座城市的数据集，也不会保存回答。'),
    ],
    flow: [p('Two street images', '两张街景'), p('One of six attributes', '六项属性之一'), p('TrueSkill per attribute', '每项属性的 TrueSkill'), p('A separate predictor', '单独训练的预测器')],
  },
  '2017-liu-machine': {
    topic: p('Facade & Street Wall', '立面与街墙'), method: p('Expert Rating', '专家评分'),
    medium: p('Image · SVI', '图片 · 街景'),
    participants: { value: '8', label: p('experts', '名专家') },
    mediaCount: { value: '2,000+', label: p('labelled images', '张标注图片') },
    question: 'facade_quality',
    subtitle: p('Trained raters score facade quality and street-wall continuity, and those labels teach a citywide model.', '经过训练的评分者为立面品质和街墙连续性打分，这些标签再去教一个覆盖全城的模型。'),
    citation: 'Liu, Silva, Wu & Wang (2017). A machine learning-based method for the large-scale evaluation of the qualities of the urban environment. Computers, Environment and Urban Systems, 65, 113–125.',
    doi: 'https://doi.org/10.1016/j.compenvurbsys.2017.06.003',
    source: p('Abstract; the expert-rating section; the sentence on more than 2,000 labelled images; the in-situ comparison.', '摘要；专家评分一节；写明标注图片超过 2,000 张的句子；与现场评价的比较。'),
    concepts: [
      p('The rated qualities are the construction and maintenance quality of the building facade, on a 1–4 scale, and whether the street wall is continuous. They are two judgements. A high facade score does not mean the street wall is continuous.', '被评分的品质有两项：建筑立面的建造与维护质量，使用 1–4 分；以及街墙是否连续。这是两项判断。立面分数高，并不表示街墙连续。'),
      p('Eight graduate students with at least five years of architectural training made the labels, after a session that agreed the standard and a practice session on the same images. The paper says each expert had to rate several hundred images, and that the labelled set was more than 2,000 images. The later map uses the trained models on 360,796 Baidu street views of Beijing. Those 360,796 images are not the human-labelled set.', '八名接受过至少五年建筑训练的研究生完成标注。在此之前有一次统一标准的讨论，以及一次对同一批图片的练习。论文写明每位专家要评几百张图片，标注集超过 2,000 张。后来的地图把训练好的模型用到北京的 360,796 张百度街景上。这 360,796 张不是人工标注集。'),
    ],
    dimensions: [
      [p('Facade quality', '立面品质'), p('Construction and maintenance of the building facade, from 1 to 4.', '建筑立面的建造与维护质量，1 到 4 分。')],
      [p('Street-wall continuity', '街墙连续性'), p('Whether the street wall is continuous.', '街墙是否连续。')],
    ],
    design: [
      p('The students rated street-view images. In the paper, both judgements were made on the same image. Tables 1 and 2, with the training session, define the standards. The template does not reprint those tables, so a new study needs its own written rubric before raters begin.', '学生们评价街景图片。在论文里，两项判断做在同一张图片上。表 1、表 2 和培训讨论规定了标准。模板没有重印这两张表，因此新研究要在评分开始前写好自己的评分细则。'),
      p('The models are then compared with ratings collected on site from 752 passers-by at 56 locations in Beijing. Eight surveyors carried out that field survey. Those passers-by are a validation sample, not the eight graduate raters. The paper reports a Spearman correlation of 0.66 for facade quality and 0.71 for street-wall continuity, each with p < 0.0001.', '模型随后与北京 56 个地点、752 名路人的现场评分比较。八名调查员实施了那次现场调查。这些路人是验证样本，不是那八名研究生评分者。论文报告立面品质的 Spearman 相关为 0.66，街墙连续性为 0.71，两者的 p 都小于 0.0001。'),
    ],
    implementation: [
      p('Collect a rater ID and professional background, then present the facade question and the street-wall question. The template draws images for the two questions independently and sets 20 trials each. In the paper both judgements used the same image. If your study needs paired judgements, use one image for both questions and say that you changed the template’s independent draw.', '先记录评分者编号和专业背景，再出示立面题和街墙题。模板为两道题各自抽图，每题 20 轮。论文里两项判断用的是同一张图。如果研究需要成对判断，就让两道题使用同一张图，并说明你改掉了模板的分别抽图。'),
      p('The on-site page repeats the same two judgements for the street in front of the participant. It appears only when the link contains a site parameter. It is the template’s replacement for the paper’s field forms, not an automatic sample of 56 locations. Seven bundled scenes are PDF crops, not the labelled Beijing set.', '现场页让参与者对面前的街道做同样两项判断。只有链接里带有 site 参数时才出现。它是模板用来替代论文现场表格的一页，不会自动变成 56 个地点的样本。随模板附带的 7 处场景是 PDF 裁图，不是北京的标注集。'),
    ],
    scoring: [
      p('For facade quality, the template recommends the distribution of the 1–4 ratings: keep the mean, the spread and the number of ratings per image. Do not collapse the scale into a single city grade. Rater agreement can be computed from the rater ID on a complete image-by-rater matrix; report who remains after incomplete raters are excluded.', '对立面品质，模板建议看 1–4 分的分布：保留均值、离散程度和每张图的评分人数。不要把量表收成一个城市总分。评分者一致性可以用评分者编号，在完整的“图片 × 评分者”矩阵上计算；排除不完整评分者后，要报告还留下了谁。'),
      p('Street-wall continuity is a yes/no answer. Count the share of “continuous” judgements per image and keep it separate from the 1–4 mean. The on-site facade ratings can be aggregated by the site parameter. That aggregation does not by itself reproduce the paper’s correlation with the 752 passers-by.', '街墙连续性是是／否回答。按图片统计“连续”的比例，并与 1–4 分的均值分开。现场立面评分可以按 site 参数汇总。这一汇总本身不会复现论文与 752 名路人的相关。'),
    ],
    interpretation: [
      p('Expert labels describe the raters’ application of the agreed standard. Agreement says whether those raters used it consistently. The paper’s check against passers-by is a different comparison: machine scores against 752 on-site ratings, with the correlations above. A high expert mean is not that correlation.', '专家标签描述的是评分者对约定标准的使用。一致性说的是这些评分者是否用得一致。论文对照路人的检验是另一次比较：机器分数对照 752 份现场评分，相关就是上面的数字。专家均值高，并不等于那个相关。'),
      p('The city maps come from models trained on the labels and applied to 360,796 street views. The paper reports a mean squared error of 0.61 on the 1–4 facade task and 75% accuracy on street-wall continuity for those models. The scoring panel does not train them. Export the image-level labels and run that training separately.', '城市地图来自在标签上训练、再应用到 360,796 张街景的模型。论文报告这些模型在 1–4 分立面任务上的均方误差为 0.61，在街墙连续性上的准确率为 75%。计分面板不会训练它们。导出图片层级的标签后，训练要单独进行。'),
    ],
    differences: [
      p('The template draws the facade image and the street-wall image independently. The paper rated both qualities on the same image. Twenty trials is a template length, not the several hundred images each expert rated.', '模板对立面图和街墙图分别抽图。论文对同一张图评价两项品质。20 轮是模板的长度，不是每位专家所评的几百张图片。'),
      p('The on-site page is hidden unless the link includes a site. The original field survey used eight surveyors and 752 passers-by at 56 locations. Opening the template does not collect that sample.', '除非链接带有 site，现场页保持隐藏。原现场调查由八名调查员在 56 个地点收集了 752 名路人的评分。打开模板并不会收集那份样本。'),
      p('The screenshot and the interactive example show one bundled paper-PDF photograph on the facade question. They are not a Beijing labelling trial, and they do not save a rating.', '截图和交互示例在立面题上展示一张随模板附带的论文 PDF 照片。这不是一次北京标注，也不会保存评分。'),
    ],
    flow: [p('Agreed 1–4 rubric', '约定好的 1–4 分细则'), p('Facade and street wall', '立面与街墙'), p('Labels per image', '每张图的标签'), p('A separate city model', '单独训练的城市模型')],
  },
};
