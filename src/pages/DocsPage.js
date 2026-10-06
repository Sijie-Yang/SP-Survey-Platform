import React, { lazy, Suspense, useEffect, useMemo, useState } from 'react';
import { Alert, Box, Button, Chip, CircularProgress, Dialog, DialogContent, DialogTitle, MenuItem, Stack, Table, TableBody, TableCell, TableHead, TableRow, TextField, Typography } from '@mui/material';
import { Link as RouterLink, useLocation, useParams } from 'react-router-dom';
import DocsLayout from '../components/docs/DocsLayout';
import { useRegion } from '../contexts/RegionContext';
import { normalizeRecommendation } from '../lib/analysisRecommendation';
import { PAPER_TEMPLATE_DOCS, paperTemplateDoc } from './paperTemplateDocs';
import { RESEARCH_GUIDES, GUIDE_SECTIONS, guideText } from './researchGuides';
import { describeChoiceVisibleIf } from '../lib/surveyRuntimeContext';
import { docTopic } from './docsTopics';
import { getWikiPage, listWikiPages } from '../lib/contentSubmissionStore';
import WikiPublishedArticle from '../components/docs/WikiPublishedArticle';
import DocsHome from '../components/docs/DocsHome';
import DocsTopicArticle, { CaseGallery, RelatedDocs, textOf } from '../components/docs/DocsTopicArticle';
import { TopicLab } from '../components/docs/DocsTopicArticle';
import ResearchAnalysisExample from '../components/docs/ResearchAnalysisExample';
import { prefetchStudyExampleMedia } from '../components/docs/ResearchPreview';
import { fetchPublishedTemplate } from '../lib/publishedTemplate';
import { TemplateCoverImage, useResolvedCovers } from '../lib/templateCover';
const TemplateDocPreview = lazy(() => import('../components/docs/TemplateDocPreview'));
const ResearchPreview = lazy(() => import('../components/docs/ResearchPreview'));
const sectionStyle = { scrollMarginTop: 96, pt: 4, mt: 1, borderTop: 1, borderColor: 'divider' };

export function questionsOf(config) {
  const walk = (elements) => (elements || []).flatMap(q => [q, ...walk(q.elements)]);
  return (config?.pages || []).flatMap(p => walk(p.elements)).filter(q => q.title && !['html', 'expression', 'image'].includes(q.type));
}

function useTemplate(id) {
  const [state, setState] = useState({ id: null, template: null, error: false });
  const [retry, setRetry] = useState(0);
  useEffect(() => {
    if (!id) return undefined;
    const controller = new AbortController();
    setState({ id, template: null, error: false });
    fetchPublishedTemplate(id, { signal: controller.signal })
      .then(template => { if (!controller.signal.aborted) setState({ id, template, error: false }); })
      .catch((error) => { if (controller.signal.aborted || error?.name === 'AbortError') return; setState({ id, template: null, error: true }); });
    return () => controller.abort();
  }, [id, retry]);
  return { ...(state.id === id ? state : { template: null, error: false }), retry: () => setRetry(n => n + 1) };
}

function Paragraphs({ items, language }) {
  return items.map((item, i) => <Typography key={i} sx={{ lineHeight: 1.9, mb: 1.75 }}>{guideText(item, language)}</Typography>);
}

function TemplateSettings({ template, language }) {
  const zh = language === 'zh';
  const questions = questionsOf(template.config);
  return <Box sx={{ my: 2, border: 1, borderColor: 'divider', borderRadius: 2, overflow: 'hidden' }}>
    <Typography variant="subtitle2" sx={{ p: 2, bgcolor: 'background.paper' }}>{zh ? '当前模板设置 · 从模板实时读取' : 'Current settings · Read from the template'}</Typography>
    <Box sx={{ overflowX: 'auto' }}><Table size="small" aria-label={zh ? '当前模板设置' : 'Current template settings'}>
      <TableHead><TableRow>
        <TableCell>{zh ? '题目' : 'Question'}</TableCell>
        <TableCell sx={{ whiteSpace: 'nowrap' }}>{zh ? '题型' : 'Type'}</TableCell>
        <TableCell>{zh ? '设置' : 'Settings'}</TableCell>
      </TableRow></TableHead>
      <TableBody>{questions.map(q => {
        const bits = [];
        if (q.imageCount) bits.push(zh ? `${q.imageCount} 个媒体／轮` : `${q.imageCount} media / trial`);
        if (q.trialCount) bits.push(zh ? `${q.trialCount} 轮` : `${q.trialCount} trials`);
        if (q.allowTie) bits.push(zh ? '允许平局' : 'Ties allowed');
        if (q.rateMin != null) bits.push(`${q.rateMin}–${q.rateMax}`);
        if (q.rows) bits.push(zh ? `${q.rows.length} 行` : `${q.rows.length} rows`);
        if (q.columns) bits.push(q.columns.map(c => c.value ?? c).join(' / '));
        if (q.maxAnnotations) bits.push(zh ? `最多 ${q.maxAnnotations} 个标注` : `Up to ${q.maxAnnotations} marks`);
        if (q.requireMediaEnded) bits.push(zh ? '看完再答' : 'Playback required');
        if (q.inputType === 'number') bits.push(zh ? '数字' : 'Number');
        const shown = describeChoiceVisibleIf(q.visibleIf, questions);
        if (shown.kind === 'answer') bits.push(zh ? `当「${shown.answer}」时显示` : `Shown when “${shown.answer}”`);
        if (q.type === 'mapannotation') {
          if (q.cityQuestion) bits.push(zh ? `城市题 ${q.cityQuestion}` : `City question: ${q.cityQuestion}`);
          const cities = (Array.isArray(q.studyAreas) ? q.studyAreas : []).map((area) => area.cityId || area.id).filter(Boolean);
          if (cities.length) bits.push(zh ? `范围 ${cities.join(', ')}` : `Study areas: ${cities.join(', ')}`);
          if (Array.isArray(q.mapTools) && q.mapTools.length) bits.push(q.mapTools.join(', '));
        }
        return <TableRow key={q.name}><TableCell sx={{ minWidth: 180 }}><Typography variant="body2">{q.title}</Typography><Typography variant="caption" color="text.secondary">{q.name}</Typography></TableCell><TableCell sx={{ whiteSpace: 'nowrap' }}>{q.type}</TableCell><TableCell sx={{ minWidth: 140 }}>{bits.join(' · ') || (zh ? (q.isRequired ? '必答' : '可选') : (q.isRequired ? 'Required' : 'Optional'))}</TableCell></TableRow>;
      })}</TableBody>
    </Table></Box>
  </Box>;
}

