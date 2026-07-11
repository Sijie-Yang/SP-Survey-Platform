import React from 'react';
import { AppBar, Toolbar, Typography, Button, Box, Container } from '@mui/material';
import { Link as RouterLink, useLocation } from 'react-router-dom';

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
 * Shared public-site header (Landing, Live, Login).
 */
export default function PublicHeader({
  brand = 'SP Survey Platform',
  rightSlot = null,
}) {
  const location = useLocation();
  const isActive = (path) => location.pathname === path;

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
            <BrandLogo src="/UAL%20Logo.jpg" alt="Urban Analytics Lab, NUS" height={44} />
            <BrandLogo src="/DoA%20Logo.jpg" alt="Department of Architecture, NUS" height={44} />
          </Box>
          <Button
            component={RouterLink}
            to="/live"
            color={isActive('/live') ? 'primary' : 'inherit'}
            sx={{ fontWeight: isActive('/live') ? 700 : 500 }}
          >
            Live surveys
          </Button>
          <Button
            component={RouterLink}
            to="/login"
            variant={isActive('/login') ? 'contained' : 'outlined'}
            size="small"
          >
            Researcher login
          </Button>
          {rightSlot}
        </Toolbar>
      </Container>
    </AppBar>
  );
}

export function PublicFooter() {
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
          Developed by{' '}
          <Box
            component="a"
            href="https://ual.sg"
            target="_blank"
            rel="noopener noreferrer"
            sx={{ color: 'primary.main', textDecoration: 'none', fontWeight: 600 }}
          >
            Urban Analytics Lab, NUS
          </Box>
        </Typography>
      </Container>
    </Box>
  );
}
