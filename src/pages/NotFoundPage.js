import React from 'react';
import { Box, Button, Container, Typography } from '@mui/material';
import { Link as RouterLink } from 'react-router-dom';
import PublicHeader, { PublicFooter } from '../components/layout/PublicHeader';
import { useRegion } from '../contexts/RegionContext';

/** Shown for any address the router does not know. */
export default function NotFoundPage() {
  const { t } = useRegion();
  return (
    <Box sx={{ minHeight: '100vh', display: 'flex', flexDirection: 'column', bgcolor: 'background.default' }}>
      <PublicHeader />
      <Container maxWidth="sm" sx={{ flex: 1, py: { xs: 8, md: 12 }, textAlign: 'center' }}>
        <Typography variant="h2" fontWeight={800} color="text.secondary" sx={{ mb: 1 }}>404</Typography>
        <Typography variant="h5" component="h1" fontWeight={700} sx={{ mb: 2 }}>{t.notFoundTitle}</Typography>
        <Typography variant="body1" color="text.secondary" sx={{ mb: 4 }}>{t.notFoundBody}</Typography>
        <Button component={RouterLink} to="/" variant="contained" size="large">{t.notFoundHome}</Button>
      </Container>
      <PublicFooter />
    </Box>
  );
}