const PAIRED_PREVIEWS = {
  '1990-nasar-evaluative': {
    shots: [
      { src: '/docs/research/1990-nasar-evaluative-knoxville.png', label: 'Knoxville' },
      { src: '/docs/research/1990-nasar-evaluative-chattanooga.png', label: 'Chattanooga' },
    ],
    caption: (zh) => (zh
      ? '图：同一道地图题在选出城市后的参与者界面。左为 Knoxville，右为 Chattanooga。底图来自 OpenStreetMap，不是论文原图。'
      : 'The same map question after the participant selects a city. Knoxville is on the left and Chattanooga is on the right. The base map is OpenStreetMap, not a figure from the paper.'),
  },
  '2009-ewing-measuring': {
    shots: [
      { src: '/docs/research/2009-ewing-measuring-scene-a.png', label: 'Commercial street' },
      { src: '/docs/research/2009-ewing-measuring-scene-b.png', label: 'Pedestrian street' },
    ],
    caption: (zh) => (zh
      ? '图：同一道视频评分题在两段不同街景下的参与者界面。左为车行商业街，右为步行商业街。画面来自平台首页视频，不是原研究材料。'
      : 'The same video rating question on two different street scenes. A commercial street is on the left and a pedestrian street is on the right. Both frames come from the platform homepage video, not the original study.'),
  },
};

