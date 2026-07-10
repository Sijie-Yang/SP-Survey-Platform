import React from 'react';
import { AppBar, Toolbar, Typography, Button, Box, Container } from '@mui/material';
import { Link as RouterLink, useLocation } from 'react-router-dom';

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
        <Toolbar disableGutters sx={{ minHeight: 64, gap: 1 }}>
          <Typography
            component={RouterLink}
            to="/"
            variant="h6"
            sx={{
              flexGrow: 1,
              fontWeight: 800,
              letterSpacing: '-0.02em',
              textDecoration: 'none',
              color: 'inherit',
            }}
          >
            {brand}
          </Typography>
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
        py: 3,
        mt: 'auto',
        borderTop: '1px solid',
        borderColor: 'divider',
        bgcolor: 'background.paper',
      }}
    >
      <Container maxWidth="lg">
        <Typography variant="body2" color="text.secondary" align="center">
          SP Survey Platform — streetscape perception research
        </Typography>
      </Container>
    </Box>
  );
}
