import React from 'react';
import { Box, Button, Stack, Table, TableBody, TableCell, TableHead, TableRow, Typography } from '@mui/material';
import { Link as RouterLink } from 'react-router-dom';
import { DOC_GROUPS, docTopic } from '../../pages/docsTopics';
import { PAPER_TEMPLATE_DOCS } from '../../pages/paperTemplateDocs';
import { RESEARCH_GUIDES } from '../../pages/researchGuides';
import IccLab from './IccLab';
import ScoringLab from './ScoringLab';
export const textOf = (value, language) => typeof value === 'string' ? value : value?.[language === 'zh' ? 'zh' : 'en'] || '';
export function TopicLab({ topic, language }) {
  if (topic?.lab === 'icc') return <IccLab language={language} />;
  if (topic?.lab) return <ScoringLab language={language} />;
  return null;
}
export const cardStyle = { p: 2.5, bgcolor: 'background.paper', border: 1, borderColor: 'divider', borderRadius: 2, color: 'text.primary', textDecoration: 'none', minWidth: 0, '&:hover': { borderColor: 'primary.main' } };
export function RelatedDocs({ ids, language }) {
  const zh = language === 'zh';
  return <Box sx={{ mt: 4, pt: 3, borderTop: 1, borderColor: 'divider' }}>
    <Typography component="h2" variant="h6" fontWeight={700}>{zh ? '继续阅读' : 'Continue reading'}</Typography>
    <Stack direction="row" flexWrap="wrap" gap={1} sx={{ mt: 1 }}>{ids.map(id => <Button key={id} component={RouterLink} to={`/docs/${id}`}>{textOf(docTopic(id)?.title, language) || PAPER_TEMPLATE_DOCS.find(d => d.id === id)?.name || (zh ? '论文案例与模板' : 'Paper cases & templates')} →</Button>)}</Stack>
  </Box>;
}
export function CaseGallery({ language, ids = Object.keys(RESEARCH_GUIDES) }) {
  const zh = language === 'zh';
  return <Box sx={{ display: 'grid', gridTemplateColumns: { xs: '1fr', sm: '1fr 1fr' }, gap: 2, my: 2 }}>
    {ids.map(id => { const g = RESEARCH_GUIDES[id]; const doc = PAPER_TEMPLATE_DOCS.find(d => d.id === id); return <Box key={id} component={RouterLink} to={`/docs/${id}`} sx={{ ...cardStyle, p: 0, overflow: 'hidden' }}>
      <Box component="img" src={id === '1990-nasar-evaluative' ? '/project_templates/1990-nasar-evaluative-cover.svg' : id === '2009-ewing-measuring' ? '/docs/research/2009-ewing-measuring-scene-a.png' : `/docs/research/${id}-preview.png`} alt={`${textOf(g.method, language)} · ${zh ? '问卷示意图' : 'Survey schematic'}`} loading="lazy" sx={{ display: 'block', width: '100%', height: 190, objectFit: 'cover', objectPosition: id === '2009-ewing-measuring' ? 'center 46%' : 'center', borderBottom: 1, borderColor: 'divider' }} />
      <Box sx={{ p: 2 }}><Typography variant="overline" color="text.secondary">{textOf(g.method, language)}</Typography><Typography component="h3" variant="h6" fontWeight={700}>{doc.name}</Typography><Typography variant="body2" color="text.secondary" sx={{ mt: 1, lineHeight: 1.8 }}>{textOf(g.subtitle, language)}</Typography><Typography variant="body2" sx={{ mt: 1.5 }}>{zh ? '阅读案例与试答 →' : 'Read the case & try it →'}</Typography></Box>
    </Box>; })}
  </Box>;
}
export function DocFlow({ items, language }) {
  return <Box component="ol" sx={{ listStyle: 'none', p: 0, my: 3, display: 'grid', gridTemplateColumns: { xs: '1fr 1fr', sm: `repeat(${items.length}, 1fr)` }, gap: 1 }}>{items.map((item, i) => <Box component="li" key={i} sx={{ p: 2, border: 1, borderColor: 'divider', borderRadius: 2, bgcolor: 'background.paper' }}><Typography variant="caption" color="text.secondary">0{i + 1}{i < items.length - 1 ? ' →' : ''}</Typography><Typography variant="body2" fontWeight={600} sx={{ mt: 1 }}>{textOf(item, language)}</Typography></Box>)}</Box>;
}
export default function DocsTopicArticle({ topic, language }) {
  const zh = language === 'zh';
  return <>
    <Typography variant="overline" color="text.secondary">{textOf(DOC_GROUPS.find(g => g.id === topic.group)?.title, language)}</Typography>
    <Typography component="h1" sx={{ fontSize: { xs: 30, md: 44 }, fontWeight: 800, letterSpacing: '-.035em', lineHeight: 1.2, mt: 1, mb: 2 }}>{textOf(topic.title, language)}</Typography>
    <Typography sx={{ fontSize: 18, lineHeight: 1.8, color: 'text.secondary', mb: 3 }}>{textOf(topic.summary, language)}</Typography>
    {topic.flow && <DocFlow items={topic.flow} language={language} />}
    <Box component="nav" aria-label={zh ? '本篇目录' : 'On this page'} sx={{ display: 'flex', flexWrap: 'wrap', gap: 1 }}>{topic.sections.map((s, i) => <Button key={s.id} component="a" href={`#${s.id}`} size="small" sx={{ color: 'text.secondary' }}>{i + 1}. {textOf(s.title, language)}</Button>)}{topic.lab && <Button component="a" href="#scoring-lab" size="small">{zh ? '交互实验台' : 'Interactive lab'}</Button>}</Box>
    {topic.sections.map((s, i) => <Box component="section" key={s.id} id={s.id} sx={{ scrollMarginTop: 96, borderTop: 1, borderColor: 'divider', pt: 3, mt: 3 }}>
      <Typography variant="overline" color="text.secondary">0{i + 1}</Typography>
      <Typography component="h2" variant="h5" fontWeight={700} sx={{ mb: 2 }}>{textOf(s.title, language)}</Typography>
      {s.paragraphs.map((p, j) => <Typography key={j} sx={{ lineHeight: 1.9, mb: 1.75 }}>{textOf(p, language)}</Typography>)}
      {s.formula && <Box sx={{ p: 2.5, my: 2, bgcolor: 'background.paper', border: 1, borderColor: 'divider', borderRadius: 2, overflowX: 'auto' }}><Typography component="code" sx={{ whiteSpace: 'pre-wrap', overflowWrap: 'anywhere' }}>{textOf(s.formula, language)}</Typography></Box>}
      {s.table && <Box sx={{ overflowX: 'auto', my: 2, border: 1, borderColor: 'divider', borderRadius: 2, bgcolor: 'background.paper' }}><Table size="small" aria-label={textOf(s.title, language)}><TableHead><TableRow>{s.table.headers.map((h, j) => <TableCell key={j} sx={{ fontWeight: 700 }}>{textOf(h, language)}</TableCell>)}</TableRow></TableHead><TableBody>{s.table.rows.map((row, j) => <TableRow key={j}>{row.map((cell, k) => <TableCell key={k} sx={{ minWidth: 145, lineHeight: 1.8, overflowWrap: 'anywhere' }}>{textOf(cell, language)}</TableCell>)}</TableRow>)}</TableBody></Table></Box>}
      {s.callout && <Box sx={{ p: 2, borderLeft: 3, borderColor: 'text.secondary', bgcolor: 'background.paper', my: 2 }}><Typography variant="body2" sx={{ lineHeight: 1.8 }}>{textOf(s.callout, language)}</Typography></Box>}
    </Box>)}
    {topic.gallery && <><Typography component="h2" variant="h5" fontWeight={700} sx={{ mt: 4 }}>{zh ? '看真实题型，试答案例' : 'See real questions, try the cases'}</Typography><Typography variant="body2" color="text.secondary" sx={{ mt: 1 }}>{zh ? '截图由平台参与者渲染器生成，使用教程演示素材；各案例内可打开交互预览。' : 'Screenshots use the platform participant renderer with demonstration media. Each case includes an interactive preview.'}</Typography><CaseGallery language={language} /></>}
    <TopicLab topic={topic} language={language} />
    {topic.references && <Box sx={{ mt: 4 }}><Typography component="h2" variant="h6">{zh ? '参考文献与延伸阅读' : 'References & further reading'}</Typography>{topic.references.map(ref => <Typography key={ref.url} variant="body2" sx={{ mt: 1 }}><Box component="a" href={ref.url} target="_blank" rel="noopener noreferrer">{textOf(ref.label, language)} ↗</Box></Typography>)}</Box>}
    <RelatedDocs ids={topic.related} language={language} />
  </>;
}
