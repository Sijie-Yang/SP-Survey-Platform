import React, { useState } from 'react';
import { Alert, Box, Button, Link, Paper, Typography } from '@mui/material';
import { AutoAwesome, ViewListOutlined } from '@mui/icons-material';
import { Link as RouterLink, useNavigate } from 'react-router-dom';
import StreetscapeAtmosphere from '../StreetscapeAtmosphere';
import { setActiveProject } from '../../lib/projectManager';
import { createStudioProject } from '../../lib/studioData';
import { adminProjectPath, studioPathForProject } from '../../lib/adminDeepLink';
import StudioImportFlow from './StudioImport';
import { useL } from './studioUi';

const HERO_HEIGHT = { xs: 260, md: 300 };

/**
 * "What are we researching today?": drop the page an AI built, or build the
 * survey question by question in the classic editor. Two equal choices.
 */
export default function StudioNewStudy({ onProjectsChanged = () => {} }) {
  const L = useL();
  const navigate = useNavigate();
  const [creating, setCreating] = useState(false);
  const [error, setError] = useState('');

  const openClassic = async () => {
    setCreating(true);
    setError('');
    const result = await createStudioProject(L('New study', '新研究'));
    setCreating(false);
    if (!result.success) {
      setError(L(`The study could not be created: ${result.error}`, `没能新建研究：${result.error}`));
      return;
    }
    // The classic editor also opens the active project when the link param is not read.
    setActiveProject(result.project.id);
    onProjectsChanged();
    navigate(adminProjectPath(result.project.id));
  };

  const onImported = ({ projectId }) => {
    onProjectsChanged();
    navigate(studioPathForProject(projectId));
  };

  return (
    <Box sx={{ position: 'relative', minHeight: '100%', bgcolor: 'background.paper' }} data-testid="studio-new">
      <Box sx={{ position: 'absolute', top: 0, left: 0, right: 0, height: HERO_HEIGHT, overflow: 'hidden' }}>
        <StreetscapeAtmosphere />
      </Box>
      <Box sx={{ position: 'relative', zIndex: 1, maxWidth: 1000, mx: 'auto', px: { xs: 2, sm: 3 }, pt: { xs: 4.5, md: 6.5 }, pb: 6 }}>
        <Typography
          component="h1"
          sx={{
            color: '#fff',
            textAlign: 'center',
            fontWeight: 800,
            fontSize: { xs: '1.75rem', sm: '2.2rem', md: '2.5rem' },
            letterSpacing: '-0.03em',
            lineHeight: 1.15,
            textShadow: '0 2px 28px rgba(0,0,0,0.45)',
          }}
        >
          {L('What are we researching today?', '今天要做什么研究？')}
        </Typography>
        <Typography
          sx={{
            color: 'rgba(255,255,255,0.92)',
            textAlign: 'center',
            mt: 1,
            fontSize: { xs: '0.95rem', md: '1.05rem' },
            textShadow: '0 1px 12px rgba(0,0,0,0.4)',
          }}
        >
          {L('Let your AI write the survey page, drop it in, and send it to participants.', '让你的 AI 写好问卷页面，放进来，就能发给参与者。')}
        </Typography>

        <Paper
          elevation={0}
          sx={{
            mt: { xs: 3, md: 4 },
            p: { xs: 2, sm: 3 },
            borderRadius: '20px',
            border: '1px solid',
            borderColor: 'rgba(255,255,255,0.35)',
            bgcolor: 'rgba(255,255,255,0.96)',
            backdropFilter: 'blur(12px)',
            boxShadow: '0 18px 50px rgba(0,0,0,0.18)',
            display: 'grid',
            gridTemplateColumns: { xs: '1fr', md: 'minmax(0, 1.65fr) minmax(0, 1fr)' },
            gap: { xs: 2.5, md: 3 },
          }}
        >
          <Box component="section" aria-labelledby="studio-choice-ai" sx={{ minWidth: 0 }}>
            <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, mb: 1.5 }}>
              <AutoAwesome color="primary" />
              <Typography id="studio-choice-ai" component="h2" variant="h6" sx={{ fontWeight: 700 }}>
                {L('Let AI make the survey', '让 AI 做问卷')}
              </Typography>
            </Box>
            <StudioImportFlow showSteps onImported={onImported} />
          </Box>

          <Box
            component="section"
            aria-labelledby="studio-choice-classic"
            sx={{
              minWidth: 0,
              alignSelf: 'start',
              p: { xs: 2, sm: 2.5 },
              borderRadius: '14px',
              border: '1px solid',
              borderColor: 'divider',
              bgcolor: 'background.default',
              display: 'flex',
              flexDirection: 'column',
              alignItems: 'flex-start',
              gap: 1.5,
            }}
          >
            <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
              <ViewListOutlined color="action" />
              <Typography id="studio-choice-classic" component="h2" variant="h6" sx={{ fontWeight: 700 }}>
                {L('Build it question by question', '自己逐题搭建')}
              </Typography>
            </Box>
            <Typography variant="body2" color="text.secondary">
              {L('No AI needed: build the survey one question at a time in the classic editor. Good for standard question types.', '不用 AI，用经典编辑器一题一题地搭，适合标准题型。')}
            </Typography>
            <Button variant="outlined" onClick={openClassic} disabled={creating} sx={{ bgcolor: 'background.paper' }}>
              {creating ? L('Creating…', '正在新建…') : L('Create and open the classic editor', '新建并打开经典编辑器')}
            </Button>
            <Link component={RouterLink} to="/admin" variant="body2" underline="hover" data-testid="studio-template-link">
              {L('Start from a paper template', '从论文模板开始')}
            </Link>
            {error && <Alert severity="error" sx={{ alignSelf: 'stretch' }}>{error}</Alert>}
          </Box>
        </Paper>
      </Box>
    </Box>
  );
}
