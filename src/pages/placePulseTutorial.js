/** Place Pulse 1.0 tutorial, from Salesses, Schechtner & Hidalgo (2013), PLOS ONE. */

const PAPER = {
  doi: 'https://doi.org/10.1371/journal.pone.0068400',
  templateId: '2013-salesses-collaborative',
};

export const placePulseTutorial = {
  en: {
    ...PAPER,
    kicker: 'Tutorial',
    title: 'Place Pulse 1.0',
    subtitle: 'From what the study measured, to the questions participants answered, to the score.',
    cite: 'Salesses, Schechtner & Hidalgo (2013). The collaborative image of the city. PLOS ONE.',
    open: 'Open the tutorial',
    useTemplate: 'Sign in to use this template',
    steps: [
      {
        id: 'concepts',
        label: '1. What to measure',
        title: 'Three perceptions, compared across cities',
        body: 'The study asks how safe, upper-class, and unique a place looks, then compares how wide those perceptions spread in each city. New York and Boston spanned a wider range than Linz and Salzburg.',
        points: [
          'Which place looks safer?',
          'Which place looks more upper-class?',
          'Which place looks more unique?',
        ],
        note: 'The wording is “which place looks…”, because that is what a photo can show. Participants were not told where the photo was taken.',
      },
      {
        id: 'design',
        label: '2. Survey design',
        title: 'Two photos, one click',
        body: 'Each trial shows two street images side by side. The participant clicks the one that fits the question, or marks them equal. The same three questions are asked of images from New York (1,706), Boston (1,236), Salzburg (544) and Linz (650).',
        points: [
          '4,136 images in total. New York and Boston came from Google Street View; Linz and Salzburg were photographed on site.',
          '7,872 people from 91 countries cast 208,738 votes. Age and gender were asked after five clicks.',
          'In this template each question is 10 pairs, with an Equal button. Upload images into the folders New_York, Boston, Linz and Salzburg.',
        ],
      },
      {
        id: 'analysis',
        label: '3. Score',
        title: 'Q-score, from 0 to 10',
        body: 'An image’s score is how often it was chosen, adjusted for the strength of the images it was compared with. A win against a highly rated image counts for more. Ties count as shown, not as a win. The result is scaled to 0–10.',
        points: [
          'The paper finds that about 22 to 32 comparisons per image are needed before the ranking stabilises.',
          'In Results, each comparison question starts on TrueSkill. Set Score to Q-score and Scale to 0–10 when you want the method this template recommends.',
          'TrueSkill is also available there, for comparison. It is not the score used in the 2013 paper.',
        ],
      },
    ],
    gapsTitle: 'Where this template differs from the paper',
    gaps: [
      'The website let people keep voting. This template asks 10 pairs per question.',
      'The paper asked age and gender after five clicks. This template does not.',
      'The paper’s stable ranking needs about 22–32 comparisons per image. The results panel starts at 4. Raise that cutoff when you reproduce the study.',
    ],
  },
  zh: {
    ...PAPER,
    kicker: '教程',
    title: 'Place Pulse 1.0',
    subtitle: '从研究要测什么，到参与者回答的题目，再到最后的分数。',
    cite: 'Salesses, Schechtner 与 Hidalgo（2013）。The collaborative image of the city. PLOS ONE.',
    open: '打开教程',
    useTemplate: '登录后使用这个模板',
    steps: [
      {
        id: 'concepts',
        label: '1. 感知概念',
        title: '三个感知，在城市之间比较',
        body: '这项研究问一个地方看起来是否更安全、更高档、更独特，再比较每个城市里这些感知拉开的幅度。纽约和波士顿比林茨和萨尔茨堡更宽。',
        points: [
          '哪个地方看起来更安全？',
          '哪个地方看起来更高档？',
          '哪个地方看起来更独特？',
        ],
        note: '问法是“看起来……”，因为照片只能支持这种判断。作答时不告诉参与者照片拍自哪里。',
      },
      {
        id: 'design',
        label: '2. 问卷设计',
        title: '两张照片，点一下',
        body: '每一轮并排显示两张街景。参与者点选更符合问题的那张，或标为相等。同样的三个问题用于纽约（1,706 张）、波士顿（1,236 张）、萨尔茨堡（544 张）和林茨（650 张）。',
        points: [
          '共 4,136 张图。纽约和波士顿来自 Google 街景；林茨和萨尔茨堡是实地拍摄。',
          '来自 91 个国家的 7,872 人投了 208,738 票。点过五次后询问年龄和性别。',
          '本模板每题 10 对，并有 Equal。请把图片上传到 New_York、Boston、Linz、Salzburg 四个文件夹。',
        ],
      },
      {
        id: 'analysis',
        label: '3. 分析',
        title: 'Q-score，0 到 10',
        body: '一张图的分数是它被选中的比例，再按与它比较过的那些图的强弱做校正。赢过高分图片，加分更多。平局只计入出现次数，不算赢。最后缩放到 0–10。',
        points: [
          '论文认为，每张图大约需要 22 到 32 次比较，排序才稳定。',
          '结果里每道比较题先显示 TrueSkill。需要本模板推荐的方法时，把计分方法选成 Q-score，缩放选 0–10。',
          '那里也可以看 TrueSkill，仅供对照。它不是 2013 年这篇论文使用的分数。',
        ],
      },
    ],
    gapsTitle: '这个模板和论文的差别',
    gaps: [
      '原网站可以一直投票。本模板每题只问 10 对。',
      '论文在五次点击后询问年龄和性别。本模板没有这两题。',
      '论文里稳定的排序大约需要每张图 22–32 次比较。结果面板默认从 4 次起算。要复现研究时，请把这个下限调高。',
    ],
  },
};

export function tutorialCopy(language) {
  return language === 'zh' ? placePulseTutorial.zh : placePulseTutorial.en;
}
