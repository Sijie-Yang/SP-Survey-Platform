/** Bilingual research documentation. Platform behaviour checked against the local
 * question registry, paperMethods, trueskill, analysisScope and Agent API contract.
 * Source references describe research methods; they do not certify this adaptation.
 */
const p = (en, zh) => ({ en, zh });
const s = (id, title, paragraphs, extra = {}) => ({ id, title, paragraphs, ...extra });
const table = (headers, rows) => ({ headers, rows });
export const DOC_GROUPS = [
  { id: 'perception', title: p('Urban Perception / Spatial Perception', '城市感知 / 空间感知'), description: p('Concepts, dimensions and the path from human experience to a research task.', '系统理解感知概念、维度，以及从人的体验到研究任务的过程。') },
  { id: 'foundations', title: p('Visual assessment', '视觉评估入门'), description: p('Define the judgement before choosing an instrument.', '先定义要测量的判断，再选择研究工具。') },
  { id: 'survey-design', title: p('Questions & media', '题型与媒体设计'), description: p('Match questions, stimuli and presentation to the research task.', '让题型、刺激材料与呈现方式匹配研究任务。') },
  { id: 'analysis', title: p('Scoring & analysis', '计分与分析方法'), description: p('Understand scores, uncertainty and the limits of comparisons.', '理解分数、不确定性和比较的适用范围。') },
  { id: 'platform', title: p('Using SP-Survey', 'SP-Survey 实践'), description: p('Build, preview, release and export a traceable study.', '搭建、预览、发布并导出可追溯的研究。') },
  { id: 'contributing', title: p('Contribute to SP-Wiki', '参与 SP-Wiki'), description: p('Share tutorials, propose improvements and communicate research.', '分享教程、改进文档与传播研究。') },
];
export const DOC_TOPICS = [
  {
    id: 'doc-news-submission', group: 'contributing', title: p('Doc / News Submission', 'Doc / News 投稿指南'),
    summary: p('Contribute a template tutorial, propose a wiki edit or introduce your research. Sign in, submit, follow the review, and revise when requested.', '提交模板教程、建议修改 Wiki，或介绍研究成果：登录、投稿、跟进审核，并按反馈修改。'),
    flow: [p('Sign in', '登录账号'), p('Write + preview', '撰写与预览'), p('Admin review', '管理员审核'), p('Publish or revise', '发布或修改重投')],
    sections: [
      s('choose', p('Choose the right submission', '选择投稿类型'), [
        p('SP-Wiki is the shared documentation area. Every signed-in user can suggest edits; changes become public only after administrator approval. Use “Suggest an edit” on an existing page, or open “Submit & my contributions” to start a new document or news article.', 'SP-Wiki 是共同建设的文档区。每位登录用户都能建议编辑，管理员通过后修改才会公开。在已有页面点击“建议编辑此页”，或进入“投稿与我的申请”创建新文档或研究新闻。'),
      ], { table: table([p('Type', '类型'), p('Submit here', '提交内容'), p('Published destination', '发布位置')], [
        [p('Wiki edit', 'Wiki 修改'), p('Correct wording, expand explanations or improve references; describe what changed', '修正表述、补充解释或改进引用，并说明修改原因'), p('A new revision of the same page and language', '同一页面、同一语言的新版本')],
        [p('Template tutorial / document', '模板教程／文档'), p('Explain a study and its reproducible SP-Survey workflow', '解释一项研究及可复现的平台实现流程'), p('SP-Wiki community documents', 'SP-Wiki 社区文档')],
        [p('Research news', '研究新闻'), p('Introduce findings, methods, contributors and links', '介绍发现、方法、贡献者与相关链接'), p('News', 'News 新闻栏目')],
      ]) }),
      s('tutorial', p('What makes a useful template tutorial?', '模板教程应该写什么？'), [
        p('Start with the full paper citation and DOI, the research question and the concepts being measured. Explain the population, media, questions, scales, trials and sampling. Then describe how to build and preview the survey, analyze its answers and export reproducible data.', '开头给出完整论文引用与 DOI、研究问题及测量概念。说明人群、媒体、题目、量表、轮次与抽样，再介绍如何搭建和预览问卷、分析回答、导出可复现数据。'),
        p('Include labeled screenshots or diagrams with permitted public image links and useful alt text. Identify adaptations from the paper, limitations and the origin of example media or data. Select a related built-in template when available; its complete preview will appear beside the approved article. For a new survey template itself, use the existing Request template workflow; a document submission does not create or publish a survey.', '使用有授权的公开图片链接加入截图或示意图，配上图注与替代文本。说明与原论文的差异、局限以及示例媒体和数据的来源。已有内置模板时可选择关联，审核后的文章会附完整模板预览。若要新增问卷模板本身，请使用现有“申请模板”流程；文档投稿不会创建或发布问卷。'),
      ]),
      s('news', p('How to write research news', '如何撰写研究宣传新闻'), [
        p('Use a clear title and a short summary. Explain the research problem, who did the work, what was studied, the main findings and why they matter. Link the paper, project or dataset and distinguish a preprint from a published paper. Mention limitations and avoid presenting associations as causal results.', '用清楚的标题与简短摘要开篇，介绍研究问题、研究团队、研究对象、主要发现及其意义。链接论文、项目或数据集，区分预印本与已发表论文，说明局限，避免把关联写成因果结论。'),
        p('Provide an author or team name suitable for public attribution. Put evidence links and figure credits in the article itself; the private sources-and-permissions field helps the reviewer but is not displayed in the published story. Submit in English or Chinese; review and publication apply to that language.', '填写适合公开展示的作者或团队署名。证据链接和图片署名应放进正文；私有“来源与素材授权说明”仅帮助审核，不会出现在公开文章中。可以选择英文或中文投稿，审核与发布针对所选语言。'),
      ]),
      s('review', p('Follow review and revise', '跟进审核与修改'), [
        p('Preview Markdown before submitting and confirm you have permission to share the material. “My submissions” shows pending, changes requested, rejected or published status and the reviewer’s feedback. After revising a returned draft, submit it again. Approval publishes the reviewed text; there is no separate automatic publication before approval.', '提交前预览 Markdown，并确认有权分享素材。“我的投稿”显示待审核、请修改后重投、未通过或已发布状态，以及审核反馈。收到退回意见后可以修改并重新提交。通过审核才会发布审核过的文字。'),
        p('If the original wiki page changed meanwhile, use “Load latest source to merge”. Your proposed text stays in the editor; compare it with the updated source and merge the changes manually before resubmission. Published versions retain attribution and a revision record. Platform previews, template settings and scoring tools are maintained separately from editable prose.', '如果原 Wiki 页面已被更新，请使用“载入最新原文以合并修改”。你的提案仍留在编辑框中，需要与最新原文比较、手动合并后重投。已发布版本保留署名与版本记录。平台预览、模板设置和计分工具与可编辑文字分别维护。'),
      ]),
    ], related: ['platform-workflow', 'results-export', 'question-types'],
  },
  {
    id: 'urban-spatial-perception', group: 'perception', title: p('Urban & spatial perception: concepts', '城市感知与空间感知：概念与边界'),
    summary: p('Understand how people experience environments, interpret spatial relationships and evaluate places before choosing a measurement method.', '在选择测量方法之前，理解人如何体验环境、理解空间关系并评价地方。'),
    flow: [p('Define the concept', '定义研究概念'), p('Specify person + context', '明确人群与情境'), p('Observe a judgement', '记录具体判断'), p('Bound the interpretation', '限定解释范围')],
    sections: [
      s('definitions', p('Two overlapping perspectives', '两个相互交叠的研究视角'), [
        p('In these Docs, urban perception means how people experience and interpret urban environments: what a street, building, neighbourhood or city seems like to them. It covers impressions of physical form as well as evaluations such as safety, attractiveness and comfort. These are working definitions for designing studies, rather than a single universal taxonomy.', '本文档将城市感知（Urban Perception）理解为人如何体验和解释城市环境：一条街、一栋建筑、一个街区或一座城市在人眼中是什么样的。它既涉及对物质形态的感知，也涉及安全、美观、舒适等评价。这是用于研究设计的工作定义，并非唯一通用的学科分类。'),
        p('Spatial perception focuses on experienced spatial properties and relationships: where something is, how far away it seems, or how open or enclosed a setting feels. It also applies to interiors and non-urban environments. Spatial cognition is broader, including learning, remembering and reasoning about space; a navigation task therefore need not measure perception alone (Montello, 2016).', '空间感知（Spatial Perception）关注体验到的空间属性与关系，例如位置、远近以及开敞或围合。它也适用于室内与非城市环境。空间认知还包括空间学习、记忆与推理，因此寻路任务未必只测量感知（Montello，2016）。'),
      ], { table: table([p('Perspective', '视角'), p('Example question', '研究问题示例'), p('What to specify', '需要明确什么')], [
        ['Urban perception', p('How safe does this street look to residents?', '居民觉得这条街看起来有多安全？'), p('Urban setting, population and evaluative dimension', '城市情境、人群与评价维度')],
        ['Spatial perception', p('How enclosed does this space feel from this viewpoint?', '从这个视点看，空间有多围合？'), p('Spatial property, viewpoint and reference frame', '空间属性、视点与参照方式')],
        [p('Their overlap', '二者交集'), p('Does perceived enclosure relate to street preference?', '街道围合感与偏好是否有关？'), p('Two separate constructs and their proposed relationship', '两个独立概念及其待检验关系')],
      ]) }),
      s('distinctions', p('Perception is not every response to a place', '区分对地方的不同反应'), [
        p('A study can connect perception, cognition, emotion, preference and behaviour, but should identify which it records. “It looks open”, “I remember the exit”, “I feel relaxed”, “I prefer this street” and “I walked here” answer different questions. The distinctions below are a design checklist; the processes can interact.', '研究可以连接感知、认知、情绪、偏好和行为，但应指出具体记录了哪一种。“看起来开阔”“我记得出口”“我感到放松”“我更喜欢这条街”“我在这里步行”回答的是不同问题。以下区分用于检查研究设计，这些过程可能相互作用。'),
      ], { table: table([p('Construct', '概念'), p('Illustrative evidence', '证据示例'), p('Do not equate it with', '不能直接等同于')], [
        [p('Perceived property', '感知属性'), p('A rating of openness or apparent distance', '开敞感或主观距离评价'), p('Measured geometry', '实测几何量')],
        [p('Spatial cognition', '空间认知'), p('A recalled landmark or route description', '地标回忆或路线描述'), p('A visual liking score', '视觉喜好分数')],
        [p('Affect', '情绪体验'), p('Reported calmness or tension', '自报平静或紧张'), p('A physiological recording', '生理记录')],
        [p('Preference', '偏好'), p('A choice between places for a specified purpose', '针对明确用途选择地方'), p('Actual use', '实际使用行为')],
        [p('Intention / behaviour', '意向／行为'), p('Willingness to walk / an observed walk', '步行意愿／观察到的步行'), p('Each other', '二者本身互相等同')],
      ]) }),
      s('situated', p('Person, environment and situation', '感知发生在人、环境与情境之间'), [
        p('Treat a judgement as situated: who is judging what, for which activity, at what time and through which medium? Ask separately whether a street looks safe to cross, safe from traffic while cycling, or safe from interpersonal harm at night. A single word such as “safety” does not resolve these differences.', '把判断放回具体情境：谁在判断什么，为了哪种活动，在什么时间，通过什么媒介？一条街过街是否安全、骑行时是否免受交通威胁、夜间是否令人担心人身安全，需要分别提问。“安全”这个词本身不能消除这些差异。'),
        p('Urban experience can involve sound, thermal conditions and other sensory information as well as vision. Audio-visual research, such as the Dalian pedestrian-street study by Ren et al. (2023), offers a concrete example of studying more than the image. An image-only task should be described as a visual judgement, not a complete account of being there.', '城市体验除了视觉，还可能涉及声音、热环境和其他感官信息。Ren 等（2023）关于大连步行街的视听研究，是把图像之外的信息纳入设计的一个例子。仅使用图片的任务，应描述为视觉判断，而非完整的现场体验。'),
      ]),
      s('traditions', p('From city image to evaluative judgement', '从城市意象到评价性判断'), [
        p('Lynch’s The Image of the City (1960) examines how city form becomes recognizable and memorable. His paths, edges, districts, nodes and landmarks provide a vocabulary for discussing urban structure; they are not a ready-made five-item rating scale. Nasar’s evaluative image asks how people evaluate places. These perspectives help distinguish knowing a place from liking it.', 'Lynch 的《The Image of the City》（1960）关注城市形态如何变得可识别、可记忆。路径、边界、区域、节点与地标提供了讨论城市结构的语言，并不是现成的五题评分量表。Nasar 的评价性意象则关注人如何评价地方。二者帮助区分“认识一个地方”与“喜欢一个地方”。'),
        p('In SP-Survey’s Place Pulse guide, the task instead compares street images on specified evaluative dimensions. These examples share an interest in people and environments, but use different observations. Choose a tradition to clarify the research question; do not combine their outputs just because all are called perception.', 'SP-Survey 的 Place Pulse 指南则展示按明确评价维度比较街景图片的任务。这些研究都关心人与环境，但记录的观测不同。理论视角应帮助明确研究问题，不能因为都称为“感知”就直接合并输出。'),
      ]),
      s('visual-bridge', p('Where visual assessment fits', '视觉评估处在什么位置？'), [
        p('Urban and spatial perception describe what you investigate. Visual assessment describes a way of eliciting evidence through visual material. Questions define the response; Q-score and TrueSkill aggregate certain comparison outcomes. Keep concept, collection method and scoring method separate, then justify their connection.', '城市感知与空间感知说明研究什么，视觉评估说明如何借助视觉材料获取证据，题目规定回答形式，Q-score 与 TrueSkill 则汇总特定的比较结果。应区分概念、数据收集方法与计分方法，再说明它们为何匹配。'),
      ]),
    ], references: [
      { label: 'Lynch, K. (1960). The Image of the City. MIT Press.', url: 'https://mitpress.mit.edu/9780262620017/the-image-of-the-city/' },
      { label: 'Montello, D. R. (2016). Behavioral Methods for Spatial Cognition Research. In Research Methods for Environmental Psychology.', url: 'https://people.geog.ucsb.edu/~montello/pubs/Behavioral%20Methods.pdf' },
      { label: 'Nasar, J. L. (1990). The Evaluative Image of the City.', url: 'https://doi.org/10.1080/01944369008975742' },
      { label: 'Ren et al. (2023). The effects of audio-visual perceptual characteristics on environmental health of pedestrian streets with traffic noise: A case study in Dalian, China.', url: 'https://doi.org/10.3389/fpsyg.2023.1122639' },
    ], related: ['perception-dimensions', 'perception-to-measurement', 'visual-assessment', '1990-nasar-evaluative'],
  },
  {
    id: 'perception-dimensions', group: 'perception', title: p('Dimensions, scales & context', '感知维度、空间尺度与情境'),
    summary: p('Separate what is judged, the spatial unit it refers to, and the conditions under which a person experiences it.', '分别定义评价什么、评价对应哪个空间单位，以及判断发生在什么体验条件下。'),
    sections: [
      s('dimensions', p('Perception is multidimensional', '感知具有多个维度'), [
        p('The following dimensions organize possible study questions. They are illustrative, not an exhaustive taxonomy or a validated scale. A place can appear attractive but difficult to navigate, or lively but uncomfortable for a particular activity. Measure the dimensions separately before proposing any combined index.', '下面的维度用于组织研究问题，是示例性框架，不是穷尽分类或已验证量表。一个地方可能美观但难以寻路，也可能有活力却不适合某种活动。提出综合指数之前，应先分别测量各维度。'),
      ], { table: table([p('Dimension', '维度'), p('Possible construct', '可研究的概念'), p('Example wording', '题干示例')], [
        [p('Spatial form', '空间形态'), p('Enclosure, openness, apparent scale', '围合感、开敞感、主观尺度'), p('How enclosed does this space feel?', '这个空间让你感到多大程度的围合？')],
        [p('Legibility', '可识别与可理解性'), p('Recognizability or orientation confidence', '可识别性、方向判断信心'), p('How confident are you about locating the exit?', '你对判断出口位置有多大把握？')],
        [p('Aesthetic evaluation', '审美评价'), p('Beauty, visual complexity, coherence', '美观、视觉复杂性、协调感'), p('Which scene looks more visually appealing?', '哪个场景在视觉上更吸引你？')],
        [p('Safety', '安全评价'), p('A specified perceived risk', '某类明确风险的主观判断'), p('How safe would you feel walking here after dark?', '设想天黑后在这里步行，你会感到多安全？')],
        [p('Comfort', '舒适评价'), p('Visual comfort or expected thermal comfort', '视觉舒适、预期热舒适'), p('Based on the image, how thermally comfortable would this place feel?', '仅根据图片，你预计这里的热环境会让你多舒适？')],
        [p('Activity suitability', '活动适宜性'), p('Perceived opportunity to sit, play or cycle', '对坐憩、玩耍或骑行机会的判断'), p('How suitable does this place seem for sitting and resting?', '这里看起来多适合坐下休息？')],
      ]) }),
      s('scales', p('Choose the spatial unit of the claim', '明确结论所对应的空间单位'), [
        p('An image, viewpoint, street segment, route, neighbourhood and city are different units. Several images may represent one site; one panorama can contain many directions. State which unit receives a score and how repeated views are combined. A score for a photograph is not automatically a score for its entire neighbourhood.', '图片、视点、街段、路线、街区与城市是不同单位。多张图片可能表示同一地点，一个全景也可能包含多个方向。应说明哪个单位获得分数、重复视图如何合并。一张照片的分数不会自动代表整个街区。'),
        p('Keep the representation scale distinct from the place scale. A city map fits on a phone screen while representing a large area; a close-up facade image may fill the screen while describing a small part of a street. Record the viewpoint, crop and intended object of judgement.', '区分呈现尺度与场所尺度。城市地图可以显示在手机上，却代表很大范围；立面特写可以占满屏幕，却只描述街道的一小部分。应记录视点、裁切与预期评价对象。'),
      ]),
      s('context', p('Describe whose experience, when and how', '说明谁在何时、以何种方式体验'), [
        p('Choose participant attributes because they matter to the question: local familiarity, travel mode, age, mobility needs or other relevant experience. Avoid treating a group average as the judgement of every member. Sampling, within-group variation and the distribution of answers should remain visible.', '参与者属性应由研究问题决定，例如地方熟悉度、出行方式、年龄、行动需求或相关经验。不要把群体均值当成每个成员的判断，应保留抽样方式、组内差异与回答分布。'),
        p('State whether participants judge a present image, imagine a scenario, recall a place, or answer while on site. Day/night, weather, activity and prior knowledge may be part of the intended condition or an uncontrolled difference. Record which, rather than silently pooling them.', '说明参与者是在评价眼前图片、设想情景、回忆地方，还是在现场回答。昼夜、天气、活动与先验知识可能是设计条件，也可能是未控制差异；应明确记录，不能默默混在一起。'),
      ]),
      s('evidence', p('Keep physical features, perceptions and outcomes distinct', '区分环境指标、感知与结果'), [
        p('For a greenery study, image-derived vegetation coverage, perceived greenery and willingness to stay are three separate variables. Compare them only after matching their site, view and observation context. Agreement can support a particular relationship; disagreement can reveal a limitation of the representation or the proposed proxy.', '以绿化研究为例，图像提取的植被覆盖、主观绿化感和停留意愿是三个独立变量。比较前应匹配地点、视图与观测情境。一致可能支持特定关系，不一致可能揭示呈现方式或代理指标的局限。'),
        p('Likewise, a visually inferred thermal judgement needs to be distinguished from on-site thermal sensation and instrument readings. The thermal case guide shows how the template operationalizes one visual judgement, while the greenery case provides another concept-to-task example.', '同样，从图像推断的热环境判断，需要与现场热感觉和仪器读数区分。热舒适案例展示模板如何操作化一种视觉判断，绿化案例则提供另一种从概念到任务的例子。'),
      ]),
    ], related: ['urban-spatial-perception', 'perception-to-measurement', '2025-yang-thermal', '2026-quintana-greenery', 'media-sampling'],
  },
  {
    id: 'perception-to-measurement', group: 'perception', title: p('From perception to a research task', '从感知概念到研究任务'),
    summary: p('Turn an abstract construct into a population, stimulus, question, recorded answer and defensible interpretation in SP-Survey.', '在 SP-Survey 中，把抽象概念转化为明确的人群、材料、题目、答案和可解释的结果。'),
    flow: [p('Concept + definition', '概念与定义'), p('People + materials', '人群与材料'), p('Question + answer', '题目与答案'), p('Analysis + claim', '分析与结论')],
    sections: [
      s('specification', p('Write a measurement specification', '先写一份测量说明'), [
        p('Before opening the builder, complete this sentence: “For [population], in [context], [construct] means [definition]; participants judge [object] using [task], and the resulting [answer] supports [limited interpretation].” This connects the concept to the evidence before a chart or model is chosen.', '打开编辑器前，先完成一句话：“对［人群］，在［情境］中，［概念］指［定义］；参与者通过［任务］评价［对象］，记录的［答案］支持［有限范围的解释］。”这让概念先与证据对应，再选择图表或模型。'),
      ], { callout: p('Example: For local adult residents, perceived pedestrian safety means the safety they expect while walking. They compare daytime street images under the same instruction; choices yield relative visual safety scores for those images, not measured incident risk.', '示例：对当地成年居民，“步行安全感”指其对步行安全的预期。参与者按相同说明比较白天街景，选择记录形成这些图片的相对视觉安全感分数，不代表实测事故或犯罪风险。') }),
      s('tasks', p('Match the task to the construct', '让任务与概念对应'), [
        p('The examples below are design options using existing platform families. They are not validated instruments supplied by the platform. Pilot the wording and anchors with the target population, and check whether participants interpret them as intended.', '下表是利用平台现有题型设计任务的示例，不代表平台提供了已验证测量工具。应在目标人群中试测措辞和端点，检查参与者的理解是否符合预期。'),
      ], { table: table([p('Research goal', '研究目标'), p('SP-Survey task', '平台任务'), p('Record and interpret', '记录与解释')], [
        [p('Relative visual safety', '相对视觉安全感'), p('Two-image choice with an explicit comparison instruction', '双图选择，明确比较说明'), p('Shown image IDs, choice/tie; Q-score or TrueSkill within the specified dimension', '展示图片 ID、选择／平局；在明确维度内计算 Q-score 或 TrueSkill')],
        [p('Perceived enclosure', '围合感'), p('Anchored image rating or a video matrix row', '有端点说明的图片评分或视频矩阵行'), p('Scale values per scene; preserve viewpoint and presentation medium', '逐场景量表值；保留视点与呈现媒介')],
        [p('Preferred areas', '偏好区域'), p('Image annotation on a shared base map, plus an explanation', '在共同底图上标注，并说明原因'), p('Locations, shapes and comments; report the base map and annotation denominator', '位置、形状与文本；报告底图和标注分母')],
        [p('Orientation confidence', '方向判断信心'), p('A rating after a defined image or route-video presentation', '观看明确图片或路线视频后评分'), p('Self-reported confidence; actual wayfinding accuracy needs a separate task and reference answer', '自报信心；真实寻路准确率需要独立任务与参照答案')],
      ]) }),
      s('validity', p('Check the link between concept and answer', '检查概念与答案之间的联系'), [
        p('Ask what evidence supports your interpretation: whether participants understand the item, whether responses are consistent under comparable conditions, and whether the measure relates to other variables as expected. Reliability is about consistency; it does not by itself establish that the intended construct was measured.', '检查哪些证据支持解释：参与者是否理解题目，可比条件下回答是否一致，以及测量与其他变量的关系是否符合预期。可靠性关注一致性，本身不证明测到了预期概念。'),
        p('A weighted “overall perception score” requires a stated reason for combining dimensions, a weighting rule and sensitivity checks. Separately report dimensions when that justification is absent. A model-generated response also remains a model response; it is not evidence of a human participant’s experience.', '加权“总体感知分数”需要说明维度合并理由、权重规则，并检查对这些选择的敏感性。如果缺少理由，应分别报告各维度。模型生成的回答仍然是模型回答，不是人类参与者体验的证据。'),
      ]),
      s('platform', p('Make the interpretation traceable in SP-Survey', '在 SP-Survey 中保留解释依据'), [
        p('Keep definitions in the question instructions and scale anchors; keep scene identity in media records; preserve the condition, revision and data source with responses. Inspect the participant preview and a small export before release. These records make the implementation traceable; validation remains part of the research design.', '将定义写入题目说明与量表端点，将场景身份保留在媒体记录中，并保留回答对应的条件、版本与数据来源。发布前检查参与者预览和小规模导出。这些记录使实现可追溯；测量验证仍属于研究设计。'),
        p('Continue with Visual assessment for visual evidence, Question types for the answer structure, and the analysis guides for aggregation. If the question concerns actual movement, gaze or physiological state, plan the appropriate additional collection system rather than treating a preference answer as a substitute.', '接下来可阅读 Visual Assessment 了解视觉证据，阅读题型指南确定答案结构，再阅读分析指南选择汇总方式。若研究关心真实移动、注视或生理状态，应另行规划适合的数据采集系统，不能以偏好回答替代。'),
      ]),
    ], related: ['visual-assessment', 'study-design', 'question-types', 'quality-reliability', 'platform-workflow'],
  },
  {
    id: 'visual-assessment', group: 'foundations', title: p('What is visual assessment?', '什么是视觉评估？'),
    summary: p('From a visual stimulus to a human judgement: concepts, measurements and evidence.', '从视觉刺激到人的判断：理解概念、测量与证据的关系。'),
    flow: [p('Research concept', '研究概念'), p('Stimulus + question', '刺激材料与题目'), p('Recorded judgement', '记录判断'), p('Score + interpretation', '计分与解释')],
    sections: [
      s('the-task', p('What does the participant actually do?', '参与者究竟在评价什么？'), [
        p('A visual assessment presents a scene, object or spatial representation and asks for a judgement about a specified attribute. In SP-Survey, a participant might compare two streets for perceived safety, rate the enclosure of a video clip, or mark pleasant places on a map.', '视觉评估向参与者展示场景、对象或空间表达，并请其针对明确属性作出判断。在 SP-Survey 中，可以比较两条街道的安全感、评价视频中的围合感，或在地图上标记令人愉悦的地方。'),
        p('Separate the concept, its question wording, and the recorded answer. “Perceived safety” is the concept; “Which place looks safer?” is a measurement task; choosing image A is one observation. Q-score and TrueSkill are ways to aggregate comparisons, not question types.', '区分概念、题目措辞与记录的答案。“安全感”是概念；“哪个地方看起来更安全？”是测量任务；选择图片 A 是一次观测。Q-score 和 TrueSkill 是汇总比较记录的方法，不是问卷题型。'),
      ]),
      s('boundaries', p('State what the evidence can support', '说明证据能支持什么'), [
        p('A judgement from an image describes an impression under that presentation. It does not directly measure actual crime risk, temperature or on-site behaviour. Define the observation context: image, video, map or an in-situ task with location metadata.', '图像判断描述的是特定呈现条件下的印象，不直接测量真实犯罪风险、气温或现场行为。应明确观察情境：图片、视频、地图，还是带地点信息的现场任务。'),
        p('Keep three layers distinct when combining data: physical features (such as a measured tree-cover fraction), perceptions (such as a greenery rating), and outcomes (such as walking behaviour). Their association is a research question, not a consequence of using the same label.', '合并数据时，区分物理特征（如测得的树木覆盖比例）、感知（如绿化感评分）与结果变量（如步行行为）。它们之间的关联需要研究验证，不能因为名称相似就视为等价。'),
      ], { table: table([p('Concept', '概念'), p('Possible task', '可用任务'), p('Interpretation boundary', '解释边界')], [
        [p('Perceived safety', '安全感'), p('Choose the safer-looking image', '选择看起来更安全的图片'), p('Relative visual judgement', '相对视觉判断')],
        [p('Enclosure', '围合感'), p('Rate a defined quality from 1 to 5', '按定义评价 1–5 分'), p('Scale anchors must be explicit', '需明确量表端点')],
        [p('Place preference', '地方偏好'), p('Mark areas and explain why', '标记区域并解释理由'), p('Depends on familiarity and map comprehension', '依赖熟悉程度和地图理解')],
      ]) }),
      s('start', p('A useful first study', '从一项可解释的研究开始'), [
        p('Write one sentence connecting a population, a stimulus set, a concept and a planned output. For example: “Among local residents, compare a defined set of street images for perceived safety and estimate a separate score for each image.” Then choose a question family and pilot it.', '用一句话连接目标人群、刺激材料集合、概念与计划输出。例如：“请当地居民比较一组明确的街景图片的安全感，并估计每张图片的分数。”再据此选择题型并开展试答。'),
      ]),
    ], related: ['urban-spatial-perception', 'perception-to-measurement', 'study-design', 'question-types', '2013-salesses-collaborative', '2025-yang-thermal'],
  },
  {
    id: 'study-design', group: 'foundations', title: p('Design a visual study', '如何设计视觉评估研究'),
    summary: p('Operational definitions, sampling, comparison structure and a pilot that tests the whole workflow.', '从操作化定义、抽样和比较结构，到检验完整流程的小规模试答。'),
    sections: [
      s('operationalize', p('Make the concept answerable', '把概念转化为可回答的问题'), [
        p('Define the attribute in everyday language, specify the object of judgement, and use one direction consistently. “More safe”, “less safe” and “more comfortable” are not interchangeable instructions. Record the wording, scale anchors, optional responses and any reverse coding before collection.', '用清楚的语言定义属性、指出评价对象，并统一方向。“更安全”“更不安全”“更舒适”不能互换。收集前记录题干、量表端点、可选回答，以及是否需要反向计分。'),
        p('Use background questions only when they serve the study. An optional answer, an explicit Equal choice and a skipped trial represent different states; the instrument and export should preserve that distinction.', '背景题应服务于研究问题。可选题未答、明确选择“相等”和跳过一轮是不同状态，应在问卷与导出中保留区别。'),
      ]),
      s('sample', p('Plan both people and stimuli', '同时规划参与者与刺激材料'), [
        p('Specify who the participants represent and how scenes enter the sample. Standardize presentation choices that could alter the judgement: crop, orientation, resolution, visible labels and playback rules. Log purposeful differences such as before/after conditions.', '说明参与者代表谁、场景如何进入样本。统一可能改变判断的裁切、朝向、分辨率、可见标签与播放规则。对于前后对照等刻意保留的差异，应明确记录。'),
        p('A participant can answer many trials. Participant count, trial count and observations per image are different quantities. Random selection alone does not guarantee even coverage or a connected comparison network; inspect the realized assignments.', '一个参与者可以回答很多轮。人数、轮次数和每张图的观测数是不同数量。随机抽取不保证均匀覆盖，也不保证比较网络连通；需要检查实际分配记录。'),
      ]),
      s('conditions', p('Choose a comparison structure', '选择比较结构'), [
        p('Use condition assignment for participant groups and media sets for matched stimuli. For a before/after intervention, keep the matching ID so the intended pair stays together. For reversed wording, verify which condition reverses the outcome before combining records.', '参与者分组使用实验条件，匹配刺激材料使用媒体组。前后干预对照应保留匹配 ID，使指定配对一起出现。反向措辞题需检查哪些条件要先翻转结果，再合并记录。'),
      ], { table: table([p('Design choice', '设计选择'), p('Check in SP-Survey', '在平台中检查')], [
        [p('Between-participant conditions', '被试间条件'), p('Condition IDs, wording variants and recorded assignment', '条件 ID、措辞变体与记录的分组')],
        [p('Repeated trials', '重复轮次'), p('Trial count, media reuse and participant workload', '轮次、媒体复用与作答负担')],
        [p('Matched image comparisons', '匹配图片比较'), p('Set membership and missing set members', '组成员以及缺失成员')],
      ]) }),
      s('pilot', p('Pilot the full path to an export', '试测直到数据导出'), [
        p('Try a desktop and a phone, read the instructions aloud, test the tie/skip rules, and inspect a small export. Confirm that you can recover which material was shown, the answer direction and the analysis unit. Change the instrument before releasing the participant version.', '分别用桌面和手机试答，逐句检查说明，测试平局与跳过规则，并检查一份小规模导出。确认能还原展示材料、回答方向和分析单位，再发布参与者版本。'),
      ]),
    ], related: ['media-sampling', 'quality-reliability', 'platform-workflow', '2023-kang-assessing'],
  },
  {
    id: 'question-types', group: 'survey-design', title: p('Choose a question type', '如何选择问卷题型'),
    summary: p('Comparison, rating, ranking, matrices, allocation and annotation produce different kinds of evidence.', '比较、评分、排序、矩阵、分配与标注产生不同类型的证据。'),
    gallery: true,
    sections: [
      s('match', p('Start with the desired answer', '从需要的答案出发'), [
        p('Select the answer structure before choosing the chart. A forced choice asks which item wins; a slider asks for magnitude; a ranking orders a displayed set. The visual interface may look similar, but their stored answers and analysis families differ.', '先选答案结构，再选图表。强制选择回答谁更符合问题，滑块回答程度，排序回答一组材料的先后。界面可能相似，但存储答案和分析方法不同。'),
      ], { table: table([p('Task', '任务'), p('Platform family', '平台题型'), p('Read the result as', '结果含义')], [
        [p('Choose among images', '图片选择'), 'imagepicker / mediapicker', p('Choices; two items give pairwise outcomes', '选择记录；两项时得到成对结果')],
        [p('Rate one attribute', '评价一个属性'), 'rating / imagerating / mediarating', p('Values on explicitly anchored scales', '有明确端点的量表数值')],
        [p('Rate several attributes', '评价多个属性'), 'slidergroup / imageslidergroup / mediaslidergroup', p('A separate value per dimension', '每个维度一个值')],
        [p('Rate rows against common options', '多行共用评价选项'), 'matrix / imagematrix / mediamatrix', p('A response per row; means only when numeric', '逐行回答；只有数值选项才适合均值')],
        [p('Order a set', '对材料排序'), 'ranking / imageranking', p('Ranks within the shown set', '所展示集合内的名次')],
        [p('Distribute a budget', '分配有限预算'), 'pointallocation / imagepointallocation', p('Shares and budget use', '分配比例和预算使用情况')],
        [p('Locate evidence', '指出空间位置'), 'imageannotation', p('Shapes, labels and optional notes', '形状、标签与可选备注')],
        [p('Mark changes in video', '标记视频变化'), 'skillquestion · video_moment_tag / video_continuous_rating', p('Time intervals or a time series', '时间区间或时间序列')],
        [p('Explain a judgement', '解释评价'), 'comment / text', p('Text for review and further coding', '供阅读和进一步编码的文本')],
      ]) }),
      s('scale', p('Specify scale and choice semantics', '明确量表与选择的含义'), [
        p('Label both ends of a numeric scale and decide whether an intermediate value is meaningful. Keep direction consistent across questions or explicitly reverse-code. Use a categorical question when numbers are only category IDs; the existence of numeric codes does not justify taking their mean.', '标注数值量表两端，判断中间值是否具有明确含义。各题保持同向或明确反向计分。数字仅作为类别编号时，应使用分类题；有数字编码不代表可以计算均值。'),
        p('Two-image choice and multiway choice are different designs. The platform can expand selected-versus-unselected items into pairs, but those pairs come from the same trial and are dependent. A best–worst task similarly contributes several related comparisons.', '双图选择与多图选择是不同设计。平台可以把选中项与未选中项展开为多个比较，但它们来自同一轮、相互依赖。最佳—最差任务同样会贡献多个相关比较。'),
      ]),
      s('preview', p('Check the participant view', '检查参与者视角'), [
        p('Preview the exact question with representative media, test all permitted answers and inspect a sample export. The screenshots below come from the actual platform renderer; open the linked case guide to try each example. Custom interactions can use Skills while preserving a typed answer family.', '用有代表性的媒体预览实际题目，测试全部允许的回答，再检查示例导出。下方截图来自平台真实渲染器；进入对应案例即可试答。需要自定义交互时，可以用 Skill，同时保留明确的答案类型。'),
      ]),
    ], related: ['choosing-analysis', 'annotations-video', 'skills-agents', '2009-ewing-measuring'],
  },
  {
    id: 'media-sampling', group: 'survey-design', title: p('Media, trials & sampling', '媒体、轮次与抽样'),
    summary: p('Keep image identities, matched sets and actual exposure separate from folder names and intended counts.', '区分媒体身份、匹配组和实际曝光，不只记录文件夹名与计划轮次。'),
    flow: [p('Import study media', '导入研究媒体'), p('Define folders / sets', '定义文件夹与组'), p('Assign each trial', '逐轮分配'), p('Record what was shown', '记录实际展示')],
    sections: [
      s('identity', p('Keep stimulus identity stable', '保持刺激材料身份稳定'), [
        p('Use the project media library, an existing template dataset, or researcher-supplied files. A stable media ID is the link between answers, scores and later feature data. Renaming a file or relying only on its display position can break that link.', '使用项目媒体库、现有模板数据集或研究者提供的文件。稳定的媒体 ID 连接答案、分数与后续特征数据。只依赖文件名或显示位置，可能破坏这条对应关系。'),
        p('Document provenance and any crop, resize or transformation that changes the stimulus. The platform preview library and the Docs demonstration frames help check the interface; they are not automatically a suitable research sample.', '记录素材来源，以及会改变刺激内容的裁切、尺寸调整或变换。平台预览媒体库和 Docs 演示画面用于检查界面，并不自动构成适用的研究样本。'),
      ]),
      s('assignment', p('Match assignment rules to the design', '让分配规则匹配研究设计'), [
        p('Folders organize media. Set tags identify items that belong together; category tags identify groups such as a site or scene class. Decide whether a trial samples individual items, a matched set, or a category-specific pool. Preview with your actual tags and media counts.', '文件夹组织媒体；set 标签标识需要一起出现的材料；category 标签标识地点或场景类别等分组。应决定每轮抽取独立材料、匹配组，还是特定类别内的材料，并用真实标签和媒体数量预览。'),
      ], { table: table([p('Need', '需要'), p('Design decision', '设计决策')], [
        [p('Broad image coverage', '覆盖多张图片'), p('Individual sampling; inspect actual exposures', '独立抽样，并检查实际曝光')],
        [p('Before/after pair', '前后对照配对'), p('Matched sets; check all members are present', '使用匹配组，检查成员完整')],
        [p('Within-category comparison', '类别内比较'), p('Category sampling; interpret category-specific ranks', '按类别抽样，在类别内解释排序')],
        [p('Same base map twice', '两题共用同一底图'), p('Allow intended media reuse', '允许设计中预期的媒体复用')],
      ]) }),
      s('coverage', p('Plan exposure, then inspect it', '先规划曝光，再核对实际覆盖'), [
        p('With P participants completing T two-image trials, 2PT image appearances are planned. Dividing by M images gives only the expected average under even assignment, not a guarantee for every image. Skips, missing files and sampling rules can reduce usable observations.', '若 P 名参与者各完成 T 轮双图题，计划产生 2PT 次图片出现。除以 M 张图片，只得到均匀分配假设下的平均值，不保证每图都达到。跳过、文件缺失与抽样规则都可能减少可用观测。'),
        p('The stored shown-media records tell you what each person actually saw. Use those records for scoring and audits, including trial indices and set/category metadata. A question’s configured image count alone cannot reconstruct historical exposure.', '存储的展示媒体记录说明每个人实际看到了什么。计分和审计应使用这些记录，包括轮次索引和组／类别信息；仅靠题目配置中的图片数量，无法还原历史曝光。'),
      ]),
    ], related: ['study-design', 'quality-reliability', 'results-export', '2026-lopes-street-gsv'],
  },
  {
    id: 'annotations-video', group: 'survey-design', title: p('Spatial & temporal answers', '空间标注与视频回答'),
    summary: p('Understand coordinates, areas, timestamps and the units behind overlays and timelines.', '理解坐标、区域、时间戳，以及叠加图与时间线背后的统计单位。'),
    sections: [
      s('space', p('Points and areas answer different questions', '点与区域回答不同的问题'), [
        p('An annotation can locate a point, trace a path, draw a polygon or box, and associate a label or note. Choose the tool that matches the claim: a point marks a location; a polygon expresses extent. Keep the base image and its ID with the answer.', '标注可以指出点、描绘路径、绘制多边形或框，并关联标签或备注。工具要匹配研究结论：点表示位置，多边形表示范围。应将底图及其 ID 与答案一起保留。'),
        p('The map example records image-relative coordinates. Geographical analysis needs a separate mapping from image coordinates to a geographic reference. An annotation overlay shows where participants marked; it does not by itself identify causation or attention measured by an eye tracker.', '地图示例记录相对图像坐标。地理分析还需要把图像坐标映射到地理参考系。标注叠加图表示参与者标记了哪里，本身不证明因果关系，也不等同于眼动仪测得的注意。'),
      ]),
      s('time', p('Choose a temporal task', '选择时间维度上的任务'), [
        p('A video matrix rates a clip as a whole. The video-moment and continuous-rating Skill presets record time intervals or values over time, respectively. They require different answer structures and cannot be interpreted as the same measurement just because all use video.', '视频矩阵评价整段视频；视频时段与连续评分 Skill 预设分别标记时间区间和记录随时间变化的值。它们需要不同答案结构，不能因为都使用视频就视为相同测量。'),
        p('The platform uses half-open intervals for video segments and caps each response’s contribution per time bucket. Continuous values are averaged within each response/bucket before averaging across responses. Repeated trials or submissions are not independent participant counts.', '平台的视频区间使用左闭右开规则，同一回答在一个时间桶中最多贡献一次。连续值先在每个回答／时间桶内平均，再跨回答平均。重复轮次或重复提交不等于独立参与者人数。'),
      ]),
      s('read', p('Read overlays together with coverage', '结合覆盖量阅读叠加结果'), [
        p('For liked-minus-disliked maps, inspect each layer and its denominator before the difference. The current implementation excludes empty annotation units separately in each layer. For video, inspect the timeline coverage and missing intervals before treating a peak as a shared response.', '阅读“喜欢减不喜欢”地图前，先看各层及其分母。当前实现分别排除两层中的空标注单元。视频则应先检查时间线覆盖和缺失区间，再判断某个峰值是否代表共同反应。'),
      ]),
    ], related: ['1990-nasar-evaluative', '2009-ewing-measuring', 'quality-reliability', 'results-export'],
  },
  {
    id: 'q-score', group: 'analysis', title: p('Q-score: scoring comparisons', 'Q-score：如何把比较变成分数'),
    summary: p('Win fractions, opponent adjustment, ties and comparison coverage in the Place Pulse method.', '理解 Place Pulse 方法中的胜率、对手校正、平局与比较覆盖量。'),
    lab: true,
    sections: [
      s('inputs', p('Start with one concept and its comparisons', '从一个概念的比较记录开始'), [
        p('Q-score aggregates pairwise outcomes for one dimension. A record needs both shown image identities and the chosen image or Equal. Normalize reversed wording first. Safety and uniqueness require separate scores even if they use the same images.', 'Q-score 汇总同一维度的成对比较。每条记录需要两张展示图片的身份，以及选择哪张或是否相等。先统一反向措辞的方向。安全感与独特性即使用同一批图，也应分别计分。'),
        p('A raw win fraction is sensitive to which opponents an image meets. This method adds information about the outcomes of those opponents. It is a score derivation used by the Place Pulse 1.0 case, not a new question widget.', '单看胜率会受到对手构成的影响。这个方法进一步纳入对手的比较表现。它是 Place Pulse 1.0 案例采用的计分方法，不是另一种问卷控件。'),
      ]),
      s('formula', p('Read the calculation', '读懂计算过程'), [
        p('For image i, let Wᵢ and Lᵢ be its win and loss fractions, each divided by wins + losses + ties. Average W over opponents it defeated, and L over opponents that defeated it. The platform averages over comparison events, so repeated opponents contribute repeatedly.', '对图片 i，Wᵢ 与 Lᵢ 分别是胜率和负率，分母都为胜、负、平之和。再分别计算被它击败的对手的平均胜率，以及击败它的对手的平均负率。平台按比较事件平均，因此重复对手会重复贡献。'),
        p('Qᵢ = (10 / 3) × [Wᵢ + mean(W of defeated opponents) − mean(L of opponents that defeated i) + 1]. The output is on a 0–10 scale. Empty opponent sets contribute zero in the current implementation. Ties affect the denominator but create neither a win nor a loss.', 'Qᵢ = (10 / 3) ×［Wᵢ + 被击败对手的平均 W − 击败 i 的对手的平均 L + 1］。输出为 0–10。当前实现对空对手集合取零。平局影响分母，但不产生胜或负。'),
      ], { formula: 'Qᵢ = 10/3 × (Wᵢ + W̄beaten − L̄beaten-by + 1)' }),
      s('platform', p('Where to use it in SP-Survey', '在 SP-Survey 中如何使用'), [
        p('Open Results for the comparison question and set Score to Q-score. Inspect wins, losses, ties and comparisons alongside the score. When Q-score is the recommended method, the minimum comparison count starts at four unless the template sets another value; items below your chosen threshold have no score rather than a zero score.', '在结果里打开比较题，把计分方法选成 Q-score。将胜、负、平、比较次数与分数一起检查。Q-score 为推荐方法时，最少比较次数默认从 4 起，除非模板另有设置；低于所选阈值的图片没有分数，而不是得零分。'),
        p('The minimum is a calculation filter, not a sample-size justification. Inspect coverage and ranking stability, retain your threshold in the methods report, and avoid interpreting a missing score as a poor scene. The lab below lowers the threshold to 1 for teaching.', '最低次数是计算筛选条件，不是样本量论证。应检查覆盖和排序稳定性，在方法报告中保留阈值，不要将缺失分数解释为场景表现差。下面实验台为教学把阈值降为 1。'),
      ]),
    ], references: [{ label: 'Salesses, Schechtner & Hidalgo (2013), Methods', url: 'https://doi.org/10.1371/journal.pone.0068400' }],
    related: ['trueskill', 'choosing-analysis', 'quality-reliability', '2013-salesses-collaborative'],
  },
  {
    id: 'trueskill', group: 'analysis', title: p('TrueSkill: ratings & uncertainty', 'TrueSkill：评分与不确定性'),
    summary: p('Read μ, σ and conservative estimates; understand order, ties and sample-relative scaling.', '读懂 μ、σ 与保守估计，理解顺序、平局和样本内缩放。'),
    lab: true,
    sections: [
      s('model', p('What do μ and σ represent?', 'μ 和 σ 表示什么？'), [
        p('TrueSkill is a Bayesian rating framework originally developed for game outcomes. It represents an estimated latent strength using a mean μ and uncertainty σ. In a perception application, images take the role of compared entities; the inferred strength refers to one specified judgement dimension.', 'TrueSkill 是最初用于比赛结果的贝叶斯评分框架，以均值 μ 和不确定性 σ 描述潜在强度。在感知应用中，图片成为被比较的对象，推断出的强度对应某个明确的评价维度。'),
        p('In SP-Survey’s decisive pairwise implementation, initial μ is 25 and σ is 25/3; β = σ/2 and τ = σ/100. A win updates the winner and loser sequentially. The output also includes μ − 3σ as a conservative estimate. The usual ranking table orders by μ, so always state which value you rank on.', 'SP-Survey 的胜负比较实现初始 μ 为 25、σ 为 25/3，β = σ/2、τ = σ/100。胜负记录依次更新双方估计。输出还包含 μ − 3σ 作为保守估计；常规排序表按 μ 排列，因此应说明采用哪种值排序。'),
      ]),
      s('choices', p('Three implementation choices to report', '需要报告的三个实现选择'), [
        p('The standard path updates on decisive outcomes. Ties can instead be treated as draws; the draw margin uses a draw probability, with the observed tie rate as the default when applicable. Changing this option changes the model update, not merely the displayed count.', '标准路径使用有胜负的记录更新。也可以把平局视为打平；打平边界由平局概率确定，适用时默认使用观测平局率。改变此选项会改变模型更新，不只是改变显示数量。'),
        p('One run follows the input order. Multiple runs use seeded permutations and average the fitted results. This reduces sensitivity to one ordering; the across-run variation is not a participant-sampling confidence interval.', '一次运行沿用输入顺序；多次运行使用固定种子的重排并平均拟合结果。这可以降低对单一顺序的敏感性，但运行间差异不是参与者抽样的置信区间。'),
        p('Optional 0–5 or 0–10 output is a within-sample min–max transformation. It is not a Likert answer and does not calibrate scores across cities, studies or filtered subsets. In the single-category-per-trial workflow, the standard ranking is fitted separately by category.', '可选的 0–5 或 0–10 输出是样本内最小—最大变换，不是参与者填写的 Likert 答案，也不会让不同城市、研究或筛选子集的分数自动可比。在每轮单一类别的流程中，标准排序会按类别分别拟合。'),
      ], { table: table([p('Value', '数值'), p('Meaning in the platform', '平台中的含义')], [
        ['μ', p('Estimated strength for this judgement', '该判断维度的估计强度')],
        ['σ', p('Model uncertainty; not inter-rater standard deviation', '模型不确定性，不是评分者之间的标准差')],
        ['μ − 3σ', p('A conservative ranking statistic', '一种保守排序统计量')],
        ['0–5', p('Sample-relative display scale', '样本内相对显示尺度')],
      ]) }),
      s('interpret', p('Read it as a relative model', '作为相对模型解释'), [
        p('Report the question, outcome extraction, tie rule, number of runs, ranking statistic and scaling. Retain the raw comparisons. A high μ does not prove a real-world outcome or a significant difference; sparse or disconnected comparisons need particular care.', '报告题目、结果提取方式、平局规则、运行次数、排序统计量和缩放，并保留原始比较。μ 较高不证明现实结果更好或差异显著；稀疏或不连通的比较尤其需要谨慎解释。'),
      ]),
    ], references: [{ label: 'Microsoft Research — TrueSkill ranking system', url: 'https://www.microsoft.com/en-us/research/project/trueskill-ranking-system/' }],
    related: ['q-score', 'icc', 'choosing-analysis', 'quality-reliability', '2025-yang-thermal'],
  },
  {
    id: 'icc', group: 'analysis', title: p('ICC: rater agreement', 'ICC：评分者一致性'),
    summary: p('Read ICC(2,1) and ICC(2,k) on a complete stimulus-by-rater matrix, and see what the coefficients do not prove.', '读懂完整“刺激材料 × 评分者”矩阵上的 ICC(2,1) 与 ICC(2,k)，以及这两个系数不能证明什么。'),
    flow: [p('One quality, shared stimuli', '一个品质、共同材料'), p('Keep complete overlap', '保留完整重叠'), p('ICC(2,1) and ICC(2,k)', 'ICC(2,1) 与 ICC(2,k)'), p('Report who remained', '报告留下了谁')],
    lab: 'icc',
    sections: [
      s('model', p('Two coefficients from one matrix', '同一矩阵上的两个系数'), [
        p('ICC here is an intraclass correlation for absolute agreement among raters, using the two-way random model of Shrout and Fleiss (1979): each stimulus is rated by raters drawn from a larger rater population, and the target is the rating itself, not merely the ranking of stimuli. It is a reliability coefficient, not a score for a street, image or clip.', '这里的 ICC 是评分者之间绝对一致性的组内相关系数，采用 Shrout 与 Fleiss（1979）的双向随机模型：每个刺激材料由从更大评分者总体中抽出的评分者评价，目标是分数本身是否接近，而不只是材料排序是否相似。它是可靠性系数，不是某条街、某张图或某段视频的得分。'),
        p('ICC(2,1) estimates the absolute agreement expected from a single rater. ICC(2,k) estimates the absolute agreement expected from the average of the k raters in the matrix. The second is usually higher: averaging raters reduces the effect of one person’s departure. Report which coefficient matches the decision you will make, a future single rater or the mean of a panel like this one.', 'ICC(2,1) 估计单独一位评分者所能达到的绝对一致性。ICC(2,k) 估计矩阵中这 k 位评分者平均分的绝对一致性。后者通常更高，因为平均会减弱单个人的偏离。应报告哪个系数对应你的决策：将来由一位评分者判断，还是采用这样一组评分者的平均分。'),
      ], { table: table([p('Value', '数值'), p('Meaning in the platform', '平台中的含义')], [
        ['ICC(2,1)', p('Absolute agreement for one rater', '一位评分者的绝对一致性')],
        ['ICC(2,k)', p('Absolute agreement for the mean of these k raters', '这 k 位评分者平均分的绝对一致性')],
        [p('95% interval', '95% 区间'), p('McGraw & Wong interval for ICC(2,1); the ICC(2,k) interval transforms those bounds', 'ICC(2,1) 使用 McGraw 与 Wong 区间；ICC(2,k) 的区间由该界限变换而来')],
        [p('Negative value', '负值'), p('Disagreement exceeds differences among stimuli; not a reversed scale', '评分者分歧大于材料之间的差异，不是反向量表')],
      ]) }),
      s('formula', p('Read the calculation', '读懂计算过程'), [
        p('Arrange one quality as a matrix with n stimuli in the rows and k raters in the columns. MSR is the mean square for stimuli, MSC the mean square for raters, and MSE the residual mean square. The platform uses:', '把一个品质排成矩阵：行是 n 个刺激材料，列是 k 位评分者。MSR 是材料均方，MSC 是评分者均方，MSE 是残差均方。平台使用：'),
      ], {
        formula: 'ICC(2,1) = (MSR − MSE) / [MSR + (k − 1)MSE + k(MSC − MSE) / n]\nICC(2,k) = (MSR − MSE) / [MSR + (MSC − MSE) / n]',
        callout: p('The 95% interval for ICC(2,1) follows the McGraw and Wong F approximation. The interval for ICC(2,k) applies k·x / (1 + (k − 1)·x) to those two bounds. An interval is omitted when the estimate is not below 1 or the residual mean square is not positive.', 'ICC(2,1) 的 95% 区间采用 McGraw 与 Wong 的 F 近似。ICC(2,k) 的区间把这两个界限代入 k·x / (1 + (k − 1)·x)。当估计值不低于 1，或残差均方不是正数时，不给出区间。'),
      }),
      s('platform', p('Where to use it in SP-Survey', '在 SP-Survey 中如何使用'), [
        p('Open Results for a numeric rating, slider or matrix question. The Rater agreement block reports ICC(2,1) and ICC(2,k) with their intervals, plus how many raters and what fraction of stimuli remain. A matrix or video matrix is calculated for the selected row only: Imageability and Enclosure are separate coefficients. A slider group is calculated for the selected dimension.', '在数值评分、滑块或矩阵题的结果中查看“评分者一致性”。它给出 ICC(2,1)、ICC(2,k) 及其区间，并写明保留了多少位评分者、多少比例的刺激材料。矩阵和视频矩阵只计算当前选中的那一行：可意象性与围合感是两个系数。滑块组只计算当前选中的维度。'),
        p('By default the rater is the participant. You can instead use a text answer, such as the rater ID in the Urban Design Qualities template, so the same person is not split by repeated submissions. If one rater scores the same stimulus more than once, those ratings are averaged before the ICC.', '默认评分者是参与者。也可以改用文本题答案，例如 Urban Design Qualities 模板里的评分者编号，避免同一个人因重复提交被拆开。同一评分者对同一材料的多次评分会先取平均，再计算 ICC。'),
        p('The coefficient needs a complete rectangle: every retained rater scored every retained stimulus. The platform keeps the largest such block. If fewer than two stimuli are complete, it drops the rater who covered the fewest stimuli and tries again, and it stops once only two raters remain. Calculation requires at least two raters and two complete stimuli. Report the retained counts; a headline coefficient without them hides how much of the study was excluded.', '计算需要一个完整矩形：留下的每位评分者都评价了留下的每个材料。平台保留最大的这样一组。若完整材料少于两个，就去掉覆盖材料最少的评分者再试，直到只剩两位评分者为止。至少需要两位评分者和两个完整材料。应报告保留数量；只报一个系数会掩盖有多少数据被排除。'),
      ]),
      s('interpret', p('Read agreement separately from the score', '把一致性与分数分开读'), [
        p('Use the per-stimulus mean, spread and count to describe a clip. Use ICC to describe whether raters agree on that quality. A high ICC(2,k) can sit next to a modest ICC(2,1). Neither number says the quality was validly defined, that one clip is better than another, or that the rating predicts walking or any other behaviour.', '用每个材料的均值、离散程度和人数描述一段视频。用 ICC 描述评分者在该品质上是否接近。ICC(2,k) 可以很高，同时 ICC(2,1) 只是中等。这两个数都不能说明品质定义有效、某段视频优于另一段，或评分能够预测步行及其他行为。'),
        p('In Ewing and Handy (2009), the ICC discussion concerns reliability of coded physical features. The platform coefficient on the quality matrix is a separate analysis. Say which one you computed. On the same results panel, yes/no questions use Fleiss’ kappa instead of ICC, and exactly two raters also receive a weighted kappa.', 'Ewing 与 Handy（2009）文中的 ICC 讨论的是物理特征编码的可靠性。平台对品质矩阵计算的系数是另一项分析，报告时应说明计算的是哪一个。同一结果面板中，是否题使用 Fleiss κ 而不是 ICC；恰好两位评分者时还会给出加权 κ。'),
      ]),
    ],
    references: [
      { label: 'Shrout, P. E., & Fleiss, J. L. (1979). Intraclass correlations: Uses in assessing rater reliability. Psychological Bulletin, 86(2), 420–428.', url: 'https://doi.org/10.1037/0033-2909.86.2.420' },
      { label: 'McGraw, K. O., & Wong, S. P. (1996). Forming inferences about some intraclass correlation coefficients. Psychological Methods, 1(1), 30–46.', url: 'https://doi.org/10.1037/1082-989X.1.1.30' },
    ],
    related: ['2009-ewing-measuring', 'quality-reliability', 'choosing-analysis', 'results-export'],
  },
  {
    id: 'choosing-analysis', group: 'analysis', title: p('Choose and report an analysis', '如何选择并报告分析方法'),
    summary: p('Distinguish raw responses, score derivation, reliability and downstream inference.', '区分原始回答、计分、可靠性检验与后续推断。'),
    sections: [
      s('layers', p('Four layers of an analysis', '分析的四个层次'), [
        p('Start with the unit recorded by the question. Summarize or score those answers, inspect their coverage and reliability, and then ask what further comparison or model the research question needs. A platform chart completes only the steps it actually computes.', '从题目记录的单位开始，汇总或计分，再检查覆盖与可靠性，最后判断研究问题还需要什么比较或模型。平台图表只完成实际执行的步骤。'),
      ], { table: table([p('Layer', '层次'), p('Example', '例子')], [
        [p('Observation', '观测'), p('Participant P chose image A over B on trial 3', '参与者 P 在第 3 轮选择 A 而非 B')],
        [p('Score derivation', '计分'), p('Q-score or TrueSkill for each image', '每图的 Q-score 或 TrueSkill')],
        [p('Diagnostics', '诊断'), p('Per-image coverage, retest or split-half checks', '每图覆盖、重测或分半检查')],
        [p('Inference', '推断'), p('A model relating perceptions to independently measured features', '把感知与独立测量特征关联的模型')],
      ]) }),
      s('families', p('Match the method to the answer family', '让方法匹配答案类型'), [
        p('Use frequencies for categorical choices, distributions for numeric ratings, row-wise summaries for matrices, and separate dimensions for sliders. Rank positions are not numeric intensity scores. For text, the initial view is an inventory; a qualitative coding scheme is an additional method.', '分类选择使用频数，数值评分使用分布，矩阵逐行汇总，多维滑块分开分析。名次不是程度分数。文本的初始视图是回答清单；定性编码方案属于额外分析方法。'),
      ], { table: table([p('Answer', '答案'), p('Available approach', '可用方法'), p('Decision to record', '需要记录的决策')], [
        [p('Pairwise choice', '成对选择'), 'Q-score / TrueSkill / choice share', p('Opponent adjustment, ties and coverage', '对手校正、平局与覆盖')],
        [p('Numeric rating', '数值评分'), p('Mean, median, distributions; optional MAD screening', '均值、中位数、分布；可选 MAD 筛选'), p('Scale and any exclusion rule', '量表与排除规则')],
        [p('Ranking', '排序'), p('Mean rank, Borda; Kendall W for suitable complete rankings', '平均名次、Borda；适用完整排序可用 Kendall W'), p('Whether everyone ranked the same items', '所有人是否排序同一组对象')],
        [p('Shared rater matrix', '共同评分矩阵'), 'ICC(2,1) / ICC(2,k)', p('Complete overlap and retained raters/stimuli', '完整重叠以及保留的评分者／材料')],
        [p('Spatial marks', '空间标注'), p('Overlays and evaluative maps', '叠加图与评价地图'), p('Base map, label and denominator', '底图、标签与分母')],
      ]) }),
      s('select', p('Q-score or TrueSkill?', 'Q-score 还是 TrueSkill？'), [
        p('When adapting a paper, start with its documented method and explicitly report departures. For a new study, decide whether a direct opponent-adjusted score, a sequential latent-rating model, or a simple choice share answers the question. There is no universal winner; evaluate the design and sensitivity to assumptions.', '改编论文时，先从原文记载的方法出发，明确报告偏离。新研究则需要判断：直接的对手校正分数、顺序更新的潜在评分模型，还是简单选择比例更能回答问题。不存在通用最优方法，应结合设计和假设敏感性评估。'),
        p('A model fit to perception scores, such as an image predictor or spatial regression, remains a separate step. Export stable media IDs and avoid treating many dependent comparisons from one participant as independent participants.', '感知分数之后的图像预测器或空间回归仍是独立步骤。导出稳定媒体 ID，并避免把同一参与者的多个相关比较当作多个独立参与者。'),
      ]),
    ], related: ['q-score', 'trueskill', 'icc', 'quality-reliability', 'results-export'],
  },
  {
    id: 'quality-reliability', group: 'analysis', title: p('Coverage, quality & reliability', '覆盖量、质量与可靠性'),
    summary: p('Check what was observed, who contributed, and whether rankings or ratings are sufficiently stable.', '检查实际观测、参与者贡献，以及排序或评分是否足够稳定。'),
    sections: [
      s('coverage', p('Begin with denominators', '先明确分母'), [
        p('Inspect participants, answered trials, image appearances and per-image comparisons separately. An unscored image can be under-covered rather than poorly rated. A high total response count can hide images with very few observations.', '分别检查人数、已答轮次、图片出现次数与每图比较次数。没有分数的图片可能只是覆盖不足，并不是评价差。很大的总回答数也可能掩盖部分图片观测很少的问题。'),
        p('Coverage indicators under the ranking are diagnostics, not guarantees of adequate sample size. Study-specific thresholds from a paper do not automatically transfer to a different population, image set or task.', '排名下面的覆盖指标是诊断，不保证样本量充分。某篇论文中的阈值不会自动适用于不同人群、图片集或任务。'),
      ]),
      s('reliability', p('Ask which kind of consistency matters', '明确需要哪种一致性'), [
        p('Retest checks compare repeated answers under comparable conditions. Split-half checks ask whether two portions of the observations yield similar rankings. Inter-rater agreement asks whether different raters evaluate shared stimuli consistently. These answer different questions; none establishes construct validity on its own.', '重测检查比较可比条件下的重复回答；分半检查考察两部分观测是否形成相似排序；评分者一致性考察不同人对共同材料的评价是否接近。它们回答不同问题，都不能单独证明概念效度。'),
        p('The platform’s ICC(2,1) and ICC(2,k) use a complete stimulus-by-rater matrix selected from the available observations. Report the retained matrix and any loss of coverage. Repeated answers or incomplete overlap require more care than a single headline coefficient. The ICC page gives the formulas and the rule used to build that matrix.', '平台的 ICC(2,1) 和 ICC(2,k) 使用从可用观测中选出的完整“材料 × 评分者”矩阵。应报告保留矩阵及覆盖损失。重复回答或重叠不完整的情况，不能只看一个系数。ICC 页面给出计算公式，以及平台如何构成这个矩阵。'),
      ]),
      s('exclusions', p('Make quality decisions reproducible', '让质量决策可复现'), [
        p('Preview and researcher practice are useful for testing; silicon responses are model-generated pretests. Keep these sources identifiable. Flags such as repeated same-side choices are signals to review, not automatic proof that a participant is invalid.', '预览与研究者试答用于测试；silicon 回答是模型生成的预试数据。应保持来源可辨认。连续选择同一侧等标记是待检查信号，不自动证明参与者无效。'),
        p('If applying a screen such as median absolute deviation, define its threshold and unit before interpreting results. Export counts before and after exclusions and preserve raw records. A zero, false or unused allocation budget can be valid data rather than a missing answer.', '采用中位数绝对偏差等筛选时，应先定义阈值和作用单位，再解释结果。导出排除前后的数量，并保留原始记录。零、false 或未花完的分配预算都可能是有效数据，不一定是缺失。'),
      ]),
    ], related: ['icc', 'media-sampling', 'choosing-analysis', 'results-export', '2009-ewing-measuring'],
  },
  {
    id: 'platform-workflow', group: 'platform', title: p('Build, preview & release', '搭建、预览与发布问卷'),
    summary: p('A complete SP-Survey workflow, including the distinction between a draft, a release and a template.', '完整的 SP-Survey 流程，以及草稿、发布版本和模板的区别。'),
    flow: [p('Create a project', '创建项目'), p('Media + instrument', '媒体与问卷'), p('Preview + pilot', '预览与试答'), p('Release + collect', '发布与收集')],
    sections: [
      s('build', p('Start with a project and real materials', '从项目与实际材料开始'), [
        p('Create a project manually or from the template library. Load study media, set up folders or matched sets, and review every question’s wording, required status, answer scale and trial count. A template is a starting instrument that still needs study-specific decisions.', '手动创建项目或从模板库开始。载入研究媒体，配置文件夹或匹配组，检查每题措辞、必答状态、量表与轮次。模板是起始工具，仍需要研究层面的具体决策。'),
        p('Use participant preview to verify layout and interactions on desktop and mobile. Then use an identifiable practice or pilot workflow to inspect actual answer structure and exports. In Docs, the one-question examples run in an isolated preview and do not save answers.', '使用参与者预览检查桌面与手机的布局和交互，再通过可识别的试答或小规模试测流程检查答案结构与导出。Docs 的单题示例在独立预览中运行，不保存答案。'),
      ]),
      s('release', p('Know which action changes what', '明确不同操作改变什么'), [
        p('For a version-managed project, saving changes the draft; releasing updates the participant version and snapshots its media manifest. Legacy projects can remain live-on-save until the first release enables version management. Check the project’s mode before changing a running instrument.', '启用版本管理的项目中，保存只更新草稿；发布才更新参与者版本，并快照媒体清单。旧项目在首次发布启用版本管理之前，可能仍然保存即生效。修改正在收集的问卷前，应检查项目模式。'),
      ], { table: table([p('Action', '操作'), p('Purpose', '作用')], [
        [p('Save draft', '保存草稿'), p('Continue editing; version-managed participant pages keep the released version', '继续编辑；版本管理下参与者仍看已发布版本')],
        [p('Release / survey_publish', '发布版本 / survey_publish'), p('Update participant content and record a version + media snapshot', '更新参与者内容，并记录版本与媒体快照')],
        [p('Save as Template', '保存为模板'), p('Create a reusable design', '创建可复用设计')],
        [p('Publish to Main Page', '发布到主页'), p('Control public listing; separate from releasing a participant version', '控制公开展示，与发布参与者版本分开')],
      ]) }),
      s('collect', p('Keep collection and changes traceable', '让收集与修改可追溯'), [
        p('After release, share the participant URL or QR code and check incoming data coverage. When the design changes, retain the revision used for each response and analyze compatible versions intentionally. Record your wording and settings changes in the research methods.', '发布后分享参与者链接或二维码，并检查进入数据的覆盖。设计改变时，保留每份回答使用的版本，有意识地选择兼容版本分析。方法报告中记录题干和设置变化。'),
      ]),
    ], related: ['study-design', 'media-sampling', 'results-export', 'paper-templates', 'common-questions'],
  },
  {
    id: 'results-export', group: 'platform', title: p('Results, exports & reproducibility', '结果、导出与可复现性'),
    summary: p('Freeze the analysis scope and carry raw answers, media identities and method settings into the export.', '明确分析范围，让原始回答、媒体身份与方法设置一起进入导出。'),
    sections: [
      s('scope', p('Define the data you are analyzing', '明确正在分析哪批数据'), [
        p('Check the data source, survey revision, dates and quality exclusions before reading charts. Human responses, researcher practice and silicon pretests have different meanings. Changing a filter changes the analysis population and may change every derived score.', '阅读图表前检查数据来源、问卷版本、日期与质量排除。人类回答、研究者试答和 silicon 预试具有不同含义。改变筛选条件会改变分析样本，也可能改变全部派生分数。'),
        p('For typed summaries and exports, use the recorded question contract for the chosen revision. Current draft scales or Skill schemas need not match historical answers. Records without a saved contract require manual verification.', '有类型的汇总和导出应使用所选版本记录的题目协议。当前草稿中的量表或 Skill 结构不一定匹配历史答案；没有保存协议的旧记录需要人工核对。'),
      ]),
      s('formats', p('Choose an export for the next task', '按下一步任务选择导出'), [
        p('Preserve raw data as well as summaries. Long tables help inspect trial-level comparisons; image-level score tables help join external features. Always retain identifiers and check the documented row unit before combining files.', '同时保留原始数据和汇总。长表便于检查逐轮比较，图片层级分数表便于连接外部特征。合并文件前保留标识符，并核对每行代表什么单位。'),
      ], { table: table([p('Export', '导出'), p('Use', '用途')], [
        ['JSON', p('Raw answer structures and metadata', '原始答案结构与元数据')],
        ['Wide CSV', p('Inspect submissions in a broad table', '按提交检查宽表')],
        ['Long CSV', p('Trial/answer units for further processing', '供进一步处理的轮次／回答单元')],
        ['Summary CSV', p('Question-level derived tables', '按题派生的结果表')],
        ['Analysis bundle', p('Raw data, tables, quality checks, methods, manifest and data dictionary', '原始数据、结果表、质量检查、方法、清单与数据字典')],
      ]) }),
      s('report', p('Keep a reproducible methods record', '保留可复现的方法记录'), [
        p('Record the study revision, stimulus identities, filters, answer direction, method, tie handling, thresholds, scaling and algorithm version. The bundle’s analysis plan describes exported filters and submissions; it is not a preregistration.', '记录研究版本、刺激材料身份、筛选条件、回答方向、方法、平局处理、阈值、缩放和算法版本。分析包中的 analysis plan 描述导出筛选与提交记录，不是预注册。'),
        p('An AI explanation can help read the computed results, but it does not change the evidence or turn an exploratory association into a causal result. For spatial models, image prediction or other external analysis, keep the same media IDs and report the additional procedures.', 'AI 解释可以帮助阅读已计算结果，但不改变证据，也不会把探索性关联变成因果结论。空间模型、图像预测等外部分析应保留同一媒体 ID，并另行报告方法。'),
      ]),
    ], related: ['choosing-analysis', 'quality-reliability', 'platform-workflow', 'skills-agents'],
  },
  {
    id: 'skills-agents', group: 'platform', title: p('AI assistance, Skills & integrations', 'AI 辅助、Skills 与集成'),
    summary: p('Use an assistant to draft an instrument while preserving typed answers, review and a deliberate release.', '用助手起草问卷，同时保留明确的答案类型、检查流程与正式发布步骤。'),
    sections: [
      s('assistant', p('Describe the research, not only the appearance', '向助手描述研究任务'), [
        p('Tell the assistant the concept, population, media, question family, number of trials and intended analysis. Review its wording and assumptions in the editor, then test the participant view. Generated questions and simulated responses do not validate a measurement instrument.', '告诉助手研究概念、人群、媒体、题型、轮次与预期分析。到编辑器检查措辞和假设，再测试参与者视角。生成的题目或模拟回答不构成测量工具的验证。'),
      ], { callout: p('Example brief: Compare two street images for perceived safety; allow Equal; preserve media IDs; provide per-image Q-scores and comparison counts. Use my project media and leave the result as a draft for review.', '示例任务：比较两张街景的安全感，允许相等；保留媒体 ID；输出每图 Q-score 和比较次数。使用我的项目媒体，并将结果保留为草稿供检查。') }),
      s('skills', p('A custom interaction still needs a defined answer', '自定义交互仍需明确答案'), [
        p('Prefer a native question or an existing Skill preset when it matches the task. A custom Skill must map to a supported native analysis/export family. New custom revisions use one typed result field and a matching object example; unsupported generic JSON is not a substitute for a measurement definition.', '任务匹配时，优先使用原生题型或现有 Skill 预设。自定义 Skill 应对应受支持的原生分析／导出类型。新的自定义版本使用一个有类型的结果字段及匹配的对象示例，不能用任意 JSON 代替测量定义。'),
        p('For developers: save the Skill, reference its skillId on the question, and send an answer using SPSkill.setAnswer(object). A rating field needs explicit bounds; an allocation needs its budget; annotations need a declared geometry family. Try valid, missing and out-of-range answers before use.', '开发者实现时：保存 Skill，在题目上引用 skillId，通过 SPSkill.setAnswer(object) 提交答案。评分字段需要上下界，分配题需要预算，标注需要明确几何类型。使用前测试有效、缺失和越界答案。'),
      ]),
      s('integrations', p('Connect an external agent', '连接外部代理'), [
        p('Use Admin → Integrations to authorize the remote MCP / Agent API. Start with survey_capabilities and survey_get_draft; retain draftUpdatedAt and pass expectedDraftUpdatedAt when saving operations. Prefer small survey_apply_operations changes so concurrent edits can be detected.', '通过后台 Integrations 授权远程 MCP／Agent API。先调用 survey_capabilities 和 survey_get_draft，保留 draftUpdatedAt，并在保存操作时传入 expectedDraftUpdatedAt。优先使用小范围 survey_apply_operations，以检测并发编辑。'),
        p('Inspect media and use existing project/template materials. Results access requires the results scope. For a version-managed project, the agent’s draft save is separate from survey_publish(confirm: true), which creates the participant release. Secrets belong in the integration settings, not in survey questions or exported answers.', '检查媒体，使用已有项目或模板材料。读取结果需要对应权限。版本管理项目中，代理保存草稿与 survey_publish(confirm: true) 创建参与者发布版本是不同动作。密钥应留在集成设置中，不放进题干或导出答案。'),
      ]),
    ], related: ['question-types', 'platform-workflow', 'results-export'],
  },
  {
    id: 'common-questions', group: 'platform', title: p('Common questions', '常见问题'),
    summary: p('Where a hosted survey’s data lives, how long it stays available, and the first choices a researcher makes in the workspace.', '托管问卷的数据存在哪里、会保留多久，以及研究者在工作区里最先会遇到的选择。'),
    flow: [p('Store the study', '数据放在哪里'), p('Build without extras', '不必先开额外功能'), p('Preview, then release', '先看清，再发布'), p('Share a short link', '用短链接分享'), p('Read the results', '查看结果')],
    sections: [
      s('where', p('Where does the data live?', '数据存在哪里？'), [
        p('The hosted website runs on Cloudflare. Survey designs and participant responses are stored in the project Supabase database. Media files, such as images and video, are stored in Cloudflare R2.', '托管网站运行在 Cloudflare 上。问卷设计和参与者的回答保存在项目的 Supabase 数据库中。图片、视频等媒体文件保存在 Cloudflare R2。'),
      ]),
      s('retention', p('How long do a survey and its results stay up?', '问卷和结果会保留多久？'), [
        p('There is no automatic expiry. A survey and its results stay up until the owner unpublishes the survey or deletes the project. A time window on a public Live surveys listing can close that public card. It does not delete the project or the responses already stored.', '平台没有自动到期时间。问卷和结果会一直保留，直到所有者取消发布或删除该项目。「在线调查」上的展示时段可以让那张公开卡片结束展示，但不会删除项目，也不会删除已经保存的答卷。'),
      ]),
      s('without-ai', p('Do I need AI to build a survey?', '必须用 AI 才能做问卷吗？'), [
        p('No. Add pages and questions yourself in the builder. The in-browser Assistant can draft or edit a survey, and you can turn it off in Assistant settings so its sidebar is hidden. You can release a survey without using it.', '不需要。在问卷编辑器里自己添加页面和题目即可。浏览器内助手可以起草或修改问卷；也可以在助手设置里关掉它，侧栏就会隐藏。不使用助手也可以发布问卷。'),
      ]),
      s('live-page', p('How does a survey get onto Live surveys?', '问卷怎样出现在「在线调查」？'), [
        p('The share link is separate from the public Live surveys page. From the project menu, choose Publish to Main Page, write a short public description, and set the online window. The listing stays pending until an administrator approves it. While that approved window is open, the card appears on Live surveys.', '分享链接和公开的「在线调查」页面是两件事。在项目菜单里选择「发布到主页」，填写简短的公开说明并设置展示时段。申请会保持待审核，直到管理员通过。在已通过的时段内，卡片会出现在「在线调查」。'),
        p('A project that was never listed stays available from its share link, without that window. If a project does have an approved listing, participants can open it only during the approved window. Ending the window closes the public card. It is not a date on which the platform deletes the survey.', '从未申请上架的项目，仍可通过分享链接打开，不受该时段限制。已经有通过审核的上架记录时，参与者只能在核准时段内打开。时段结束会关闭这张公开卡片，并不是平台按日期删除问卷。'),
      ]),
      s('custom-link', p('Can I use a short public link?', '可以用一个简短的公开链接吗？'), [
        p('On the Share tab, Custom link saves a short address, https://sp-survey.org/s/{slug}, using a name you choose. The original project link, /survey?project={id}, still opens the same survey.', '在「分享」页，「自定义链接」会保存一个简短地址 https://sp-survey.org/s/{slug}，名称由你设定。原来的项目链接 /survey?project={id} 仍然打开同一份问卷。'),
        p('The name is 2–40 characters: lowercase letters, digits, and single hyphens. Names such as admin, api, s, survey, and login are reserved, and a name already used by another survey is rejected.', '名称长度为 2–40 个字符，使用小写字母、数字和单个连字符。admin、api、s、survey、login 是保留名称；已被其他问卷使用的名称也会被拒绝。'),
      ]),
      s('street-level', p('Where do street-level images download?', '街景图片在哪里下载？'), [
        p('Street-level imagery is downloaded by a small helper on your own computer. You pick points on the map in SP-Survey, or paste Street View URLs, and the helper on that computer fetches the views. Cloudflare does not download them for you. After the download finishes, the files can be added to this project’s media library.', '街景图片由你自己电脑上的一个小工具下载。在 SP-Survey 里选地图上的点，或粘贴街景网址，然后由这台电脑上的工具去获取画面。Cloudflare 不会替你下载。下载完成后，这些文件可以加入本项目的媒体库。'),
      ]),
      s('preview', p('Where do I check layout, and where do I try a question?', '在哪里看版式，在哪里试一道题？'), [
        p('Layout Studio arranges the whole survey: pages, cards, spacing and text styles. It does not record answers. While you edit one question, open Participant preview in the question editor to see that question as a participant would. The top-bar Preview Survey shows the whole survey. Practice is where you answer and inspect what was recorded.', '版式工作台用来安排整份问卷：页面、卡片、间距和文字样式。它不记录回答。编辑某一道题时，在题目编辑器里打开「参与者预览」，查看参与者会看到的这一题。顶部的「预览问卷」展示整份问卷。「试填」用来亲自作答，并查看记录下来的内容。'),
      ]),
      s('home', p('Can I open the public home without signing out?', '不退出登录也能打开公开首页吗？'), [
        p('Yes. In the workspace toolbar, Main page opens the public home and keeps you signed in. On public pages, the header shows Open workspace instead of asking you to sign in again.', '可以。工作区顶部的「首页」会打开公开主页，同时保持登录。在公开页面上，页眉显示「进入工作区」，不会再要求你重新登录。'),
      ]),
      s('back', p('What does the browser Back button do while I am building?', '搭建问卷时，浏览器的返回按钮会怎样？'), [
        p('Moving between workspace steps is remembered in the browser history, and the address stays on the workspace. Back returns to the previous step, such as from Builder to Dataset, instead of leaving on the first press. After those recorded steps are gone, another Back can leave the workspace.', '在工作区各步骤之间移动时，浏览器会记住这些步骤，地址仍留在工作区。按返回会回到上一步，例如从「设计」回到「媒体」，而不是第一次就离开。这些已记录的步骤走完之后，再按一次返回才会离开工作区。'),
      ]),
      s('counts', p('Where do I see the response count and how long collection has run?', '在哪里看答卷数量，以及收集进行了多久？'), [
        p('While a project is open, the top bar under the project name shows how long the survey has been up and how many answers are stored. After a release, that line reads “Published N days ago · N answers”. A newer survey says minutes or hours ago, or just now. If the survey has no publish time, the same line starts with Created and uses when the project was created. Results still shows Total Responses and the dates of the stored responses.', '打开一个项目时，项目名称下方的顶栏会显示问卷已上线多久，以及已保存多少份回答。发布之后，这一行写作「已发布 N 天前 · N 份回答」。更近的问卷会写成多少分钟前、多少小时前，或刚刚。如果还没有发布时间，同一行会以「创建于」开头，并使用项目的创建时间。结果页仍会显示答卷总数和这些答卷的日期。'),
      ]),
      s('templates', p('What is the difference between templates and My Projects?', '模板和「我的项目」有什么区别？'), [
        p('Project Templates are example designs you can start from, including surveys used in published research. My Projects lists the projects on your own account. Starting from a template creates your project. It does not change the shared template.', '「项目模板」是可以拿来起步的示例设计，包括已发表研究里用过的问卷。「我的项目」列出你自己账号下的项目。从模板开始会创建你的项目，不会改动那个共享模板。'),
      ]),
    ], related: ['platform-workflow', 'results-export', 'skills-agents', 'media-sampling'],
  },
];
export const docTopic = id => DOC_TOPICS.find(topic => topic.id === id) || null;

const localText = (value, language) => typeof value === 'string' ? value : value?.[language === 'zh' ? 'zh' : 'en'] || '';
const normalized = text => String(text).toLowerCase().replace(/[‐‑–—_-]/g, ' ').replace(/\s+/g, ' ').trim();
export function topicMatches(topic, query) {
  const tokens = normalized(query).split(' ').filter(Boolean);
  const content = normalized(JSON.stringify([topic.id, topic.title, topic.summary, topic.sections]));
  return tokens.every(token => content.includes(token));
}
export function topicSectionText(topic, language) {
  return topic.sections.map(section => [localText(section.title, language), ...section.paragraphs.map(p => localText(p, language))].join(' ')).join(' ');
}
