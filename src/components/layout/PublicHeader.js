import React, { useEffect, useState } from 'react';
import { AppBar, Toolbar, Typography, Button, Box, Container, Tooltip, IconButton, Menu, MenuItem, Divider, useMediaQuery } from '@mui/material';
import { GitHub, Star, Menu as MenuIcon } from '@mui/icons-material';
import { Link as RouterLink, useLocation } from 'react-router-dom';
import { useAuth } from '../../contexts/AuthContext';
import { researcherEntryPath } from '../../lib/researcherEntry';
import { useGithubStars } from '../../lib/useGithubStars';
import { useRegion } from '../../contexts/RegionContext';
import RegionSwitcher from '../admin/RegionSwitcher';
import { UI_LANGUAGES, isChineseLanguage, uiPair } from '../../lib/uiLanguages';
import { getBenchPublicStatus } from '../../lib/spBenchApi';
export const GITHUB_REPO_URL = 'https://github.com/Sijie-Yang/SP-Survey';
function BrandLogo({
  src,
  alt,
  height
}) {
  return <Box component="img" src={src} alt={alt} sx={{
    height,
    objectFit: 'contain',
    display: 'block',
    maxWidth: '100%'
  }} onError={e => {
    e.currentTarget.style.display = 'none';
  }} />;
}

/**
 * Shared public-site header (Landing, Papers, Team, Live, Login).
 */