function PreviewFigure({ id, guide, language, onPreview, canPreview }) {
  const zh = language === 'zh';
  const [zoom, setZoom] = useState(false);
  const [failed, setFailed] = useState(false);
  const paired = PAIRED_PREVIEWS[id];
  const shots = paired?.shots || [{ src: `/docs/research/${id}-preview.png`, label: '' }];
  const altFor = (label) => `${guideText(guide.method, language)} — ${paired
    ? (zh ? `${label} 的真实问卷预览截图` : `actual survey preview for ${label}`)
    : id === '2025-yang-thermal'
      ? (zh ? '平台真实问卷预览截图，使用该模板的街景' : 'actual platform survey preview using this template’s street views')
      : ['2014-quercia-aesthetic', '2014-naik-streetscore', '2016-dubey-place', '2017-liu-machine'].includes(id)
        ? (zh ? '平台真实问卷预览截图，使用该模板附带的论文图片' : 'actual platform survey preview using this template’s paper photographs')
        : (zh ? '平台真实问卷预览截图，使用演示素材' : 'actual platform survey preview using demonstration media')}`;
  const figure = failed
    ? <Alert severity="info">{zh ? '截图暂时不可用，仍可打开交互预览。' : 'Screenshot unavailable. The interactive preview is still available.'}</Alert>
    : <Box sx={{ display: 'grid', gridTemplateColumns: paired ? { xs: '1fr', sm: '1fr 1fr' } : '1fr', gap: 1, p: paired ? 1 : 0, bgcolor: paired ? 'background.default' : 'background.paper' }}>
      {shots.map((shot) => <Box key={shot.src} component="button" onClick={() => setZoom(true)} aria-label={zh ? `放大${shot.label || '问卷'}截图` : `Enlarge ${shot.label || 'survey'} screenshot`} sx={{ p: 0, m: 0, width: '100%', border: 0, bgcolor: 'background.paper', cursor: 'zoom-in', display: 'block', textAlign: 'left' }}>
        {shot.label && <Typography variant="caption" component="span" sx={{ display: 'block', px: 1.25, py: 0.75, fontWeight: 700 }}>{shot.label}</Typography>}
        <Box component="img" src={shot.src} alt={altFor(shot.label)} onError={() => setFailed(true)} sx={{ display: 'block', width: '100%', height: 'auto' }} />
      </Box>)}
    </Box>;
  return <Box component="figure" sx={{ mx: 'auto', my: 3, width: '100%', maxWidth: paired ? 920 : 460 }}>
    <Box sx={{ border: 1, borderColor: 'divider', borderRadius: 3, overflow: 'hidden', bgcolor: 'background.paper' }}>
      <Stack direction="row" alignItems="center" justifyContent="space-between" flexWrap="wrap" sx={{ px: 2, py: 1, borderBottom: 1, borderColor: 'divider' }}>
        <Typography variant="overline" sx={{ fontSize: 10, letterSpacing: '0.06em' }}>{zh ? '参与者视角 · 真实界面截图' : 'PARTICIPANT VIEW · ACTUAL SCREENSHOT'}</Typography>
        <Button size="small" disabled={!canPreview} onClick={onPreview}>{zh ? '打开交互预览' : 'Try the question'}</Button>
      </Stack>
      {figure}
    </Box>
    <Typography component="figcaption" variant="caption" color="text.secondary" sx={{ display: 'block', mt: 1, lineHeight: 1.7 }}>
      {paired
        ? paired.caption(zh)
        : id === '2025-yang-thermal'
          ? (zh ? '图：使用平台参与者预览渲染器截取。英文模板题干，一轮比较。两张图来自该模板存放的街景，不是首页演示画面。点击截图可放大。' : 'Captured from the platform’s participant preview renderer. English template wording, one comparison. Both images are street views stored with this template, not the homepage demonstration. Click to enlarge.')
          : ['2014-quercia-aesthetic', '2014-naik-streetscore', '2016-dubey-place', '2017-liu-machine'].includes(id)
            ? (zh ? '图：使用平台参与者预览渲染器截取。英文模板题干，一轮。图片是随模板存放的论文 PDF 插图，不是原始完整刺激集。点击截图可放大。' : 'Captured from the platform’s participant preview renderer. English template wording, one trial. The pictures are photographs bundled with the template, cropped from the paper PDF, not the original full stimulus set. Click to enlarge.')
            : (zh ? '图：使用平台参与者预览渲染器截取。保留英文模板题干，仅演示一轮；媒体为教程示例，不是原研究刺激材料。点击截图可放大。' : 'Captured from the platform’s participant preview renderer. English template wording, one demonstration trial; illustrative media, not the original study stimuli. Click to enlarge.')}
    </Typography>
    {zoom && <Dialog open onClose={() => setZoom(false)} maxWidth="lg" fullWidth><DialogTitle>{zh ? '问卷预览截图' : 'Survey preview screenshot'}<Button onClick={() => setZoom(false)} sx={{ float: 'right' }}>{zh ? '关闭' : 'Close'}</Button></DialogTitle><DialogContent><Box sx={{ display: 'grid', gridTemplateColumns: paired ? { xs: '1fr', md: '1fr 1fr' } : '1fr', gap: 2 }}>{shots.map((shot) => <Box key={shot.src}><Typography variant="subtitle2" sx={{ mb: 1 }}>{shot.label}</Typography><Box component="img" src={shot.src} alt={altFor(shot.label)} sx={{ width: '100%' }} /></Box>)}</Box></DialogContent></Dialog>}
  </Box>;
}

function PaperCitation({ doc, language }) {
  const zh = language === 'zh';
  return <Box component="section" aria-label={zh ? '完整文章引用' : 'Full paper citation'} sx={{ pl: 2, my: 2.5, borderLeft: 2, borderColor: 'divider' }}>
    <Typography variant="overline" color="text.secondary" sx={{ fontSize: 10, letterSpacing: '0.08em' }}>{zh ? '文章引用' : 'PAPER CITATION'}</Typography>
    <Typography variant="body2" color="text.secondary" sx={{ lineHeight: 1.75 }}>{doc.citation}</Typography>
    <Box component="a" href={`https://doi.org/${doc.doi}`} target="_blank" rel="noopener noreferrer" sx={{ display: 'inline-block', mt: 0.75, fontSize: 12, color: 'text.secondary', textUnderlineOffset: '3px', overflowWrap: 'anywhere', '&:hover': { color: 'primary.main' } }}>{zh ? '阅读原文' : 'Read the paper'} ↗ · DOI: {doc.doi}</Box>
  </Box>;
}

function guideRelated(id) {
  if (id === '2013-salesses-collaborative') return ['visual-assessment', 'question-types', 'q-score'];
  if (id === '2025-yang-thermal') return ['trueskill', 'media-sampling', 'results-export'];
  if (id === '2009-ewing-measuring') return ['icc', 'annotations-video', 'quality-reliability'];
  if (id === '2014-quercia-aesthetic') return ['visual-assessment', 'question-types', 'quality-reliability'];
  if (id === '2014-naik-streetscore') return ['trueskill', 'visual-assessment', 'quality-reliability'];
  if (id === '2016-dubey-place') return ['trueskill', 'q-score', 'visual-assessment'];
  if (id === '2017-liu-machine') return ['icc', 'question-types', 'quality-reliability'];
  return ['question-types', 'annotations-video', 'quality-reliability'];
}

function StudyTag({ children, lead }) {
  return <Box component="span" sx={{ display: 'inline-flex', alignItems: 'center', px: 1.6, minHeight: 38, borderRadius: '999px', fontSize: 15, fontWeight: 750, letterSpacing: '-0.01em', lineHeight: 1.1, ...(lead ? { bgcolor: 'primary.main', color: 'primary.contrastText' } : { bgcolor: 'background.paper', color: 'text.primary', border: 1, borderColor: 'divider' }) }}>{children}</Box>;
}

