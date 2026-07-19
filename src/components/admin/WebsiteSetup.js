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

export default function WebsiteSetup({ currentProject, surveyConfig }) {
  const { t } = useRegion();
  const [copied, setCopied] = useState(false);

  const origin = window.location.origin;
  const surveyUrl = currentProject
    ? `${origin}/survey?project=${currentProject.id}`
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
            <>
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
            </>
          ) : (
            <Alert severity="warning">
              {t.shareNoProject}
            </Alert>
          )}
        </CardContent>
      </Card>

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
