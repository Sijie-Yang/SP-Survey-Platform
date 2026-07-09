import React, { useEffect, useRef, useState, useCallback, useMemo } from 'react';
import { Box, Alert } from '@mui/material';
import { buildSkillSrcdoc } from '../lib/skillSdk';
import { toSkillInitPayload } from '../lib/skillPostMessage';

export default function SkillQuestionFrame({ skillHtml, config, images, value, onChange, readOnly }) {
  const iframeRef = useRef(null);
  const [height, setHeight] = useState(200);

  const bootstrap = useMemo(
    () => toSkillInitPayload(config, images, value),
    [config, images, value],
  );

  const srcDoc = useMemo(
    () => buildSkillSrcdoc(skillHtml, bootstrap),
    [skillHtml, bootstrap],
  );

  const postInit = useCallback(() => {
    const iframe = iframeRef.current;
    if (!iframe?.contentWindow) return;
    try {
      iframe.contentWindow.postMessage({
        source: 'sp-survey-host',
        type: 'init',
        ...bootstrap,
      }, '*');
    } catch (err) {
      console.error('SkillQuestionFrame postMessage failed:', err);
    }
  }, [bootstrap]);

  useEffect(() => {
    const handler = (e) => {
      const d = e.data;
      if (!d || d.source !== 'sp-survey-skill') return;
      if (d.type === 'height' && d.px) setHeight(Math.min(Math.max(d.px, 80), 800));
      if (d.type === 'ready') postInit();
      if (d.type === 'answer' && !readOnly) onChange?.(d.value);
    };
    window.addEventListener('message', handler);
    return () => window.removeEventListener('message', handler);
  }, [onChange, readOnly, postInit]);

  useEffect(() => {
    const iframe = iframeRef.current;
    if (!iframe) return;
    const onLoad = () => postInit();
    iframe.addEventListener('load', onLoad);
    if (iframe.contentDocument?.readyState === 'complete') onLoad();
    return () => iframe.removeEventListener('load', onLoad);
  }, [srcDoc, postInit]);

  if (!skillHtml) {
    return <Alert severity="warning">Skill HTML not configured.</Alert>;
  }

  return (
    <Box sx={{ width: '100%' }}>
      <iframe
        ref={iframeRef}
        title="skill-question"
        sandbox="allow-scripts allow-same-origin"
        srcDoc={srcDoc}
        style={{ width: '100%', height, border: '1px solid #ddd', borderRadius: 8 }}
      />
    </Box>
  );
}