function StudyStat({ value, label }) {
  return <Box component="span" sx={{ display: 'inline-flex', alignItems: 'baseline', gap: 0.75, px: 0.5 }}>
    {value ? <Box component="span" sx={{ fontSize: { xs: 28, sm: 34 }, fontWeight: 800, letterSpacing: '-0.045em', fontVariantNumeric: 'tabular-nums', lineHeight: 1, color: 'text.primary' }}>{value}</Box> : null}
    <Box component="span" sx={{ fontSize: 14, fontWeight: 650, color: 'text.secondary' }}>{label}</Box>
  </Box>;
}

function GuideStudyTags({ guide, language }) {
  const zh = language === 'zh';
  return <Stack component="ul" aria-label={zh ? '研究标签' : 'Study tags'} direction="row" flexWrap="wrap" alignItems="center" gap={1.25} sx={{ mt: 2, mb: 0.5, p: 0, listStyle: 'none' }}>
    <Box component="li"><StudyTag lead>{guideText(guide.topic, language)}</StudyTag></Box>
    <Box component="li"><StudyTag>{guideText(guide.medium, language)}</StudyTag></Box>
    <Box component="li"><StudyTag>{guideText(guide.method, language)}</StudyTag></Box>
    {guide.participants && <Box component="li"><StudyStat value={guide.participants.value} label={guideText(guide.participants.label, language)} /></Box>}
    {guide.mediaCount && <Box component="li"><StudyStat value={guide.mediaCount.value} label={guideText(guide.mediaCount.label, language)} /></Box>}
  </Stack>;
}

function guideSearchText(guide, language) {
  if (!guide) return '';
  return [
    guideText(guide.topic, language),
    guideText(guide.subtitle, language),
    guideText(guide.method, language),
    guideText(guide.medium, language),
    guide.participants?.value,
    guideText(guide.participants?.label, language),
    guide.mediaCount?.value,
    guideText(guide.mediaCount?.label, language),
  ].filter(Boolean).join(' ');
}

