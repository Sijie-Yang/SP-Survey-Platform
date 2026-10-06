/** Editorial content checked against the four source PDFs on 2026-10-04.
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
};
