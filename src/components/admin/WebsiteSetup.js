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

export default function WebsiteSetup({ currentProject, surveyConfig }) {
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
      <Typography variant="h5" sx={{ mb: 1, color: 'primary.main' }}>
        🔗 Share Your Survey
      </Typography>
      <Typography variant="body2" color="text.secondary" sx={{ mb: 3 }}>
        Your survey is already live. Copy the link below and share it with participants.
        No deployment required.
      </Typography>

      {/* Survey Link Card */}
      <Card sx={{ mb: 3, border: '2px solid', borderColor: 'primary.main' }}>
        <CardContent>
          <Typography variant="subtitle1" fontWeight={700} sx={{ mb: 2, display: 'flex', alignItems: 'center', gap: 1 }}>
            <LinkIcon color="primary" />
            Your Survey Link
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
                  {copied ? 'Copied!' : 'Copy Link'}
                </Button>
                <Button
                  variant="outlined"
                  startIcon={<OpenInNew />}
                  href={surveyUrl}
                  target="_blank"
                  rel="noopener noreferrer"
                >
                  Open Survey
                </Button>
              </Box>
            </>
          ) : (
            <Alert severity="warning">
              No project selected. Please select or create a project first.
            </Alert>
          )}
        </CardContent>
      </Card>

      {/* Tips */}
      <Card sx={{ mb: 3 }}>
        <CardContent>
          <Typography variant="subtitle1" fontWeight={700} sx={{ mb: 2 }}>
            💡 Sharing Tips
          </Typography>
          <List dense>
            <ListItem>
              <ListItemIcon><CheckCircle color="success" fontSize="small" /></ListItemIcon>
              <ListItemText
                primary="Share the link directly"
                secondary="Send it via email, WeChat, Slack, or any other channel"
              />
            </ListItem>
            <ListItem>
              <ListItemIcon><CheckCircle color="success" fontSize="small" /></ListItemIcon>
              <ListItemText
                primary="Embed in a QR code"
                secondary="Use any free QR code generator (e.g. qr-code-generator.com) to create a scannable code"
              />
            </ListItem>
            <ListItem>
              <ListItemIcon><CheckCircle color="success" fontSize="small" /></ListItemIcon>
              <ListItemText
                primary="The link always stays up-to-date"
                secondary="Any changes you save are instantly reflected for participants — no re-deployment needed"
              />
            </ListItem>
            <ListItem>
              <ListItemIcon><CheckCircle color="success" fontSize="small" /></ListItemIcon>
              <ListItemText
                primary="Responses are saved automatically"
                secondary="Results go to Supabase in real time and can be viewed in the Results Analysis tab"
              />
            </ListItem>
          </List>
        </CardContent>
      </Card>

      <Divider sx={{ my: 3 }} />

      {/* Admin link */}
      <Card>
        <CardContent>
          <Typography variant="subtitle1" fontWeight={700} sx={{ mb: 1 }}>
            🔒 Admin Panel Link
          </Typography>
          <Typography variant="body2" color="text.secondary" sx={{ mb: 2 }}>
            Share this link with collaborators who need to edit the survey. They will need to sign in.
          </Typography>
          <Box sx={{ display: 'flex', gap: 2, flexWrap: 'wrap' }}>
            <Button
              variant="outlined"
              startIcon={<ContentCopy />}
              onClick={() => copy(`${origin}/admin`)}
            >
              Copy Admin Link
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