function GuideArticle({ doc, guide, language }) {
  const zh = language === 'zh';
  const { template, error, retry } = useTemplate(doc.id);
  const [preview, setPreview] = useState(false);
  const [fullPreview, setFullPreview] = useState(false);
  useEffect(() => {
    if (!template) return undefined;
    prefetchStudyExampleMedia(template, guide.question)?.catch(() => {});
    return undefined;
  }, [template, guide.question]);
  return <>
    <Box component="header" sx={{ mb: 3 }}>
      <Typography variant="overline" color="text.secondary" sx={{ letterSpacing: '0.1em', fontSize: 11 }}>{zh ? '论文研究指南' : 'PAPER GUIDE'} · {doc.year}</Typography>
      <Typography component="h1" sx={{ color: 'text.primary', fontSize: { xs: 30, md: 42 }, fontWeight: 800, letterSpacing: '-.035em', lineHeight: 1.2, mt: 0.75, mb: 1.5 }}>{doc.name}</Typography>
      <Typography color="text.secondary" sx={{ fontSize: { xs: 16, md: 18 }, lineHeight: 1.7, maxWidth: 760 }}>{guideText(guide.subtitle, language)}</Typography>
      <GuideStudyTags guide={guide} language={language} />
      <PaperCitation doc={doc} language={language} />
      <Stack direction="row" gap={1} flexWrap="wrap" alignItems="center">
        <Button variant="contained" disableElevation disabled={!template} onClick={() => setFullPreview(true)}>{zh ? '预览完整模板' : 'Preview full template'}</Button>
        <Button disabled={!template} onClick={() => setPreview(true)}>{zh ? '试答示例题' : 'Try the example'}</Button>
        <Button component="a" href="#use-template" sx={{ color: 'text.secondary' }}>{zh ? '使用这个模板' : 'Use this template'}</Button>
      </Stack>
    </Box>
    <Box component="nav" aria-label={zh ? '本篇目录' : 'On this page'} sx={{ p: { xs: 2, sm: 2.5 }, bgcolor: 'background.paper', border: 1, borderColor: 'divider', borderRadius: 2, mb: 4 }}>
      <Stack direction="row" alignItems="center" justifyContent="space-between" gap={2} sx={{ mb: 1.5 }}>
        <Typography variant="overline" color="text.secondary" sx={{ fontSize: 10, letterSpacing: '0.08em' }}>{zh ? '本篇目录' : 'IN THIS GUIDE'}</Typography>
        <Box component="a" href="#worked-example" sx={{ fontSize: 12, color: 'text.secondary', textUnderlineOffset: '3px' }}>{zh ? '查看计分示例' : 'Explore the scoring example'}</Box>
      </Stack>
      <Box sx={{ display: 'grid', gridTemplateColumns: { xs: '1fr', sm: '1fr 1fr' }, columnGap: 3, rowGap: 1.25 }}>
        {GUIDE_SECTIONS.map(([id, label], i) => <Box key={id} component="a" href={`#${id}`} sx={{ display: 'flex', gap: 1.5, alignItems: 'baseline', color: 'text.primary', fontSize: 13, lineHeight: 1.6, textDecoration: 'none', '&:hover': { color: 'primary.main' } }}><Box component="span" sx={{ color: 'text.secondary', fontSize: 11, fontVariantNumeric: 'tabular-nums' }}>0{i + 1}</Box>{guideText(label, language)}</Box>)}
      </Box>
    </Box>
    {GUIDE_SECTIONS.map(([id, label], i) => <Box component="section" id={id} key={id} sx={sectionStyle}>
      <Typography variant="overline" color="text.secondary">0{i + 1}</Typography>
      <Typography component="h2" variant="h5" fontWeight={750} sx={{ mb: 2, color: 'text.primary' }}>{guideText(label, language)}</Typography>
      <Paragraphs items={guide[id]} language={language} />
      {id === 'concepts' && <Box sx={{ display: 'grid', gridTemplateColumns: { xs: '1fr', sm: '1fr 1fr' }, gap: 1.5, my: 3 }}>
        {guide.dimensions.map(([title, body], j) => <Box key={j} sx={{ p: 2.5, bgcolor: 'background.paper', borderRadius: 2 }}><Typography component="h3" variant="subtitle1" fontWeight={700}>{guideText(title, language)}</Typography><Typography variant="body2" sx={{ mt: 1, lineHeight: 1.75 }}>{guideText(body, language)}</Typography></Box>)}
      </Box>}
      {id === 'design' && <PreviewFigure id={doc.id} guide={guide} language={language} canPreview={!!template} onPreview={() => setPreview(true)} />}
      {id === 'implementation' && <>
        <Box component="ol" sx={{ pl: 2.5, mb: 3, display: 'grid', gridTemplateColumns: { xs: '1fr', sm: '1fr 1fr' }, gap: 1 }}>{guide.flow.map((item, j) => <Typography component="li" variant="body2" color="text.secondary" key={j} sx={{ pl: 0.5, lineHeight: 1.7 }}>{guideText(item, language)}</Typography>)}</Box>
        {error ? <Alert severity="warning" action={<Button onClick={retry}>{zh ? '重试' : 'Retry'}</Button>}>{zh ? '模板未能加载；仍可阅读教程。' : 'Template could not load; the guide remains available.'}</Alert> : template ? <Box component="details" open={questionsOf(template.config).length <= 8} sx={{ my: 2 }}><Box component="summary" sx={{ cursor: 'pointer', fontWeight: 600 }}>{zh ? `查看当前模板的 ${questionsOf(template.config).length} 道题目与设置` : `Inspect ${questionsOf(template.config).length} current questions and settings`}</Box><TemplateSettings template={template} language={language} /></Box> : <CircularProgress size={24} aria-label="Loading template" />}
        <Box id="use-template" sx={{ p: 2.5, my: 2, bgcolor: 'background.paper', borderRadius: 2, scrollMarginTop: 90 }}>
          <Typography fontWeight={700}>{zh ? '在自己的项目中使用' : 'Use it in your project'}</Typography>
          <Typography variant="body2" sx={{ my: 1, lineHeight: 1.8 }}>{doc.id === '1990-nasar-evaluative'
            ? (zh ? `登录后台，在项目侧栏的模板库搜索“${doc.name}”，选择模板创建项目。地图题使用研究范围，不需要上传图片。` : `Sign in, find “${doc.name}” in the project sidebar’s template library, and create a project from it. The map questions use the study extent and do not need uploaded images.`)
            : (zh ? `登录后台，在项目侧栏的模板库搜索“${doc.name}”，选择模板创建项目，再替换研究媒体与设置。` : `Sign in, find “${doc.name}” in the project sidebar’s template library, create a project from it, then supply your media and study settings.`)}</Typography>
          <Button component={RouterLink} to="/admin" size="small">{zh ? '进入工作台' : 'Open workspace'}</Button>
        </Box>
      </>}
      {id === 'scoring' && doc.id === '2009-ewing-measuring' && <Button component={RouterLink} to="/docs/icc" sx={{ mb: 1 }}>{zh ? '阅读 ICC(2,1) 与 ICC(2,k) 的算法说明 →' : 'Read how ICC(2,1) and ICC(2,k) are calculated →'}</Button>}
      {id === 'scoring' && <ResearchAnalysisExample id={doc.id} language={language} />}
    </Box>)}
    <Box sx={{ ...sectionStyle, mb: 3 }}>
      <Typography variant="subtitle2">{zh ? '文献与核对范围' : 'Source & verification scope'}</Typography>
      <Typography variant="caption" color="text.secondary">{zh ? '原文核对：2026-10-04' : 'Source checked: 2026-10-04'}</Typography>
      <Typography variant="body2" sx={{ my: 1 }}><Box component="a" href={`https://doi.org/${doc.doi}`} target="_blank" rel="noopener noreferrer">{doc.citation}</Box></Typography>
      <Typography variant="body2" color="text.secondary">{guideText(guide.source, language)}</Typography>
      <Typography variant="caption" color="text.secondary">{template?.source === 'online'
        ? (zh ? '方法解释依据原文。设置表和预览读取线上模板及其媒体库。截图记录的是文档编写时的界面。' : 'Method explanations follow the source. The settings table and preview read the live template and its media library. Screenshots record the interface at authoring time.')
        : (zh ? '方法解释依据原文。线上模板暂时不可用，设置表和预览改用随站点发布的模板。截图记录的是文档编写时的界面。' : 'Method explanations follow the source. The live template is unavailable, so the settings table and preview use the copy bundled with this site. Screenshots record the interface at authoring time.')}</Typography>
    </Box>
    <RelatedDocs ids={guideRelated(doc.id)} language={language} />
    {fullPreview && template && <Suspense fallback={<CircularProgress size={24} />}><TemplateDocPreview template={template} doc={doc} language={language} onClose={() => setFullPreview(false)} /></Suspense>}
    {preview && template && <Suspense fallback={<CircularProgress size={24} />}><ResearchPreview template={template} questionName={guide.question} language={language} onClose={() => setPreview(false)} /></Suspense>}
  </>;
}

