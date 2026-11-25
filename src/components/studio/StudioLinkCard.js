import React, { useState } from 'react';
import {
  Box,
  Button,
  Dialog,
  DialogActions,
  DialogContent,
  DialogTitle,
  Divider,
  IconButton,
  Tooltip,
  Typography,
} from '@mui/material';
import { CheckCircle, ContentCopy, GroupAddOutlined, QrCode2 } from '@mui/icons-material';
import SurveyQrCode from '../admin/SurveyQrCode';
import RecruitmentSettings from '../admin/RecruitmentSettings';
import RecruitmentLinks from '../admin/RecruitmentLinks';
import CustomSurveyLink from '../admin/CustomSurveyLink';
import { legacySurveyShareUrl, surveyShareUrl } from '../../lib/publicSlug';
import { projectStatus } from '../../lib/studioProject';
import { StudioCard, useL } from './studioUi';

/** The participant link, its QR code, recruitment platforms and a short link. */
export default function StudioLinkCard({ project, config, localMode = false, onSaveConfig, onProjectChanged }) {
  const L = useL();
  const [copied, setCopied] = useState(false);
  const [dialog, setDialog] = useState('');
  const status = projectStatus(project);
  const live = localMode || status.state !== 'draft';
  const origin = window.location.origin;
  const url = localMode ? legacySurveyShareUrl(origin, project.id) : surveyShareUrl(origin, { id: project.id, publicSlug: project.publicSlug });

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(url);
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch {
      // The link stays selectable on screen.
    }
  };

  return (
    <StudioCard title={L('Link', '链接')} data-testid="studio-link">
      {!live ? (
        <Box sx={{ bgcolor: 'action.hover', borderRadius: '8px', px: 1.5, py: 1.25 }}>
          <Typography variant="body2" color="text.secondary">
            {L('After you publish, the participant link and QR code appear here.', '发布后这里出现参与者链接和二维码。')}
          </Typography>
        </Box>
      ) : (
        <>
          <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.5, bgcolor: 'action.hover', borderRadius: '8px', pl: 1.5, pr: 0.5, py: 0.5 }}>
            <Typography
              component="a"
              href={url}
              target="_blank"
              rel="noopener noreferrer"
              data-testid="studio-share-url"
              sx={{ flex: 1, minWidth: 0, fontFamily: 'ui-monospace, Menlo, monospace', fontSize: 13, wordBreak: 'break-all', color: 'text.primary', textDecoration: 'none', '&:hover': { textDecoration: 'underline' } }}
            >
              {url}
            </Typography>
            <Tooltip title={copied ? L('Copied', '已复制') : L('Copy link', '复制链接')}>
              <IconButton size="small" onClick={copy} aria-label={L('Copy link', '复制链接')}>
                {copied ? <CheckCircle color="success" fontSize="small" /> : <ContentCopy fontSize="small" />}
              </IconButton>
            </Tooltip>
          </Box>
          {!localMode && status.state === 'pending' && (
            <Typography variant="body2" color="warning.dark" sx={{ mt: 1 }} data-testid="studio-link-pending">
              {L(`Participants now see v${status.version}. Your changes take effect after you publish.`, `参与者现在看到的是 v${status.version}；你的修改发布后才生效。`)}
            </Typography>
          )}
          <Box sx={{ display: 'flex', gap: 1, flexWrap: 'wrap', mt: 1.5 }}>
            <Button size="small" variant="outlined" startIcon={<QrCode2 />} onClick={() => setDialog('qr')}>
              {L('QR code', '二维码')}
            </Button>
            <Button size="small" variant="outlined" startIcon={<GroupAddOutlined />} onClick={() => setDialog('more')}>
              {L('Recruitment and short link', '招募与短链接')}
            </Button>
          </Box>
        </>
      )}

      <Dialog open={dialog === 'qr'} onClose={() => setDialog('')} maxWidth="xs" fullWidth>
        <DialogTitle sx={{ fontWeight: 700 }}>{L('QR code', '二维码')}</DialogTitle>
        <DialogContent>
          <SurveyQrCode surveyUrl={url} projectId={project.id} projectName={project.name} />
        </DialogContent>
        <DialogActions sx={{ px: 3, pb: 2 }}>
          <Button onClick={() => setDialog('')}>{L('Done', '完成')}</Button>
        </DialogActions>
      </Dialog>

      <Dialog open={dialog === 'more'} onClose={() => setDialog('')} maxWidth="sm" fullWidth>
        <DialogTitle sx={{ fontWeight: 700 }}>{L('Recruitment and short link', '招募与短链接')}</DialogTitle>
        <DialogContent sx={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
          <RecruitmentSettings config={config} onChange={(field, value) => onSaveConfig({ ...config, [field]: value })} />
          <RecruitmentLinks surveyUrl={url} surveyConfig={config} projectId={project.id} />
          {!localMode && (
            <>
              <Divider />
              <CustomSurveyLink projectId={project.id} savedSlug={project.publicSlug || ''} onSaved={onProjectChanged} />
            </>
          )}
        </DialogContent>
        <DialogActions sx={{ px: 3, pb: 2 }}>
          <Button onClick={() => setDialog('')}>{L('Done', '完成')}</Button>
        </DialogActions>
      </Dialog>
    </StudioCard>
  );
}
