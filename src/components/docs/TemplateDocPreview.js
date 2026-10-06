import React, { lazy, Suspense, useMemo, useState } from 'react';
import { Box, Button, CircularProgress, Dialog, DialogContent, DialogTitle, Stack, Typography, useMediaQuery, useTheme } from '@mui/material';
import { toAdminPreviewProject } from '../../lib/adminPreviewProject';
import { surveyUsesSampledMedia } from '../../lib/previewMediaLibrary';
const SurveyPreview = lazy(() => import('../admin/SurveyPreview'));

/** Full template, with its own media and folder/set metadata, using the shared preview renderer. */
export default function TemplateDocPreview({ template, doc, language, onClose }) {
  const zh = language === 'zh';
  const theme = useTheme();
  const fullScreen = useMediaQuery(theme.breakpoints.down('sm'));
  const [mobile, setMobile] = useState(false);
  const project = useMemo(() => toAdminPreviewProject({ ...template, id: `docs-template-${doc.id}` }), [template, doc.id]);
  const usesMedia = surveyUsesSampledMedia(template?.config);
  return <Dialog open fullScreen={fullScreen} onClose={onClose} maxWidth="lg" fullWidth aria-labelledby="template-doc-preview-title" PaperProps={{ sx: { height: fullScreen ? '100dvh' : '90vh' } }}>
    <DialogTitle id="template-doc-preview-title">{zh ? '完整模板预览' : 'Full template preview'} · {doc.name}</DialogTitle>
    <Stack direction="row" gap={1} flexWrap="wrap" sx={{ px: 3, pb: 1 }}>
      <Button onClick={() => setMobile(v => !v)}>{mobile ? (zh ? '桌面宽度' : 'Desktop width') : (zh ? '手机宽度' : 'Mobile width')}</Button>
      <Button onClick={onClose} sx={{ ml: 'auto' }}>{zh ? '关闭模板预览' : 'Close template preview'}</Button>
    </Stack>
    <Typography variant="body2" color="text.secondary" sx={{ px: 3, pb: 2 }}>{usesMedia
      ? (zh ? '完整问卷 · 只读预览，不保存回答。优先使用模板媒体；缺少媒体时使用平台预览库，素材不足会在预览中提示。' : 'Full questionnaire · Read-only; answers are not saved. Uses template media first, then the platform preview library. Missing media are indicated in the preview.')
      : (zh ? '完整问卷 · 只读预览，不保存回答。这份模板不从图片库抽题。' : 'Full questionnaire · Read-only; answers are not saved. This template does not draw questions from an image library.')}</Typography>
    <DialogContent sx={{ p: 0, bgcolor: 'background.default' }}>
      <Box sx={{ width: mobile ? 390 : '100%', maxWidth: '100%', mx: 'auto', bgcolor: 'background.paper', minHeight: '100%' }}>
        <Suspense fallback={<Box sx={{ p: 4, textAlign: 'center' }}><CircularProgress aria-label={zh ? '正在加载模板预览' : 'Loading template preview'} /></Box>}>
          <SurveyPreview config={template.config} currentProject={project} showMediaAssignment={false} />
        </Suspense>
      </Box>
    </DialogContent>
  </Dialog>;
}