function TemplateReference({ doc, language }) {
  const zh = language === 'zh';
  const { template, error, retry } = useTemplate(doc.id);
  const [preview, setPreview] = useState(false);
  return <>
    <Typography variant="overline" color="primary.main">{zh ? '模板参考' : 'TEMPLATE REFERENCE'}</Typography>
    <Typography component="h1" variant="h4" fontWeight={800} sx={{ my: 2 }}>{doc.name}</Typography>
    <PaperCitation doc={doc} language={language} />
    <Button variant="contained" disabled={!template} onClick={() => setPreview(true)} sx={{ mb: 3 }}>{zh ? '预览完整模板' : 'Preview full template'}</Button>
    <Alert severity="info" sx={{ mb: 3 }}>{zh ? '这篇目前提供模板参考。完整的概念解释、原文方法核对和图文教程尚未编写；下面的分析配置不代表原论文的全部方法。' : 'This page currently provides a template reference. A source-checked illustrated guide is not yet available; analysis settings below do not describe the paper’s entire methodology.'}</Alert>
    {error ? <Alert severity="warning" action={<Button onClick={retry}>{zh ? '重试' : 'Retry'}</Button>}>{zh ? '模板加载失败。' : 'Template could not load.'}</Alert> : !template ? <CircularProgress size={28} /> : <>
      <Typography sx={{ lineHeight: 1.8 }}>{template.description}</Typography>
      <Typography variant="body2" sx={{ my: 2 }}>{template.author} · {template.year} {template.website && <Box component="a" href={`https://doi.org/${doc.doi}`} target="_blank" rel="noopener noreferrer">{zh ? '阅读原文 ↗' : 'Read the paper ↗'}</Box>}</Typography>
      <TemplateSettings template={template} language={language} />
      <Typography component="h2" variant="h6">{zh ? '模板配置的分析方法' : 'Analysis methods configured in the template'}</Typography>
      <Stack component="ul" sx={{ pl: 2.5 }}>{normalizeRecommendation(template.config).items.map((item, i) => <Typography key={i} component="li" variant="body2" sx={{ my: 0.5, overflowWrap: 'anywhere' }}>{item.method} · {item.questions.join(', ')}{item.scale ? ` · ${item.scale}` : ''}</Typography>)}</Stack>
      <Button component={RouterLink} to="/admin" variant="outlined">{zh ? '进入工作台使用模板' : 'Open workspace to use templates'}</Button>
    </>}
    {preview && template && <Suspense fallback={<CircularProgress size={24} />}><TemplateDocPreview template={template} doc={doc} language={language} onClose={() => setPreview(false)} /></Suspense>}
  </>;
}

