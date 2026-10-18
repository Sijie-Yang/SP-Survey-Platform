import React, { useEffect, useState } from 'react';
import { Box, ButtonBase, Container, Typography } from '@mui/material';
import { useNavigate } from 'react-router-dom';
import { useRegion } from '../contexts/RegionContext';
import { UI_LANGUAGES, intlLocale } from '../lib/uiLanguages';
import { countResearchPapers } from '../lib/researchPaperStore';
import { GITHUB_REPO_URL } from './layout/PublicHeader';

// Homepage credibility strip. Only numbers that grow with curation and never
// read as "small": templates, the paper library, languages. Usage numbers
// (researchers, responses, visits) live in the admin dashboard instead.
// Counts below these floors are left out rather than shown looking thin.
const MIN_TEMPLATES = 10;
const MIN_PAPERS = 50;

export default function PlatformHighlights({ templateCount = 0 }) {
  const { t, language } = useRegion();
  const navigate = useNavigate();
  const [paperCount, setPaperCount] = useState(0);

  useEffect(() => {
    let cancelled = false;
    countResearchPapers({ status: 'approved' })
      .then((n) => { if (!cancelled) setPaperCount(n); })
      .catch(() => {});
    return () => { cancelled = true; };
  }, []);

  const fmt = new Intl.NumberFormat(intlLocale(language));
  const items = [
    templateCount >= MIN_TEMPLATES && {
      key: 'templates',
      value: fmt.format(templateCount),
      label: t.landHlTemplates,
      onClick: () => document.getElementById('templates')?.scrollIntoView({ behavior: 'smooth' }),
    },
    paperCount >= MIN_PAPERS && {
      key: 'papers',
      value: fmt.format(paperCount),
      label: t.landHlPapers,
      onClick: () => navigate('/papers'),
    },
    {
      key: 'languages',
      value: fmt.format(UI_LANGUAGES.length),
      label: t.landHlLanguages,
    },
    {
      key: 'open',
      value: t.landHlOpenValue,
      label: t.landHlOpenLabel,
      href: GITHUB_REPO_URL,
    },
  ].filter(Boolean);

  return (
    <Box sx={{ borderBottom: '1px solid', borderColor: 'divider', bgcolor: 'background.paper' }} data-testid="platform-highlights">
      <Container
        maxWidth="lg"
        sx={{
          display: 'grid',
          gridTemplateColumns: { xs: '1fr 1fr', md: `repeat(${items.length}, 1fr)` },
          py: { xs: 2, md: 2.5 },
        }}
      >
        {items.map((item) => {
          const clickable = item.onClick || item.href;
          return (
            <ButtonBase
              key={item.key}
              component={item.href ? 'a' : 'div'}
              href={item.href}
              target={item.href ? '_blank' : undefined}
              rel={item.href ? 'noopener noreferrer' : undefined}
              onClick={item.onClick}
              disabled={!clickable}
              sx={{
                display: 'flex',
                flexDirection: 'column',
                justifyContent: 'flex-start',
                py: 1,
                px: 1.5,
                borderRadius: 2,
                textAlign: 'center',
                '&:hover': clickable ? { bgcolor: 'action.hover' } : undefined,
              }}
            >
              <Typography sx={{ fontSize: { xs: '1.4rem', md: '1.75rem' }, fontWeight: 800, lineHeight: 1.2, color: 'primary.main' }}>
                {item.value}
              </Typography>
              <Typography variant="body2" color="text.secondary" sx={{ mt: 0.25 }}>
                {item.label}
              </Typography>
            </ButtonBase>
          );
        })}
      </Container>
    </Box>
  );
}
