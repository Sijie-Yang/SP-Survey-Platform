import React, { useEffect, useState } from 'react';
import {
  Alert,
  Box,
  Button,
  CircularProgress,
  FormControlLabel,
  LinearProgress,
  Link,
  Radio,
  RadioGroup,
  TextField,
  Typography,
} from '@mui/material';
import { ArticleOutlined } from '@mui/icons-material';
import { Link as RouterLink } from 'react-router-dom';
import { useOptionalAuth } from '../../contexts/AuthContext';
import { getTemplateById } from '../../lib/templateManager';
import { createStudioProjectFromTemplate, importStudioTemplateMedia, isStudioLocalMode } from '../../lib/studioData';
import { TEMPLATE_LIBRARY_PATH } from '../../lib/researcherEntry';
import { StudioFirstRun } from './StudioAssistant';
import { useL } from './studioUi';

/** What the AI is told when the researcher brings their own images instead of the template's. */
export function ownImagesNote(L) {
  return L(
    "I will upload my own images instead of the template's, so the page must work with the images in the image library, whatever their file names.",
    '我会上传自己的图片，不用模板自带的，所以页面要能用图片库里的图片，不管文件叫什么名字。',
  );
}

/** The first message to the assistant: what the researcher asked, plus the image choice. */
export function templateFirstRequest({ text, images, isPage }, L) {
  const request = String(text || '').trim();
  if (!request) return '';
  return images === 'own' && isPage ? `${request}\n\n${ownImagesNote(L)}` : request;
}

/**
 * The new-study box when a template was chosen ("Use" on a template): the
 * same steps as a new study. Say what to change (optional), keep the
 * template's images or bring your own, then the study opens and the AI
 * assistant keeps changing it.
 */
