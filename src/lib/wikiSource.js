import { DOC_TOPICS, docTopic } from '../pages/docsTopics';
import { PAPER_TEMPLATE_DOCS, paperTemplateDoc } from '../pages/paperTemplateDocs';
import { RESEARCH_GUIDES, GUIDE_SECTIONS, guideText } from '../pages/researchGuides';
const t = (v, language) => typeof v === 'string' ? v : guideText(v, language);
const cell = (v, language) => t(v, language).replace(/\|/g, '\\|').replace(/\n/g, ' ');
export const wikiDocuments = language => [
  ...DOC_TOPICS.map(d => ({ key: d.id, title: t(d.title, language) })),
  ...PAPER_TEMPLATE_DOCS.map(d => ({ key: d.id, title: `${d.shortCitation} · ${d.name}` })),
];
/** Editable editorial text. Interactive previews, live settings and calculations stay in React. */
export function builtinWikiSource(key, language = 'en') {
  const topic = docTopic(key); const paper = paperTemplateDoc(key); const guide = RESEARCH_GUIDES[key];
  if (topic) {
    const body = topic.sections.map(s => {
      let text = `## ${t(s.title, language)}\n\n${s.paragraphs.map(p => t(p, language)).join('\n\n')}`;
      if (s.table) text += `\n\n| ${s.table.headers.map(h => cell(h, language)).join(' | ')} |\n| ${s.table.headers.map(() => '---').join(' | ')} |\n${s.table.rows.map(row => `| ${row.map(c => cell(c, language)).join(' | ')} |`).join('\n')}`;
      if (s.formula) text += `\n\n${t(s.formula, language)}`;
      if (s.callout) text += `\n\n> ${t(s.callout, language)}`;
      return text;
    }).join('\n\n');
    return { title: t(topic.title, language), summary: t(topic.summary, language), body: body + (topic.references ? '\n\n## References\n\n' + topic.references.map(r => `- [${t(r.label, language)}](${r.url})`).join('\n') : ''), revision: 0 };
  }
  if (paper) return {
    title: paper.name, summary: guide ? guideText(guide.subtitle, language) : paper.shortCitation, revision: 0,
    body: guide ? GUIDE_SECTIONS.map(([id, label]) => `## ${guideText(label, language)}\n\n${guide[id].map(p => guideText(p, language)).join('\n\n')}${id === 'concepts' ? '\n\n' + guide.dimensions.map(([name, text]) => `### ${guideText(name, language)}\n\n${guideText(text, language)}`).join('\n\n') : ''}`).join('\n\n') : (language === 'zh' ? `## 研究概念\n\n请补充本文的研究问题与感知概念。\n\n## 问卷设计与平台实现\n\n请解释题型、材料、抽样和模板设置。\n\n## 分析与解释\n\n请说明分析方法及其适用范围。\n\n## 与原文的差异\n\n请明确模板改编的差异。` : '## Research concepts\n\nDescribe the research question and constructs.\n\n## Survey design and implementation\n\nExplain questions, media, sampling and template settings.\n\n## Analysis and interpretation\n\nExplain the methods and their limits.\n\n## Departures from the paper\n\nDocument adaptations from the original study.'),
  };
  return null;
}
export function sameWikiContent(a, b) { return ['title', 'summary', 'body'].every(key => (a?.[key] || '') === (b?.[key] || '')); }
