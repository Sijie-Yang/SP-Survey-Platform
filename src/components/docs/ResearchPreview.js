import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Alert, Box, Button, Dialog, DialogContent, DialogTitle, Stack, Typography } from '@mui/material';
import { buildSingleQuestionSurvey } from '../../lib/singleQuestionSurvey';
import { previewAppearance, isPreviewMessage, PREVIEW_READY, PREVIEW_UPDATE, PREVIEW_RENDERED, PREVIEW_FAILED, QUESTION_PREVIEW_PATH } from '../../lib/questionPreviewProtocol';

function findExampleQuestion(template, questionName) {
  const walk = (elements) => (elements || []).flatMap(q => [q, ...walk(q.elements)]);
  return template.config.pages.flatMap(p => walk(p.elements)).find(q => q.name === questionName);
}

// Image-choice questions whose template already stores a study dataset use that
// template's R2 folder (templates/{id}/). Map, video and annotation examples
// keep local demonstration media.
export function exampleTemplateMediaPrefix(template, questionName) {
  const question = findExampleQuestion(template, questionName);
  if (!question || question.imageSource !== 'huggingface') return '';
  if (['mapannotation', 'mediamatrix', 'imageannotation'].includes(question.type)) return '';
  if (!String(template?.huggingfaceDataset || '').trim() || !template?.id) return '';
  return `templates/${template.id}/`;
}

export async function loadStudyExampleMedia(template, questionName) {
  const prefix = exampleTemplateMediaPrefix(template, questionName);
  if (!prefix) return null;
  const { listImagesFromR2 } = await import('../../lib/r2');
  const listed = await listImagesFromR2(prefix, { limit: 8 });
  const urls = (listed.images || [])
    .filter(image => image?.url && (image.type || 'image') === 'image')
    .slice(0, 2)
    .map(image => image.url);
  if (!listed.success || urls.length < 2) throw new Error('This template’s street views could not be loaded.');
  return urls;
}

const readyExampleMedia = new Map();
const pendingExampleMedia = new Map();

export function prefetchStudyExampleMedia(template, questionName) {
  const prefix = exampleTemplateMediaPrefix(template, questionName);
  if (!prefix) return null;
  if (readyExampleMedia.has(prefix)) return Promise.resolve(readyExampleMedia.get(prefix));
  if (pendingExampleMedia.has(prefix)) return pendingExampleMedia.get(prefix);
  const pending = loadStudyExampleMedia(template, questionName).then((urls) => {
    readyExampleMedia.set(prefix, urls);
    pendingExampleMedia.delete(prefix);
    return urls;
  }).catch((error) => {
    pendingExampleMedia.delete(prefix);
    throw error;
  });
  pendingExampleMedia.set(prefix, pending);
  return pending;
}

// Real participant renderer, one trial. Study-dataset URLs replace demonstration
// frames when supplied. No project, auth data, response storage or template mutation.
export function researchPreviewSnapshot(template, questionName, studyUrls) {
  const question = findExampleQuestion(template, questionName);
  if (!question) throw new Error('The example question is missing from this template.');
  if (question.type === 'mapannotation') {
    const { surveyJson } = buildSingleQuestionSurvey({
      question: { ...question, trialCount: 1, excludePreviouslyUsedImages: false },
      projectImages: [],
      randomMedia: false,
      showNavigationButtons: false,
    });
    return { surveyJson, appearance: previewAppearance({ ...template.config, locale: 'en' }) };
  }
  const type = question.type === 'mediamatrix' ? 'video' : 'image';
  const urls = studyUrls?.length ? studyUrls
    : question.type === 'imageannotation' ? ['/docs/research/demo-city.svg']
    : type === 'video' ? ['/hero/streetscape-loop.mp4']
      : ['/docs/research/street-a.jpg', '/docs/research/street-b.jpg'];
  const media = urls.map((url, i) => ({ url, name: `demo-${i + 1}`, key: `demo-${i + 1}`, type, folder: question.mediaFolders?.[0] || '' }));
  const draft = { ...question, trialCount: 1, excludePreviouslyUsedImages: false };
  const { surveyJson } = buildSingleQuestionSurvey({ question: draft, projectImages: media, randomMedia: false, showNavigationButtons: false });
  return { surveyJson, appearance: previewAppearance({ ...template.config, locale: 'en' }) };
}