export default function PublicHeader({
  brand = 'SP Survey Platform',
  rightSlot = null
}) {
  const location = useLocation();
  const { isAuthenticated, loading: authLoading } = useAuth();
  const signedIn = !authLoading && isAuthenticated;
  const entryPath = researcherEntryPath(signedIn);
  const githubStars = useGithubStars();
  const {
    t,
    language,
    setLanguage
  } = useRegion();
  const wideNavigation = useMediaQuery('(min-width: 1400px)');
  const [menuAnchor, setMenuAnchor] = useState(null);
  const isActive = path => location.pathname === path;
  const [benchEnabled, setBenchEnabled] = useState(false);
  useEffect(() => {
    let cancelled = false;
    getBenchPublicStatus().then(res => {
      if (!cancelled) setBenchEnabled(!!res.enabled);
    }).catch(() => {
      if (!cancelled) setBenchEnabled(false);
    });
    return () => {
      cancelled = true;
    };
  }, []);
  const navigationItems = [['/docs', t.navDocs], ['/papers', t.navPaperLibrary], ['/news', t.navNews], ['/request-template', t.navRequestTemplate], ['/request-survey-design', t.navRequestDesign], ['/team', t.navTeam], ['/live', t.navLiveSurveys], ...(benchEnabled ? [['/bench', t.navSpBench || 'SP-Bench']] : [])];
  const activeItem = path => isActive(path) || location.pathname.startsWith(`${path}/`);
  useEffect(() => {
    setMenuAnchor(null);
  }, [location.pathname, wideNavigation]);
  const githubLink = <Tooltip title="GitHub repository">
      <Box component="a" href={GITHUB_REPO_URL} target="_blank" rel="noopener noreferrer" aria-label="GitHub" sx={{
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
      whiteSpace: 'nowrap',
      flexShrink: 0,
      '&:hover': {
        bgcolor: 'action.hover',
        borderColor: 'text.secondary'
      }
    }}>
        <GitHub sx={{
        fontSize: '1.1rem'
      }} />
        <Star sx={{
        fontSize: '0.95rem',
        color: '#e6b800'
      }} />
        <Typography variant="body2" sx={{
        fontWeight: 700,
        fontSize: '0.8rem',
        lineHeight: 1,
        minWidth: '5ch',
        textAlign: 'center',
        fontVariantNumeric: 'tabular-nums'
      }}>{githubStars !== null ? githubStars : '…'}</Typography>
      </Box>
    </Tooltip>;
  return <AppBar position="sticky" color="inherit" sx={{
    bgcolor: 'background.paper',
    color: 'text.primary'
  }}>
      <Container maxWidth="xl" disableGutters sx={{
      px: {
        xs: 1.5,
        sm: 3
      }
    }}>
        <Toolbar disableGutters sx={{
        minHeight: 64,
        gap: {
          xs: 0.75,
          sm: 1.5
        },
        flexWrap: 'nowrap'
      }}>
          <Box component={RouterLink} to="/" aria-label={brand} sx={{
          display: 'flex',
          alignItems: 'center',
          width: {
            xs: 110,
            sm: 164
          },
          flexShrink: 0,
          mr: 'auto',
          textDecoration: 'none',
          color: 'inherit'
        }}>
            <BrandLogo src="/logo-web-header.png" alt="SP-Survey" height={36} />
          </Box>
          {wideNavigation && <Box component="nav" aria-label={uiPair(language, 'Site navigation', '网站导航')} sx={{
          display: 'flex',
          alignItems: 'center',
          gap: 0.5,
          flexShrink: 0
        }}>
            {navigationItems.map(([path, label]) => <Button key={path} component={RouterLink} to={path} color={activeItem(path) ? 'primary' : 'inherit'} aria-current={activeItem(path) ? 'page' : undefined} sx={{
            fontWeight: 600,
            whiteSpace: 'nowrap',
            minWidth: 0,
            px: 1
          }}>{label}</Button>)}
          </Box>}
          {wideNavigation && <><RegionSwitcher variant="public" />{githubLink}</>}
          <Button component={RouterLink} to={entryPath} variant="outlined" size="small" aria-current={isActive(entryPath) ? 'page' : undefined} sx={{
          flexShrink: 0,
          whiteSpace: 'nowrap',
          fontWeight: 600,
          fontSize: {
            xs: 12,
            sm: 13
          },
          bgcolor: isActive(entryPath) ? 'action.selected' : 'transparent'
        }}>
            {signedIn ? t.navOpenWorkspace : t.navResearcherLogin}
          </Button>
          {!wideNavigation && <IconButton aria-label={uiPair(language, 'Open navigation menu', '打开导航菜单')} aria-controls={menuAnchor ? 'public-navigation-menu' : undefined} aria-haspopup="true" aria-expanded={!!menuAnchor} onClick={e => setMenuAnchor(e.currentTarget)} sx={{
          flexShrink: 0
        }}><MenuIcon /></IconButton>}
          {rightSlot}
        </Toolbar>
      </Container>
      <Menu id="public-navigation-menu" anchorEl={menuAnchor} open={!!menuAnchor && !wideNavigation} onClose={() => setMenuAnchor(null)}>
        {navigationItems.map(([path, label]) => <MenuItem key={path} component={RouterLink} to={path} selected={activeItem(path)} aria-current={activeItem(path) ? 'page' : undefined} onClick={() => setMenuAnchor(null)} sx={{
        fontWeight: 600,
        color: activeItem(path) ? 'primary.main' : 'text.primary',
        minWidth: 240
      }}>{label}</MenuItem>)}
        <Divider />
        {UI_LANGUAGES.map(item => <MenuItem key={item.id} selected={language === item.id} onClick={() => {
        setLanguage(item.id);
        setMenuAnchor(null);
      }}>{item.nativeName}</MenuItem>)}
        <MenuItem component="a" href={GITHUB_REPO_URL} target="_blank" rel="noopener noreferrer" onClick={() => setMenuAnchor(null)}><GitHub fontSize="small" sx={{
          mr: 1.5
        }} />GitHub · ★ {githubStars !== null ? githubStars : '…'}</MenuItem>
      </Menu>
    </AppBar>;
}
export function PublicFooter() {
  const {
    t
  } = useRegion();
  return <Box component="footer" sx={{
    py: 4,
    mt: 'auto',
    borderTop: '1px solid',
    borderColor: 'divider',
    bgcolor: 'background.paper',
    textAlign: 'center'
  }}>
      <Container maxWidth="lg">
        <Box component="img" src="/logo-long.png" alt="SP-Survey" sx={{
        height: 28,
        objectFit: 'contain',
        mb: 1.5,
        opacity: 0.75
      }} onError={e => {
        e.currentTarget.style.display = 'none';
      }} />
        <Typography variant="body2" color="text.secondary" align="center">
          {t.footerDevelopedBy}{' '}
          <Box component="a" href="https://ual.sg" target="_blank" rel="noopener noreferrer" sx={{
          color: 'primary.main',
          textDecoration: 'none',
          fontWeight: 600
        }}>
            Urban Analytics Lab, NUS
          </Box>
          {' · '}
          <Box component="a" href={GITHUB_REPO_URL} target="_blank" rel="noopener noreferrer" sx={{
          color: 'primary.main',
          textDecoration: 'none',
          fontWeight: 600
        }}>
            GitHub
          </Box>
          {' · '}
          <Box component={RouterLink} to="/faq" sx={{
          color: 'primary.main',
          textDecoration: 'none',
          fontWeight: 600
        }}>
            {t.footerFaq}
          </Box>
        </Typography>
      </Container>
    </Box>;
}