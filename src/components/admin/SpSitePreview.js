import React, { useContext, useMemo, useState } from 'react';
import { Alert, Box, Button, Typography } from '@mui/material';
import SpSiteFrame from '../SpSiteFrame';
import { buildSiteQuestions } from '../../lib/spSite';
import { RegionContext } from '../../contexts/RegionContext';
import { uiPair } from '../../lib/uiLanguages';

const VIEWPORT_WIDTH = { mobile: 390, tablet: 820 };

/**
 * Builder preview of an SP-Scheme site: the same page participants get, with
 * media drawn the same way. Answers are checked and shown, never submitted.
 */
export default function SpSitePreview({ config: baseConfig, spSite, viewport = 'desktop', height = '78vh' }) {
  const language = useContext(RegionContext)?.language || 'en';
  const L = (en, zh) => uiPair(language, en, zh);
  // Memoized so media are drawn once per preview run, not on every render.
  const config = useMemo(() => ({ ...baseConfig, spSite: spSite || baseConfig?.spSite }), [baseConfig, spSite]);
  const [run, setRun] = useState(0);
  const questions = useMemo(() => buildSiteQuestions(config), [config, run]); // eslint-disable-line react-hooks/exhaustive-deps
  const [answers, setAnswers] = useState({});
  const [completed, setCompleted] = useState(false);
  const width = VIEWPORT_WIDTH[viewport] || '100%';

  const restart = () => {
    setAnswers({});
    setCompleted(false);
    setRun((n) => n + 1);
  };

  return (
    <Box data-testid="sp-site-preview">
      <Alert severity="info" sx={{ mb: 1.5 }}>
        {L(
          'This survey uses the interface designed with SP-Scheme. Participants see exactly this page; the platform draws the media and records the answers below. Nothing is submitted from the preview.',
          '这份问卷使用 SP-Scheme 导入的大模型设计界面。参与者看到的就是这个页面；图片由平台抽取，答案按下方格式记录。预览不会提交数据。',
        )}
      </Alert>
      <Box sx={{ width, maxWidth: '100%', height, mx: 'auto', border: '1px solid', borderColor: 'divider', borderRadius: 1, overflow: 'hidden' }}>
        <SpSiteFrame
          key={run}
          html={config.spSite.html}
          allowedHosts={config.spSite.allowedHosts || []}
          questions={questions}
          survey={{ title: config.title || '', description: config.description || '', language: config.locale || 'en', preview: true }}
          onAnswer={(name, stored) => setAnswers((prev) => {
            const next = { ...prev };
            if (stored == null) delete next[name];
            else next[name] = stored;
            return next;
          })}
          onComplete={() => setCompleted(true)}
          title={config.title || 'Survey preview'}
        />
      </Box>
      <Box sx={{ mt: 1.5, p: 1.5, border: '1px solid', borderColor: 'divider', borderRadius: 1, bgcolor: 'grey.50' }}>
        <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, mb: 1 }}>
          <Typography variant="subtitle2" sx={{ flex: 1 }}>
            {completed
              ? L('Preview finished: the participant would now submit these answers.', '预览完成：参与者此时会提交这些答案。')
              : L('Answers recorded so far', '目前记录的答案')}
          </Typography>
          <Button size="small" onClick={restart}>{L('Restart', '重新开始')}</Button>
        </Box>
        <Box
          component="pre"
          data-testid="sp-site-preview-answers"
          sx={{ m: 0, maxHeight: 240, overflow: 'auto', fontSize: 12, whiteSpace: 'pre-wrap', wordBreak: 'break-all' }}
        >
          {Object.keys(answers).length ? JSON.stringify(answers, null, 2) : L('(no answers yet)', '（还没有答案）')}
        </Box>
      </Box>
    </Box>
  );
}