export default function ResearchPreview({ template, questionName, language, onClose }) {
  const zh = language === 'zh';
  const dataset = exampleTemplateMediaPrefix(template, questionName);
  const frame = useRef(null);
  const [revision, setRevision] = useState(1);
  const [mobile, setMobile] = useState(false);
  const [ready, setReady] = useState(false);
  const [error, setError] = useState('');
  const [studyUrls, setStudyUrls] = useState(() => (dataset ? readyExampleMedia.get(dataset) || null : null));
  useEffect(() => {
    if (!dataset) { setStudyUrls(null); return undefined; }
    if (readyExampleMedia.has(dataset)) { setStudyUrls(readyExampleMedia.get(dataset)); return undefined; }
    let cancelled = false;
    setError('');
    const timeout = setTimeout(() => { if (!cancelled) setError(zh ? '该模板的街景暂时取不到，请重试。' : 'This template’s street views could not be loaded. Please retry.'); }, 20000);
    prefetchStudyExampleMedia(template, questionName)
      .then(urls => { if (!cancelled) { clearTimeout(timeout); setStudyUrls(urls); } })
      .catch(() => { if (!cancelled) { clearTimeout(timeout); setError(zh ? '该模板的街景暂时取不到，请重试。' : 'This template’s street views could not be loaded. Please retry.'); } });
    return () => { cancelled = true; clearTimeout(timeout); };
  }, [dataset, template, questionName, zh]);
  const snapshot = useMemo(() => {
    if (dataset && error) return { error };
    if (dataset && !studyUrls) return { pending: true };
    try { return { payload: researchPreviewSnapshot(template, questionName, studyUrls) }; }
    catch (err) { return { error: err.message }; }
  }, [template, questionName, dataset, studyUrls, error]);
  const send = useCallback(() => {
    if (snapshot.payload) frame.current?.contentWindow?.postMessage({ type: PREVIEW_UPDATE, revision, payload: snapshot.payload }, window.location.origin);
  }, [snapshot, revision]);
  useEffect(() => {
    if (!snapshot.payload) return undefined;
    setReady(false);
    const timeout = setTimeout(() => setError(zh ? '预览加载超时，请重试。' : 'Preview timed out. Please retry.'), 30000);
    const receive = (event) => {
      if (isPreviewMessage(event, frame.current?.contentWindow, PREVIEW_READY)) send();
      if (isPreviewMessage(event, frame.current?.contentWindow, PREVIEW_RENDERED) && event.data.revision === revision) {
        clearTimeout(timeout); setReady(true); setError('');
      }
      if (isPreviewMessage(event, frame.current?.contentWindow, PREVIEW_FAILED)) {
        clearTimeout(timeout); setError(zh ? '预览未能加载，请重试。' : 'Preview could not load. Please retry.');
      }
    };
    window.addEventListener('message', receive);
    send();
    return () => { clearTimeout(timeout); window.removeEventListener('message', receive); };
  }, [send, revision, zh, snapshot.payload]);
  return <Dialog open onClose={onClose} fullWidth maxWidth="lg" aria-labelledby="research-preview-title">
    <DialogTitle id="research-preview-title">{zh ? '参与者视角 · 试答一题' : 'Participant view · Try one question'}</DialogTitle>
    <DialogContent>
      <Stack direction="row" flexWrap="wrap" gap={1} sx={{ mb: 1 }}>
        <Button onClick={() => setMobile(v => !v)}>{mobile ? (zh ? '桌面宽度' : 'Desktop width') : (zh ? '手机宽度' : 'Mobile width')}</Button>
        <Button onClick={() => setRevision(v => v + 1)}>{zh ? '重新试答' : 'Restart'}</Button>
        <Button onClick={onClose} sx={{ ml: 'auto' }}>{zh ? '关闭预览' : 'Close preview'}</Button>
      </Stack>
      <Typography variant="body2" color="text.secondary" sx={{ mb: 2 }}>{dataset
        ? (zh ? '真实问卷渲染器 · 一轮 · 英文模板题干 · 该模板的街景 · 试答不会保存。' : 'Real survey renderer · One trial · Original English template wording · This template’s street views · Answers are not saved.')
        : (zh ? '真实问卷渲染器 · 一轮演示 · 英文模板题干 · 演示媒体 · 试答不会保存。视频题需播放完成后评分。' : 'Real survey renderer · One demonstration trial · Original English template wording · Demo media · Answers are not saved. Video ratings unlock after playback.')}</Typography>
      {(snapshot.error || (!dataset && error)) && <Alert severity="warning">{snapshot.error || error}</Alert>}
      {!ready && !snapshot.error && <Typography role="status">{zh ? '正在加载预览…' : 'Loading preview…'}</Typography>}
      {snapshot.payload && <Box sx={{ bgcolor: 'background.default', border: 1, borderColor: 'divider', borderRadius: 2, overflow: 'hidden' }}>
        <iframe ref={frame} src={QUESTION_PREVIEW_PATH} onLoad={send} title={zh ? '研究问卷演示' : 'Research survey demonstration'}
          style={{ display: 'block', width: mobile ? 390 : '100%', maxWidth: '100%', height: '68vh', minHeight: 430, margin: '0 auto', border: 0, background: 'white' }} />
      </Box>}
    </DialogContent>
  </Dialog>;
}
