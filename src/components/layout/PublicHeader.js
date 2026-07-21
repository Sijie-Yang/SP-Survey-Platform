import React, { useEffect, useState } from 'react';
import { AppBar, Toolbar, Typography, Button, Box, Container, Tooltip } from '@mui/material';
import { GitHub, Star } from '@mui/icons-material';
import { Link as RouterLink, useLocation } from 'react-router-dom';
import { useGithubStars } from '../../lib/useGithubStars';
import { useRegion } from '../../contexts/RegionContext';
import RegionSwitcher from '../admin/RegionSwitcher';
import { getBenchPublicStatus } from '../../lib/spBenchApi';

export const GITHUB_REPO_URL = 'https://github.com/Sijie-Yang/SP-Survey';

function BrandLogo({ src, alt, height }) {
  return (
    <Box
      component="img"
      src={src}
      alt={alt}
      sx={{ height, objectFit: 'contain', display: 'block', maxWidth: '100%' }}
      onError={(e) => { e.currentTarget.style.display = 'none'; }}
    />
  );
}

/**
 * Shared public-site header (Landing, Papers, Team, Live, Login).
 */
export default function PublicHeader({
  brand = 'SP Survey Platform',
  rightSlot = null,
}) {
  const location = useLocation();
  const githubStars = useGithubStars();
  const { t } = useRegion();
  const isActive = (path) => location.pathname === path;
  const [benchEnabled, setBenchEnabled] = useState(false);

  useEffect(() => {
    let cancelled = false;
    getBenchPublicStatus()
      .then((res) => {
        if (!cancelled) setBenchEnabled(!!res.enabled);
      })
      .catch(() => {
        if (!cancelled) setBenchEnabled(false);
      });
    return () => { cancelled = true; };
  }, []);

  return (
    <AppBar
      position="sticky"
      color="inherit"
      sx={{
        bgcolor: 'background.paper',
        color: 'text.primary',
      }}
    >
      <Container maxWidth="lg" disableGutters sx={{ px: { xs: 2, sm: 3 } }}>
        <Toolbar disableGutters sx={{ minHeight: 64, gap: 1, flexWrap: 'wrap', py: { xs: 1, sm: 0 } }}>
          <Box
            component={RouterLink}
            to="/"
            sx={{
              display: 'flex',
              alignItems: 'center',
              gap: { xs: 1, sm: 1.5 },
              flexGrow: 1,
              textDecoration: 'none',
              color: 'inherit',
              minWidth: 0,
            }}
            aria-label={brand}
          >
            <BrandLogo src="/logo-web-header.png" alt="SP-Survey" height={36} />
          </Box>
          <Button
            component={RouterLink}
            to="/papers"
            color={isActive('/papers') ? 'primary' : 'inherit'}
            sx={{ fontWeight: isActive('/papers') ? 700 : 500 }}
          >
            {t.navPaperLibrary}
          </Button>
          <Button
            component={RouterLink}
            to="/request-template"
            color={isActive('/request-template') ? 'primary' : 'inherit'}
            sx={{ fontWeight: isActive('/request-template') ? 700 : 500 }}
          >
            {t.navRequestTemplate}
          </Button>
          <Button
            component={RouterLink}
            to="/request-survey-design"
            color={isActive('/request-survey-design') ? 'primary' : 'inherit'}
            sx={{ fontWeight: isActive('/request-survey-design') ? 700 : 500 }}
          >
            {t.navRequestDesign}
          </Button>
          <Button
            component={RouterLink}
            to="/team"
            color={isActive('/team') ? 'primary' : 'inherit'}
            sx={{ fontWeight: isActive('/team') ? 700 : 500 }}
          >
            {t.navTeam}
          </Button>
          <Button
            component={RouterLink}
            to="/live"
            color={isActive('/live') ? 'primary' : 'inherit'}
            sx={{ fontWeight: isActive('/live') ? 700 : 500 }}
          >
            {t.navLiveSurveys}
          </Button>
          {benchEnabled && (
            <Button
              component={RouterLink}
              to="/bench"
              color={isActive('/bench') ? 'primary' : 'inherit'}
              sx={{ fontWeight: isActive('/bench') ? 700 : 500 }}
            >
              {t.navSpBench || 'SP-Bench'}
            </Button>
          )}
          <RegionSwitcher variant="public" />
          <Tooltip title="GitHub repository">
            <Box
              component="a"
              href={GITHUB_REPO_URL}
              target="_blank"
              rel="noopener noreferrer"
              aria-label="GitHub"
              sx={{
                display: 'inline-flex',
                alignItems: 'center',
                gap: 0.5,
                px: 1,
                py: 0.4,
                borderRadius: 2,
                border: '1px solid',
                borderColor: 'divider',
                color: 'text.primary',
                textDecoration: 'none',
                '&:hover': { bgcolor: 'action.hover', borderColor: 'text.secondary' },
              }}
            >
              <GitHub sx={{ fontSize: '1.1rem' }} />
              <Star sx={{ fontSize: '0.95rem', color: '#e6b800' }} />
              <Typography variant="body2" sx={{ fontWeight: 700, fontSize: '0.8rem', lineHeight: 1 }}>
                {githubStars !== null ? githubStars : '…'}
              </Typography>
            </Box>
          </Tooltip>
          <Button
            component={RouterLink}
            to="/login"
            variant={isActive('/login') ? 'contained' : 'outlined'}
            size="small"
          >
            {t.navResearcherLogin}
          </Button>
          {rightSlot}
        </Toolbar>
      </Container>
    </AppBar>
  );
}

export function PublicFooter() {
  const { t } = useRegion();
  return (
    <Box
      component="footer"
      sx={{
        py: 4,
        mt: 'auto',
        borderTop: '1px solid',
        borderColor: 'divider',
        bgcolor: 'background.paper',
        textAlign: 'center',
      }}
    >
      <Container maxWidth="lg">
        <Box
          component="img"
          src="/logo-long.png"
          alt="SP-Survey"
          sx={{ height: 28, objectFit: 'contain', mb: 1.5, opacity: 0.75 }}
          onError={(e) => { e.currentTarget.style.display = 'none'; }}
        />
        <Typography variant="body2" color="text.secondary" align="center">
          {t.footerDevelopedBy}{' '}
          <Box
            component="a"
            href="https://ual.sg"
            target="_blank"
            rel="noopener noreferrer"
            sx={{ color: 'primary.main', textDecoration: 'none', fontWeight: 600 }}
          >
            Urban Analytics Lab, NUS
          </Box>
          {' · '}
          <Box
            component="a"
            href={GITHUB_REPO_URL}
            target="_blank"
            rel="noopener noreferrer"
            sx={{ color: 'primary.main', textDecoration: 'none', fontWeight: 600 }}
          >
            GitHub
          </Box>
        </Typography>
      </Container>
    </Box>
  );
}