function PaperTemplatesIndex({ language }) {
  const zh = language === 'zh';
  const [query, setQuery] = useState('');
  const [topic, setTopic] = useState('');
  const [method, setMethod] = useState('');
  const guides = Object.entries(RESEARCH_GUIDES);
  const topics = [...new Set(guides.map(([, g]) => guideText(g.topic, language)))];
  const methods = [...new Set(guides.map(([, g]) => guideText(g.method, language)))];
  useEffect(() => { setTopic(''); setMethod(''); }, [language]);
  const guideIds = useMemo(() => PAPER_TEMPLATE_DOCS.filter(doc => RESEARCH_GUIDES[doc.id]).map(doc => doc.id), []);
  const covers = useResolvedCovers(guideIds);
  const selected = useMemo(() => PAPER_TEMPLATE_DOCS.filter(doc => {
    const g = RESEARCH_GUIDES[doc.id];
    return (!topic || (g && guideText(g.topic, language) === topic)) && (!method || (g && guideText(g.method, language) === method))
      && `${doc.name} ${doc.citation} ${doc.shortCitation} ${guideSearchText(g, language)}`.toLowerCase().includes(query.trim().toLowerCase());
  }), [query, topic, method, language]);
  return <>
    <Typography variant="overline" color="primary.main">SP-SURVEY / DOCS</Typography>
    <Typography component="h1" sx={{ fontSize: { xs: 34, md: 50 }, fontWeight: 800, color: 'text.primary', letterSpacing: '-.04em', lineHeight: 1.2, mt: 1, mb: 2 }}>{zh ? '论文案例与模板' : 'Paper cases & templates'}</Typography>
    <Typography sx={{ fontSize: 18, lineHeight: 1.8, maxWidth: 720, color: 'text.secondary' }}>{zh ? '读懂论文如何定义感知、设计问卷和解释结果，再用 SP-Survey 搭建自己的研究。真实问卷预览与可操作的计分示例，贯穿每篇指南。' : 'Understand how papers define perception, design surveys and interpret results. Then build your own study with SP-Survey, through real survey previews and worked scoring examples.'}</Typography>
    <Stack direction="row" gap={1} sx={{ my: 3 }}><Chip label={zh ? `${Object.keys(RESEARCH_GUIDES).length} 篇图文指南` : `${Object.keys(RESEARCH_GUIDES).length} illustrated guides`} color="primary" variant="outlined" /><Chip label={zh ? `${PAPER_TEMPLATE_DOCS.length} 个论文模板` : `${PAPER_TEMPLATE_DOCS.length} paper templates`} variant="outlined" /></Stack>
    <Typography component="h2" variant="h5" fontWeight={750} sx={{ mt: 4, mb: 2 }}>{zh ? '选择一条研究路径' : 'Choose a research path'}</Typography>
    <Stack direction={{ xs: 'column', sm: 'row' }} gap={1.5} sx={{ mb: 3 }}>
      <TextField size="small" label={zh ? '搜索论文、概念或方法' : 'Search papers, concepts or methods'} value={query} onChange={e => setQuery(e.target.value)} sx={{ flex: 1 }} />
      <TextField size="small" select label={zh ? '感知概念' : 'Concept'} value={topic} onChange={e => setTopic(e.target.value)} sx={{ minWidth: 180 }}><MenuItem value="">{zh ? '全部概念' : 'All concepts'}</MenuItem>{topics.map(t => <MenuItem key={t} value={t}>{t}</MenuItem>)}</TextField>
      <TextField size="small" select label={zh ? '问卷方法' : 'Survey method'} value={method} onChange={e => setMethod(e.target.value)} sx={{ minWidth: 190 }}><MenuItem value="">{zh ? '全部方法' : 'All methods'}</MenuItem>{methods.map(t => <MenuItem key={t} value={t}>{t}</MenuItem>)}</TextField>
    </Stack>
    {(topic || method) && <Typography variant="caption" color="text.secondary">{zh ? '概念与方法筛选目前覆盖四篇已核对的指南。' : 'Concept and method filters currently cover the four source-checked guides.'}</Typography>}
    <Box sx={{ display: 'grid', gridTemplateColumns: { xs: '1fr', sm: '1fr 1fr' }, gap: 2, mt: 2 }}>
      {selected.filter(d => RESEARCH_GUIDES[d.id]).map(doc => {
        const g = RESEARCH_GUIDES[doc.id];
        return <Box key={doc.id} component={RouterLink} to={`/docs/${doc.id}`} sx={{ textDecoration: 'none', color: 'inherit', bgcolor: 'background.paper', border: 1, borderColor: 'divider', borderRadius: 3, overflow: 'hidden', '&:hover': { borderColor: 'primary.main', boxShadow: 2 } }}>
          <TemplateCoverImage candidates={covers[doc.id]} alt={doc.name} sx={{ width: '100%', height: 200, objectFit: 'cover', display: 'block', borderBottom: 1, borderColor: 'divider' }} />
          <Box sx={{ p: 2.5 }}><Typography variant="overline" color="primary.main">{doc.year} · {guideText(g.method, language)}</Typography><Typography component="h3" variant="h6" fontWeight={700}>{doc.name}</Typography><Typography variant="body2" color="text.secondary" sx={{ lineHeight: 1.8, mt: 1 }}>{guideText(g.subtitle, language)}</Typography><Typography variant="body2" color="primary.main" sx={{ mt: 2 }}>{zh ? '阅读图文指南 →' : 'Read the illustrated guide →'}</Typography></Box>
        </Box>;
      })}
    </Box>
    {selected.some(d => !RESEARCH_GUIDES[d.id]) && <>
      <Typography component="h2" variant="h6" fontWeight={700} sx={{ mt: 4, mb: 1 }}>{zh ? '更多论文模板参考' : 'More paper template references'}</Typography>
      <Typography variant="body2" color="text.secondary" sx={{ mb: 2 }}>{zh ? '以下页面提供题目与设置，完整研究指南将逐步补充。' : 'These pages list questions and settings. Full research guides will be added progressively.'}</Typography>
      {selected.filter(d => !RESEARCH_GUIDES[d.id]).map(doc => <Box key={doc.id} component={RouterLink} to={`/docs/${doc.id}`} sx={{ display: 'block', py: 1.5, borderBottom: 1, borderColor: 'divider', textDecoration: 'none', color: 'text.primary' }}>{doc.year} · {doc.name} <Box component="span" sx={{ float: 'right' }}>→</Box></Box>)}
    </>}
    {!selected.length && <Typography sx={{ py: 4 }}>{zh ? '没有符合条件的指南或模板。请调整搜索条件。' : 'No guides or templates match. Try another search or filter.'}</Typography>}
  </>;
}

