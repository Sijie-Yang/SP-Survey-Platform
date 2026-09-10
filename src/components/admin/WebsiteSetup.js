import SurveyQrCode from './SurveyQrCode';
import SurveyPreflight from './SurveyPreflight';
import ProjectVersions from './ProjectVersions';
import { validateSurveyConfig } from '../../lib/designProtocol/validate';
import { getTrialCount } from '../../lib/trialNavigation';
import React, { useState } from 'react';
import {
  Box,
  Typography,
  Alert,
  Button,
  Card,
  CardContent,
  Divider,
  List,
  ListItem,
  ListItemIcon,
  ListItemText,
} from '@mui/material';
import {
  ContentCopy,
  Launch,
  CheckCircle,
  Link as LinkIcon,
  OpenInNew,
} from '@mui/icons-material';
import { AdminPageHeader } from './AdminPageLayout';
import { useRegion } from '../../contexts/RegionContext';

export default function WebsiteSetup({ currentProject, surveyConfig, hasUnsavedChanges = false, onReleased }) {
  const { t, language } = useRegion();
  const zh = language === 'zh';
  const report = validateSurveyConfig(surveyConfig);
  const questions = (surveyConfig?.pages || []).flatMap((p) => p.elements || []);
  const answerable = questions.filter((q) => !['html', 'expression', 'image', 'mediadisplay'].includes(q.type));
  const rounds = answerable.reduce((sum, q) => sum + getTrialCount(q), 0);
  const issues = [...report.errors, ...report.warnings];
  const [copied, setCopied] = useState(false);

  const origin = window.location.origin;
  const surveyUrl = currentProject
    ? `${origin}/survey?project=${encodeURIComponent(currentProject.id)}`
    : null;

  const copy = async (text) => {
    try {
      await navigator.clipboard.writeText(text);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      alert('Please copy the link manually.');
    }
  };

  return (
    <Box>
      <AdminPageHeader
        icon={<LinkIcon />}
        title={t.shareTitle}
        description={t.shareDescription}
      />

      <Card sx={{ mb: 3, border: '2px solid', borderColor: 'primary.main' }}>
        <CardContent>
          <Typography variant="subtitle1" fontWeight={700} sx={{ mb: 2, display: 'flex', alignItems: 'center', gap: 1 }}>
            <LinkIcon color="primary" />
            {t.shareYourLink}
          </Typography>

          {surveyUrl ? (
            <Box sx={{ display: 'grid', gridTemplateColumns: { xs: 'minmax(0, 1fr)', md: 'minmax(0, 1fr) 232px' }, gap: 3, alignItems: 'start' }}>
              <Box sx={{ minWidth: 0 }}>
                <Box
                  sx={{
                    p: 2,
                    bgcolor: 'grey.50',
                    borderRadius: 1,
                    border: '1px solid',
                    borderColor: 'divider',
                    fontFamily: 'monospace',
                    fontSize: '0.9rem',
                    wordBreak: 'break-all',
                    mb: 2,
                  }}
                >
                  {surveyUrl}
                </Box>

                <Box sx={{ display: 'flex', gap: 2, flexWrap: 'wrap' }}>
                  <Button
                    variant="contained"
                    startIcon={copied ? <CheckCircle /> : <ContentCopy />}
                    onClick={() => copy(surveyUrl)}
                    color={copied ? 'success' : 'primary'}
                  >
                    {copied ? t.shareCopied : t.shareCopyLink}
                  </Button>
                  <Button
                    variant="outlined"
                    startIcon={<OpenInNew />}
                    href={surveyUrl}
                    target="_blank"
                    rel="noopener noreferrer"
                  >
                    {t.shareOpenSurvey}
                  </Button>
                </Box>
                {['localhost', '127.0.0.1', '[::1]'].includes(new URL(surveyUrl).hostname) && <Alert severity="info" sx={{ mt: 2 }}>{t.shareQrLocalHint}</Alert>}
              </Box>
              <SurveyQrCode key={surveyUrl} surveyUrl={surveyUrl} projectId={currentProject.id} projectName={currentProject.name} />
            </Box>
          ) : (
            <Alert severity="warning">
              {t.shareNoProject}
            </Alert>
          )}
        </CardContent>
      </Card>

      <Alert severity={!answerable.length || report.errors.length ? 'warning' : 'info'} sx={{ mb: 2 }}>
        {zh ? `${report.pageCount} 页 · ${answerable.length} 道作答题 · 共 ${rounds} 轮` : `${report.pageCount} pages · ${answerable.length} answerable questions · ${rounds} rounds`}
        {!answerable.length && <Typography variant="body2">{zh ? '问卷还没有作答题，请先在题目设置中完善。' : 'This survey has no answerable questions. Add questions before inviting participants.'}</Typography>}
        {issues.slice(0, 5).map((issue, i) => <Typography key={i} variant="body2">• {issue.message}</Typography>)}
      </Alert>
      {hasUnsavedChanges && <Alert severity="warning" sx={{ mb: 2 }}>{zh ? '当前有未保存的修改。请确认顶部显示已保存，再发送分享链接。' : 'There are unsaved changes. Wait for the toolbar to show saved before sending the share link.'}</Alert>}
      <SurveyPreflight surveyConfig={surveyConfig} currentProject={currentProject} />
      <ProjectVersions currentProject={currentProject} hasUnsavedChanges={hasUnsavedChanges} onReleased={onReleased} />

      <Card sx={{ mb: 3 }}>
        <CardContent>
          <Typography variant="subtitle1" fontWeight={700} sx={{ mb: 2 }}>
            {t.shareTips}
          </Typography>
          <List dense>
            <ListItem>
              <ListItemIcon><CheckCircle color="success" fontSize="small" /></ListItemIcon>
              <ListItemText primary={t.shareTip1Primary} secondary={t.shareTip1Secondary} />
            </ListItem>
            <ListItem>
              <ListItemIcon><CheckCircle color="success" fontSize="small" /></ListItemIcon>
              <ListItemText primary={t.shareTip2Primary} secondary={t.shareTip2Secondary} />
            </ListItem>
            <ListItem>
              <ListItemIcon><CheckCircle color="success" fontSize="small" /></ListItemIcon>
              <ListItemText primary={t.shareTip3Primary} secondary={t.shareTip3Secondary} />
            </ListItem>
            <ListItem>
              <ListItemIcon><CheckCircle color="success" fontSize="small" /></ListItemIcon>
              <ListItemText primary={t.shareTip4Primary} secondary={t.shareTip4Secondary} />
            </ListItem>
          </List>
        </CardContent>
      </Card>

      <Divider sx={{ my: 3 }} />

      <Card>
        <CardContent>
          <Typography variant="subtitle1" fontWeight={700} sx={{ mb: 1 }}>
            {t.shareAdminLink}
          </Typography>
          <Typography variant="body2" color="text.secondary" sx={{ mb: 2 }}>
            {t.shareAdminHelp}
          </Typography>
          <Box sx={{ display: 'flex', gap: 2, flexWrap: 'wrap' }}>
            <Button
              variant="outlined"
              startIcon={<ContentCopy />}
              onClick={() => copy(`${origin}/admin`)}
            >
              {t.shareCopyAdmin}
            </Button>
            <Button variant="text" startIcon={<Launch />} href={`${origin}/admin`} target="_blank">
              {origin}/admin
            </Button>
          </Box>
        </CardContent>
      </Card>
    </Box>
  );
}
