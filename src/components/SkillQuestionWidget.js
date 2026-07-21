import React, { useEffect, useRef, useState, useCallback, useMemo } from 'react';
import { Box, Alert } from '@mui/material';
import { buildSkillSrcdoc } from '../lib/skillSdk';
import { toSkillInitPayload } from '../lib/skillPostMessage';
import { extractAnswerFromIframeMessage } from '../lib/skillAnswerBridge';
import { getPresetSkill } from '../lib/presetSkills';
import SkillAnswerReview from './SkillAnswerReview';

function presetSkillHtml(skillId) {
  if (!skillId?.startsWith('preset_')) return '';
  return getPresetSkill(skillId.replace(/^preset_/, ''))?.sourceHtml || '';
}

function stableStringify(v) {
  try {
    return JSON.stringify(v);
  } catch {
    return String(v);
  }
}

export default function SkillQuestionFrame({ skillHtml, config, images, value, onChange, readOnly, skillId }) {
  const resolvedHtml = skillHtml || presetSkillHtml(skillId);
  const iframeRef = useRef(null);
  const [height, setHeight] = useState(200);
  const iframeReadyRef = useRef(false);
  /** Ignore host→iframe value echoes for a window (AI skills often re-render on every init). */
  const skipValueSyncUntilRef = useRef(0);
  const lastEmittedJsonRef = useRef('');
  const lastInitKeyRef = useRef('');
  const debounceTimerRef = useRef(null);
  const configRef = useRef(config);
  const imagesRef = useRef(images);
  const valueRef = useRef(value);
  const onChangeRef = useRef(onChange);
  configRef.current = config;
  imagesRef.current = images;
  valueRef.current = value;
  onChangeRef.current = onChange;

  // Stable iframe document — never embed live answers in srcDoc (that reloads on every interaction).
  const srcDoc = useMemo(
    () => buildSkillSrcdoc(resolvedHtml, null),
    [resolvedHtml],
  );

  const structuralKey = useMemo(
    () => JSON.stringify({ config, images }),
    [config, images],
  );

  const postToIframe = useCallback((msg) => {
    const iframe = iframeRef.current;
    if (!iframe?.contentWindow) return;
    try {
      iframe.contentWindow.postMessage({ source: 'sp-survey-host', ...msg }, '*');
    } catch (err) {
      console.error('SkillQuestionFrame postMessage failed:', err);
    }
  }, []);

  const sendInit = useCallback((force = false) => {
    const payload = toSkillInitPayload(configRef.current, imagesRef.current, valueRef.current);
    const key = stableStringify({
      config: payload.config,
      images: payload.images,
      value: payload.value,
    });
    // AI skills often call render() on every init message — avoid duplicate inits.
    if (!force && key === lastInitKeyRef.current) return;
    lastInitKeyRef.current = key;
    postToIframe({ type: 'init', ...payload });
  }, [postToIframe]);

  useEffect(() => {
    iframeReadyRef.current = false;
    lastInitKeyRef.current = '';
  }, [srcDoc]);

  useEffect(() => () => {
    if (debounceTimerRef.current) clearTimeout(debounceTimerRef.current);
  }, []);

  useEffect(() => {
    const handler = (e) => {
      const iframe = iframeRef.current;
      // Only handle messages from this question's iframe (same page may host multiple skills).
      if (!iframe?.contentWindow || e.source !== iframe.contentWindow) return;
      const d = e.data;
      if (!d || typeof d !== 'object') return;

      // Official SDK control messages (height / ready)
      if (d.source === 'sp-survey-skill') {
        if (d.type === 'height' && d.px) {
          // Tall composite / streetscape skills often exceed 1200px (Done button below fold).
          setHeight(Math.min(Math.max(d.px, 80), 4000));
        }
        if (d.type === 'ready') {
          iframeReadyRef.current = true;
          sendInit(true);
        }
      }

      // Official answer + AI mistaken postMessage shapes (skill-result, etc.)
      const extracted = extractAnswerFromIframeMessage(d);
      if (extracted && !readOnly) {
        const json = stableStringify(extracted.value);
        // ChatGPT skills often post 3 alias messages at once — debounce + skip re-init window.
        skipValueSyncUntilRef.current = Date.now() + 600;
        if (json === lastEmittedJsonRef.current) return;
        lastEmittedJsonRef.current = json;
        if (debounceTimerRef.current) clearTimeout(debounceTimerRef.current);
        debounceTimerRef.current = setTimeout(() => {
          onChangeRef.current?.(extracted.value);
        }, 0);
      }
    };
    window.addEventListener('message', handler);
    return () => window.removeEventListener('message', handler);
  }, [readOnly, sendInit]);

  useEffect(() => {
    if (!iframeReadyRef.current) return;
    lastEmittedJsonRef.current = '';
    sendInit(true);
  }, [structuralKey, sendInit]);

  useEffect(() => {
    if (!iframeReadyRef.current) return;
    // Do NOT bounce the participant's own answer back as init — many AI skills
    // listen to all messages and call render() whenever config.mode is set, which
    // destroys in-progress UI and makes Done buttons appear dead.
    if (Date.now() < skipValueSyncUntilRef.current) return;
    const incoming = stableStringify(value);
    if (incoming === lastEmittedJsonRef.current) return;
    sendInit();
  }, [value, sendInit]);

  useEffect(() => {
    const iframe = iframeRef.current;
    if (!iframe) return;
    const onLoad = () => {
      iframeReadyRef.current = true;
      sendInit(true);
    };
    iframe.addEventListener('load', onLoad);
    if (iframe.contentDocument?.readyState === 'complete') onLoad();
    return () => iframe.removeEventListener('load', onLoad);
  }, [srcDoc, sendInit]);

  if (!resolvedHtml) {
    return <Alert severity="warning">Skill HTML not configured.</Alert>;
  }

  // Preview-before-complete / review: show the recorded answer, not a blank re-run of the skill.
  const hasAnswer = value != null && value !== '';
  if (readOnly && hasAnswer) {
    return (
      <Box sx={{ width: '100%' }}>
        <SkillAnswerReview value={value} title="你刚才提交的回答" />
      </Box>
    );
  }

  return (
    <Box sx={{ width: '100%', position: 'relative', zIndex: 1 }}>
      {readOnly && !hasAnswer && (
        <Alert severity="info" sx={{ mb: 1 }}>
          此题尚未记录到答案（完成键未成功写入，或未作答）。
        </Alert>
      )}
      <iframe
        ref={iframeRef}
        title="skill-question"
        sandbox="allow-scripts allow-same-origin"
        srcDoc={srcDoc}
        scrolling="yes"
        style={{
          width: '100%',
          height,
          border: '1px solid rgba(0,0,0,0.12)',
          borderRadius: 8,
          display: 'block',
          pointerEvents: readOnly ? 'none' : 'auto',
          touchAction: 'manipulation',
          background: '#fff',
          overflow: 'auto',
          opacity: readOnly ? 0.85 : 1,
        }}
      />
    </Box>
  );
}
