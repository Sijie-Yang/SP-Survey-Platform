import SurveyQrCode from './SurveyQrCode';
import CustomSurveyLink from './CustomSurveyLink';
import { legacySurveyShareUrl, surveyShareUrl } from '../../lib/publicSlug';
import { isChineseLanguage, uiPair } from '../../lib/uiLanguages';
import ParameterLinks from './ParameterLinks';
import SurveyPreflight from './SurveyPreflight';
import ProjectVersions from './ProjectVersions';
import { validateSurveyConfig } from '../../lib/designProtocol/validate';
import { markGuideProgress } from '../../lib/adminGuide';
import React, { useEffect, useState } from 'react';
import { Box, Typography, Alert, Button, Card, Paper, Dialog, DialogTitle, DialogContent, DialogActions, CardContent, Divider, List, ListItem, ListItemIcon, ListItemText } from '@mui/material';
import { ContentCopy, Launch, CheckCircle, Link as LinkIcon, OpenInNew, History, FactCheckOutlined, Tune, HelpOutline } from '@mui/icons-material';
import { captureParamNames, normalizeConditions } from '../../lib/surveyRuntimeContext';
import { useRegion } from '../../contexts/RegionContext';
import { AdminActionBar, AdminActionButton, AdminPageHeader } from './AdminPageLayout';
import OwnResponseSupabaseCard from './OwnResponseSupabaseCard';
export default function WebsiteSetup({
  currentProject,
  surveyConfig,
  hasUnsavedChanges = false,
  onReleased,
  onProjectUpdated,
}) {
  const {
    t,
    language
  } = useRegion();
  const zh = isChineseLanguage(language);
  const report = validateSurveyConfig(surveyConfig);
  const questions = (surveyConfig?.pages || []).flatMap(p => p.elements || []);
  const answerable = questions.filter(q => !['html', 'expression', 'image', 'mediadisplay'].includes(q.type));
  const issues = [...report.errors, ...report.warnings];
  const [copied, setCopied] = useState(false);
  const [shareDialog, setShareDialog] = useState(null);
  const [savedSlug, setSavedSlug] = useState(currentProject?.publicSlug || '');
  const hasParameterLinks = captureParamNames(surveyConfig).length > 0 || normalizeConditions(surveyConfig).length > 1;
  const shareTools = [['versions', uiPair(language, 'Versions & release', '版本与发布'), <History />], ['checks', uiPair(language, 'Pre-share checks', '分享前检查'), <FactCheckOutlined />], ...(hasParameterLinks ? [['parameters', uiPair(language, 'Parameter links', '参数链接'), <Tune />]] : []), ['help', uiPair(language, 'Sharing guide', '分享指南'), <HelpOutline />]];
  const origin = window.location.origin;
  useEffect(() => {
    setSavedSlug(currentProject?.publicSlug || '');
  }, [currentProject?.id, currentProject?.publicSlug]);
  const surveyUrl = currentProject ? surveyShareUrl(origin, { id: currentProject.id, publicSlug: savedSlug }) : null;
  const legacyUrl = currentProject ? legacySurveyShareUrl(origin, currentProject.id) : null;
  const copy = async text => {
    try {
      await navigator.clipboard.writeText(text);
      markGuideProgress(currentProject?.id, 'shared');
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      alert('Please copy the link manually.');
    }
  };
  return <Box>
      <AdminPageHeader icon={<LinkIcon />} title={t.shareYourLink} description={t.shareDescription} />
      <AdminActionBar label={t.shareYourLink} primaryAction={<Button size="small" variant="contained" startIcon={copied ? <CheckCircle /> : <ContentCopy />} disabled={!surveyUrl} onClick={() => copy(surveyUrl)} color={copied ? 'success' : 'primary'}>
            {copied ? t.shareCopied : t.shareCopyLink}
          </Button>}>
        {shareTools.map(([id, label, icon]) => <AdminActionButton key={id} startIcon={icon} aria-haspopup="dialog" onClick={() => setShareDialog(id)}>{label}</AdminActionButton>)}
        <OwnResponseSupabaseCard
          currentProject={currentProject}
          onSaved={(ownResponseSupabase) => onProjectUpdated?.({ ownResponseSupabase })}
        />
        <AdminActionButton startIcon={<OpenInNew />} disabled={!surveyUrl} href={surveyUrl || undefined} onClick={() => markGuideProgress(currentProject.id, 'shared')} target="_blank" rel="noopener noreferrer">
          {t.shareOpenSurvey}
        </AdminActionButton>
      </AdminActionBar>
      <Paper variant="outlined" sx={{
      p: {
        xs: 2,
        sm: 3
      },
      borderRadius: 1.5
    }}>
        <Box>
          {surveyUrl ? <Box sx={{
          display: 'grid',
          gridTemplateColumns: {
            xs: 'minmax(0, 1fr)',
            md: 'minmax(0, 1fr) 232px'
          },
          gap: 3,
          alignItems: 'start'
        }}>
              <Box sx={{
            minWidth: 0
          }}>
                <CustomSurveyLink
                  projectId={currentProject.id}
                  savedSlug={savedSlug}
                  onSaved={setSavedSlug}
                />
                <Box sx={{
              p: 2,
              bgcolor: 'action.hover',
              borderRadius: 1,
              fontFamily: 'monospace',
              fontSize: '0.9rem',
              wordBreak: 'break-all',
              mb: 2
            }}>
                  {surveyUrl}
                </Box>
                {savedSlug && legacyUrl && legacyUrl !== surveyUrl && <Typography variant="body2" color="text.secondary" sx={{ mb: 2 }}>
                  {t.shareCustomLinkKeepId}{' '}
                  <Box component="span" sx={{ fontFamily: 'monospace', wordBreak: 'break-all' }}>{legacyUrl}</Box>
                </Typography>}

                {['localhost', '127.0.0.1', '[::1]'].includes(new URL(surveyUrl).hostname) && <Alert severity="info" sx={{
              mt: 2
            }}>{t.shareQrLocalHint}</Alert>}
                <Box sx={{
              mt: 2
            }}>
                  {currentProject && <Typography variant="body2" color="text.secondary" sx={{
                mt: 1
              }}>
                    {currentProject.releaseManaged ? zh ? `当前发布 v${currentProject.publishedVersion} · 发布新版本后更新参与者问卷。` : `Live: v${currentProject.publishedVersion} · Publish a new version to update the survey.` : uiPair(language, 'Saved changes update the live survey.', '保存后即更新参与者问卷。')}
                  </Typography>}
                  {(!answerable.length || issues.length > 0) && <Alert severity="warning" sx={{
                mt: 2
              }}>
                    {!answerable.length && <Typography variant="body2">{uiPair(language, 'This survey has no answerable questions. Add questions before inviting participants.', '问卷还没有作答题，请先在题目设置中完善。')}</Typography>}
                    {issues.slice(0, 5).map((issue, i) => <Typography key={i} variant="body2">{issue.message}</Typography>)}
                  </Alert>}
                  {hasUnsavedChanges && <Alert severity="warning" sx={{
                mt: 2
              }}>{uiPair(language, 'There are unsaved changes. Wait for the toolbar to show saved before sending the share link.', '当前有未保存的修改。请确认顶部显示已保存，再发送分享链接。')}</Alert>}
                </Box>
              </Box>
              <SurveyQrCode key={surveyUrl} surveyUrl={surveyUrl} projectId={currentProject.id} projectName={currentProject.name} />
            </Box> : <Alert severity="warning">
              {t.shareNoProject}
            </Alert>}
        </Box>
      </Paper>

      {shareTools.map(([id, label]) => <Dialog key={id} open={shareDialog === id} onClose={() => setShareDialog(null)} keepMounted fullWidth maxWidth="md">
          <DialogTitle>{label}</DialogTitle>
          <DialogContent dividers>
            {id === 'parameters' && <ParameterLinks surveyUrl={surveyUrl} surveyConfig={surveyConfig} projectId={currentProject?.id} />}
            {id === 'checks' && <SurveyPreflight surveyConfig={surveyConfig} currentProject={currentProject} />}
            {id === 'versions' && <ProjectVersions currentProject={currentProject} hasUnsavedChanges={hasUnsavedChanges} onReleased={onReleased} />}
            {id === 'help' && <>
      <Card sx={{
            mb: 3
          }}>
        <CardContent>
          <Typography variant="subtitle1" fontWeight={700} sx={{
                mb: 2
              }}>
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

      <Divider sx={{
            my: 3
          }} />

      <Card>
        <CardContent>
          <Typography variant="subtitle1" fontWeight={700} sx={{
                mb: 1
              }}>
            {t.shareAdminLink}
          </Typography>
          <Typography variant="body2" color="text.secondary" sx={{
                mb: 2
              }}>
            {t.shareAdminHelp}
          </Typography>
          <Box sx={{
                display: 'flex',
                gap: 2,
                flexWrap: 'wrap'
              }}>
            <Button variant="outlined" startIcon={<ContentCopy />} onClick={() => copy(`${origin}/admin`)}>
              {t.shareCopyAdmin}
            </Button>
            <Button variant="text" startIcon={<Launch />} href={`${origin}/admin`} target="_blank">
              {origin}/admin
            </Button>
          </Box>
        </CardContent>
      </Card>
            </>}
          </DialogContent>
          <DialogActions><Button onClick={() => setShareDialog(null)}>{t.resultsClose}</Button></DialogActions>
        </Dialog>)}
    </Box>;
}