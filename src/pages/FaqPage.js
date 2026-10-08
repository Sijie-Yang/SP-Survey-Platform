import React from 'react';
import { Box, Container, Paper, Stack, Typography } from '@mui/material';
import PublicHeader, { PublicFooter } from '../components/layout/PublicHeader';
import { useRegion } from '../contexts/RegionContext';

export default function FaqPage() {
  const { t } = useRegion();
  const sections = [
    { title: t.faqWhereTitle, body: t.faqWhereBody },
    { title: t.faqHowLongTitle, body: t.faqHowLongBody },
  ];

  return (
    <Box sx={{ minHeight: '100vh', bgcolor: 'background.default', display: 'flex', flexDirection: 'column' }}>
      <PublicHeader />
      <Container maxWidth="md" component="main" sx={{ py: { xs: 4, sm: 6 }, flex: 1 }}>
        <Typography variant="h4" component="h1" fontWeight={800} sx={{ mb: 1, letterSpacing: '-0.02em' }}>
          {t.faqTitle}
        </Typography>
        <Typography variant="body1" color="text.secondary" sx={{ mb: 4, maxWidth: 720 }}>
          {t.faqLead}
        </Typography>
        <Stack spacing={2} component="section" aria-label={t.faqTitle}>
          {sections.map((section) => (
            <Paper key={section.title} variant="outlined" sx={{ p: { xs: 2, sm: 3 }, borderRadius: 1.5 }}>
              <Typography component="h2" variant="h6" fontWeight={700} sx={{ mb: 1 }}>
                {section.title}
              </Typography>
              <Typography variant="body1" color="text.secondary">
                {section.body}
              </Typography>
            </Paper>
          ))}
        </Stack>
      </Container>
      <PublicFooter />
    </Box>
  );
}