export default function StudioTemplateStart({ templateId, onStarted = () => {}, onLeave = () => {} }) {
  const L = useL();
  const auth = useOptionalAuth();
  const [template, setTemplate] = useState(undefined);
  const [text, setText] = useState('');
  const [images, setImages] = useState('template');
  const [step, setStep] = useState('');
  const [copy, setCopy] = useState(null);
  const [error, setError] = useState('');
  const [created, setCreated] = useState(null);

  useEffect(() => {
    let live = true;
    setTemplate(undefined);
    getTemplateById(templateId).then((found) => { if (live) setTemplate(found || null); });
    return () => { live = false; };
  }, [templateId]);

  if (template === undefined) {
    return <Box sx={{ display: 'flex', justifyContent: 'center', py: 4 }}><CircularProgress aria-label={L('Loading', '加载中')} /></Box>;
  }
  if (!template) {
    return (
      <Box data-testid="studio-template-missing">
        <Alert severity="warning" sx={{ mb: 1.5 }}>{L('This template was not found.', '找不到这个模板。')}</Alert>
        <Button variant="outlined" onClick={onLeave}>{L('Start without a template', '不用模板，直接开始')}</Button>
      </Box>
    );
  }

  const imageCount = (template.preloadedImages || []).length;
  const isPage = Boolean(template.config?.spSite?.html);
  // The AI and the image copy run on the server: they need a signed-in researcher.
  const online = Boolean(auth?.user?.id) && !isStudioLocalMode();
  const useTemplateImages = images === 'template' && imageCount > 0 && online;
  const busy = Boolean(step);

  const open = (projectId) => onStarted({ projectId, created: true });

  const start = async () => {
    if (busy) return;
    setError('');
    setStep('creating');
    const result = await createStudioProjectFromTemplate(template, String(template.name || L('New study', '新研究')).slice(0, 120));
    if (!result?.success) {
      setStep('');
      setError(L(`The study could not be created: ${result?.error}`, `没能新建研究：${result?.error}`));
      return;
    }
    const project = { ...result.project, _surveyConfig: result.surveyConfig };
    let copyError = '';
    if (useTemplateImages) {
      setStep('copying');
      setCopy({ copied: 0, total: imageCount });
      const copied = await importStudioTemplateMedia(project.id, template.id, {
        onProgress: (p) => setCopy({ copied: p.copied, total: imageCount }),
      });
      if (!copied.success) copyError = copied.error || 'copy failed';
    }
    const request = online ? templateFirstRequest({ text, images: useTemplateImages ? 'template' : 'own', isPage }, L) : '';
    if (copyError) {
      // The study exists; the researcher opens it and takes the images there.
      setStep('');
      setCreated({ project, request: '', copyError });
      return;
    }
    if (request) {
      setStep('');
      setCreated({ project, request });
      return;
    }
    open(project.id);
  };

  if (created?.copyError) {
    return (
      <Box data-testid="studio-template-copy-error">
        <Alert severity="warning" sx={{ mb: 1.5 }}>
          {L(
            `The study was created, but the template's images were not all copied (${created.copyError}). Open the study and use "Use the template's images" in the image library to copy the rest.`,
            `研究已经建好，但模板的图片没有全部复制过来（${created.copyError}）。打开研究后，在图片库里点「用模板自带的图片」可以接着复制。`,
          )}
        </Alert>
        <Button variant="contained" onClick={() => open(created.project.id)}>{L('Open the study', '打开研究')}</Button>
      </Box>
    );
  }
  if (created) {
    return (
      <StudioFirstRun
        project={created.project}
        config={created.project._surveyConfig}
        request={created.request}
        mode={isPage ? 'spscheme' : 'agent'}
        title={L('The AI is changing the template as you asked…', 'AI 正在按你的要求修改模板…')}
        onDone={() => open(created.project.id)}
      />
    );
  }

  return (
    <Box data-testid="studio-template-start" sx={{ display: 'flex', flexDirection: 'column', gap: 1.5 }}>
      <Box sx={{ display: 'flex', gap: 1.25, alignItems: 'flex-start', p: 1.5, borderRadius: '12px', bgcolor: 'action.hover', minWidth: 0 }}>
        <ArticleOutlined color="primary" sx={{ mt: 0.25 }} />
        <Box sx={{ minWidth: 0, flex: 1 }}>
          <Typography sx={{ fontWeight: 700, overflowWrap: 'anywhere' }} data-testid="studio-template-name">{template.name}</Typography>
          <Typography variant="body2" color="text.secondary" sx={{ overflowWrap: 'anywhere' }}>
            {[template.author, template.year].filter(Boolean).join(' · ')}
          </Typography>
          <Box sx={{ display: 'flex', gap: 2, flexWrap: 'wrap', mt: 0.5 }}>
            <Link href={`${TEMPLATE_LIBRARY_PATH}?preview=${encodeURIComponent(template.id)}`} target="_blank" rel="noopener" variant="body2" underline="hover">
              {L('Try the template', '试填这个模板')}
            </Link>
            <Link component={RouterLink} to={TEMPLATE_LIBRARY_PATH} variant="body2" underline="hover">
              {L('Choose another template', '换一个模板')}
            </Link>
          </Box>
        </Box>
      </Box>

      {online && (
        <Box>
          <Typography variant="subtitle2" sx={{ mb: 0.75 }}>
            {L('1. What should be different in your study? (optional)', '1. 你的研究想改什么？（可以不填）')}
          </Typography>
          <TextField
            multiline
            minRows={2}
            maxRows={8}
            fullWidth
            value={text}
            disabled={busy}
            onChange={(e) => setText(e.target.value)}
            inputProps={{ 'aria-label': L('What should be different in your study', '你的研究想改什么'), maxLength: 20000 }}
            placeholder={L(
              'For example: use my own street photos, 20 per participant; translate the page to Chinese; drop the income question. Leave empty to use the template as it is.',
              '例如：换成我自己的街景照片，每人看 20 张；页面改成中文；去掉收入那道题。不填就按模板原样开始。',
            )}
          />
        </Box>
      )}

      <Box>
        <Typography variant="subtitle2" sx={{ mb: 0.25 }}>
          {online ? L('2. Images', '2. 图片') : L('Images', '图片')}
        </Typography>
        {imageCount > 0 && online ? (
          <RadioGroup value={images} onChange={(e) => setImages(e.target.value)} aria-label={L('Images', '图片')}>
            <FormControlLabel
              value="template"
              disabled={busy}
              control={<Radio size="small" />}
              label={<Typography variant="body2">{L(`Start with the template's images (${imageCount})`, `先用模板自带的图片（${imageCount} 张）`)}</Typography>}
            />
            <FormControlLabel
              value="own"
              disabled={busy}
              control={<Radio size="small" />}
              label={<Typography variant="body2">{L('Use my own images (upload them after the study opens)', '用我自己的图片（研究打开后上传）')}</Typography>}
            />
          </RadioGroup>
        ) : (
          <Typography variant="body2" color="text.secondary">
            {imageCount > 0
              ? L('Upload your images after the study opens.', '研究打开后上传你的图片。')
              : L('This template has no images. Upload yours after the study opens, if the study needs any.', '这个模板不带图片。如果研究需要图片，打开后再上传。')}
          </Typography>
        )}
      </Box>

      {step === 'copying' && copy && (
        <Box>
          <Typography variant="body2" color="text.secondary" sx={{ mb: 0.5 }}>
            {L(`Copying the template's images ${Math.min(copy.copied, copy.total)}/${copy.total}…`, `正在复制模板的图片 ${Math.min(copy.copied, copy.total)}/${copy.total}…`)}
          </Typography>
          <LinearProgress variant="determinate" value={copy.total ? (100 * Math.min(copy.copied, copy.total)) / copy.total : 0} />
        </Box>
      )}

      {error && <Alert severity="error">{error}</Alert>}

      <Box sx={{ display: 'flex', alignItems: 'center', gap: 1.5, flexWrap: 'wrap' }}>
        <Button variant="contained" onClick={start} disabled={busy} data-testid="studio-template-go">
          {step === 'creating' ? L('Creating…', '正在新建…') : step === 'copying' ? L('Copying images…', '正在复制图片…') : L('Start from this template', '用这个模板开始')}
        </Button>
        <Button color="inherit" onClick={onLeave} disabled={busy}>{L('Start without a template', '不用模板')}</Button>
      </Box>
      <Typography variant="caption" color="text.secondary">
        {online
          ? L('The study opens with the template\'s survey. You can then keep changing it by chatting with the AI assistant, and upload or replace images at any time.', '研究会带着模板的问卷打开。之后可以继续和 AI 助手对话修改，也可以随时上传或更换图片。')
          : L('The study opens with the template\'s survey; you can change it there.', '研究会带着模板的问卷打开，之后可以在里面修改。')}
      </Typography>
    </Box>
  );
}
