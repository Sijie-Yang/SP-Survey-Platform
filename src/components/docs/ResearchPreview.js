import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Alert, Box, Button, Dialog, DialogContent, DialogTitle, Stack, Typography } from '@mui/material';
import { buildSingleQuestionSurvey } from '../../lib/singleQuestionSurvey';
import { loadBundledMediaEntries } from '../../lib/templateCover';
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

function isStudyImage(entry) {
  if (!entry?.url) return false;
  if (entry.type && entry.type !== 'image') return false;
  return !/\.(mp4|webm|mov|m4v|mp3|wav)(\?|$)/i.test(entry.url);
}

// Images already stored on the template (its media library) are the example.
// Map, video and annotation questions keep their own demonstration media.
export function libraryExampleUrls(template, questionName) {
  const question = findExampleQuestion(template, questionName);
  if (!question || ['mapannotation', 'mediamatrix', 'imageannotation'].includes(question.type)) return null;
  const urls = (template?.preloadedImages || []).filter(isStudyImage).map((entry) => entry.url);
  const needed = Math.max(1, Number(question.imageCount) || 2);
  if (urls.length < Math.min(needed, 2)) return null;
  return urls.slice(0, needed);
}

function imageLoads(url) {
  return new Promise((resolve) => {
    const img = new Image();
    const finish = (ok) => { img.onload = null; img.onerror = null; resolve(ok); };
    const timer = setTimeout(() => finish(false), 8000);
    img.onload = () => { clearTimeout(timer); finish(true); };
    img.onerror = () => { clearTimeout(timer); finish(false); };
    img.src = url;
  });
}

// The saved media library can still point at files that were moved. A pair that
// does not load falls through to the photographs bundled beside the template.
export async function workingExampleUrls(urls) {
  const pair = (urls || []).filter(Boolean).slice(0, 2);
  if (pair.length < 2) return null;
  const ok = await Promise.all(pair.map(imageLoads));
  return ok.every(Boolean) ? pair : null;
}

export async function loadStudyExampleMedia(template, questionName) {
  const library = libraryExampleUrls(template, questionName);
  if (library) return library;
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
  const library = libraryExampleUrls(template, questionName);
  if (library) return Promise.resolve(library);
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
  const libraryUrls = libraryExampleUrls(template, questionName);
  const libraryKey = libraryUrls ? libraryUrls.join('\n') : '';
  const dataset = libraryUrls ? 'library' : exampleTemplateMediaPrefix(template, questionName);
  const frame = useRef(null);
  const [revision, setRevision] = useState(1);
  const [mobile, setMobile] = useState(false);
  const [ready, setReady] = useState(false);
  const [error, setError] = useState('');
  const [studyUrls, setStudyUrls] = useState(null);
  const [mediaReady, setMediaReady] = useState(false);
  useEffect(() => {
    let cancelled = false;
    setError('');
    setMediaReady(false);
    setStudyUrls(null);
    const fail = () => { if (!cancelled) setError(zh ? '该模板的街景暂时取不到，请重试。' : 'This template’s street views could not be loaded. Please retry.'); };
    const timeout = setTimeout(fail, 20000);
    (async () => {
      const library = libraryUrls ? await workingExampleUrls(libraryUrls) : null;
      if (cancelled) return;
      if (library) { clearTimeout(timeout); setStudyUrls(library); setMediaReady(true); return; }
      const bundled = await workingExampleUrls((await loadBundledMediaEntries(template?.id)).map((entry) => entry.url));
      if (cancelled) return;
      if (bundled) { clearTimeout(timeout); setStudyUrls(bundled); setMediaReady(true); return; }
      if (!dataset || dataset === 'library') { clearTimeout(timeout); setStudyUrls(null); setMediaReady(true); return; }
      try {
        const urls = await loadStudyExampleMedia({ ...template, preloadedImages: [] }, questionName);
        if (!cancelled) { clearTimeout(timeout); setStudyUrls(urls); setMediaReady(true); }
      } catch { clearTimeout(timeout); fail(); }
    })();
    return () => { cancelled = true; clearTimeout(timeout); };
    // libraryUrls is a new array whenever it is present; libraryKey is its stable identity.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [dataset, libraryKey, template, questionName, zh]);
  const snapshot = useMemo(() => {
    if (error) return { error };
    if (!mediaReady) return { pending: true };
    try { return { payload: researchPreviewSnapshot(template, questionName, studyUrls) }; }
    catch (err) { return { error: err.message }; }
  }, [template, questionName, studyUrls, error, mediaReady]);
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