function PublishedTemplateTools({ doc, language }) {
  const { template, error, retry } = useTemplate(doc.id);
  const [preview, setPreview] = useState(false);
  const [example, setExample] = useState(false);
  const guide = RESEARCH_GUIDES[doc.id];
  const zh = language === 'zh';
  return <Box sx={{ my: 3 }}>
    <Button variant="outlined" disabled={!template} onClick={() => setPreview(true)}>{zh ? '预览完整模板' : 'Preview full template'}</Button>
    {guide && <><PreviewFigure id={doc.id} guide={guide} language={language} canPreview={!!template} onPreview={() => setExample(true)} /><ResearchAnalysisExample id={doc.id} language={language} /></>}
    {error && <Alert severity="warning" action={<Button onClick={retry}>{zh ? '重试' : 'Retry'}</Button>}>{zh ? '模板未能加载。' : 'Template could not load.'}</Alert>}
    {template && <Box component="details" sx={{ mt: 2 }}><summary>{zh ? '当前模板设置' : 'Current template settings'}</summary><TemplateSettings template={template} language={language} /></Box>}
    {preview && template && <Suspense fallback={<CircularProgress size={24} />}><TemplateDocPreview template={template} doc={doc} language={language} onClose={() => setPreview(false)} /></Suspense>}
    {example && template && <Suspense fallback={<CircularProgress size={24} />}><ResearchPreview template={template} questionName={guide.question} language={language} onClose={() => setExample(false)} /></Suspense>}
  </Box>;
}

export default function DocsPage() {
  const { docId } = useParams();
  const { hash } = useLocation();
  const { language } = useRegion();
  const zh = language === 'zh';
  const doc = paperTemplateDoc(docId);
  const topic = docTopic(docId);
  const collection = docId === 'paper-templates';
  const [wikiState, setWikiState] = useState({ key: '', page: null, loading: false, error: false });
  const [community, setCommunity] = useState([]);
  const wikiKey = `${docId || ''}:${language}`;
  const published = wikiState.key === wikiKey ? wikiState.page : null;
  const wikiLoading = !!docId && !collection && (wikiState.key !== wikiKey || wikiState.loading);
  useEffect(() => {
    let active = true;
    listWikiPages().then(rows => { if (active) setCommunity(rows.filter(r => !paperTemplateDoc(r.page_key) && !docTopic(r.page_key))); }).catch(() => {});
    return () => { active = false; };
  }, []);
  useEffect(() => {
    if (!docId || collection) return undefined;
    let active = true;
    setWikiState({ key: wikiKey, page: null, loading: true, error: false });
    (async () => {
      try {
        let page = await getWikiPage(docId, language);
        if (!page && !doc && !topic) page = await getWikiPage(docId, language === 'zh' ? 'en' : 'zh');
        if (active) setWikiState({ key: wikiKey, page, loading: false, error: false });
      } catch (error) { if (active) setWikiState({ key: wikiKey, page: null, loading: false, error: !error.missingSchema }); }
    })();
    return () => { active = false; };
  }, [docId, collection, doc, topic, wikiKey, language]);
  const communityPages = [...new Set(community.map(r => r.page_key))].map(key => community.find(r => r.page_key === key && r.language === language) || community.find(r => r.page_key === key));
  useEffect(() => {
    document.title = `${published?.title || textOf(topic?.title, language) || doc?.name || (zh ? '研究文档' : 'Research documentation')} | SP-Wiki`;
    // Preserve deep links into sections when opening a guide.
    const timer = setTimeout(() => {
      if (window.location.hash) document.getElementById(window.location.hash.slice(1))?.scrollIntoView();
      else window.scrollTo(0, 0);

    }, 0);
    return () => clearTimeout(timer);
  }, [docId, doc?.name, topic, language, zh, published?.title, hash]);
  return <DocsLayout language={language} currentHref={docId ? `/docs/${docId}` : '/docs'} currentTitle={published?.title || doc?.name || textOf(topic?.title, language)} communityPages={communityPages}
    actions={docId && !collection && (doc || topic || published) && <Button size="small" component={RouterLink} to={`/contribute?kind=doc_edit&target=${encodeURIComponent(docId)}&language=${published?.language || language}`}>{zh ? '建议编辑此页' : 'Suggest an edit'}</Button>}>
        {wikiState.key === wikiKey && wikiState.error && <Alert severity="warning" sx={{ mb: 2 }}>{zh ? '社区版本暂时无法加载，下方如有内容则为随站点发布的版本。' : 'Community revisions are unavailable. Any content below is the version bundled with this site.'}</Alert>}
        {published ? <><WikiPublishedArticle key={wikiKey} page={published} language={language} lead={(doc || paperTemplateDoc(published.template_id)) && <PaperCitation doc={doc || paperTemplateDoc(published.template_id)} language={language} />} />{(doc || paperTemplateDoc(published.template_id)) && <PublishedTemplateTools doc={doc || paperTemplateDoc(published.template_id)} language={language} />}<TopicLab topic={topic} language={language} />{topic?.gallery && <CaseGallery language={language} ids={Array.isArray(topic.gallery) ? topic.gallery : undefined} />}{topic?.related && <RelatedDocs ids={topic.related} language={language} />}</> : !docId ? <DocsHome language={language} communityPages={communityPages} /> : topic ? <DocsTopicArticle key={topic.id} topic={topic} language={language} /> : collection ? <PaperTemplatesIndex language={language} /> : !doc && wikiLoading ? <CircularProgress aria-label="Loading wiki page" /> : !doc ? <><Typography component="h1" variant="h4">{zh ? '未找到这篇文档' : 'Document not found'}</Typography><Button component={RouterLink} to="/docs">{zh ? '浏览研究指南' : 'Browse research guides'}</Button></> : RESEARCH_GUIDES[doc.id] ? <GuideArticle key={doc.id} doc={doc} guide={RESEARCH_GUIDES[doc.id]} language={language} /> : <TemplateReference key={doc.id} doc={doc} language={language} />}
  </DocsLayout>;
}
