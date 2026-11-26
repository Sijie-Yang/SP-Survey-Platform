import React from 'react';
import {
  Box, Container, Typography, Button, Chip, TextField, InputAdornment,
  CircularProgress, Stack,
} from '@mui/material';
import { Search, Article, DesignServices } from '@mui/icons-material';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { useAuth } from '../contexts/AuthContext';
import { templateUsePath } from '../lib/researcherEntry';
import PublicHeader, { PublicFooter } from '../components/layout/PublicHeader';
import { useRegion } from '../contexts/RegionContext';
import { tf } from '../contexts/adminI18n';
import {
  isSpSchemeTemplate, matchesTemplateSearch, SchemeExampleCard, TemplateCard, useTemplateLibrary,
} from '../components/templates/TemplateLibrary';

/** The type filter: one row of buttons, kept in the URL (?type=). */
export const TEMPLATE_TYPES = ['all', 'academic', 'urban', 'ai', 'scheme'];

export function filterTemplates(templates, type, query) {
  return templates.filter((tpl) => {
    if (!matchesTemplateSearch(tpl, query)) return false;
    const scheme = isSpSchemeTemplate(tpl);
    if (type === 'scheme') return scheme;
    if (type === 'all' || !TEMPLATE_TYPES.includes(type)) return true;
    return !scheme && tpl.category === type;
  });
}

/**
 * /templates — every published template, newest first, with one search box
 * and one row of type buttons. The homepage shows only the newest few.
 */
export default function TemplatesPage() {
  const navigate = useNavigate();
  const { isAuthenticated, loading: authLoading } = useAuth();
  const templatePath = templateUsePath(!authLoading && isAuthenticated);
  const { t } = useRegion();
  const { templates, loading } = useTemplateLibrary();
  const [params, setParams] = useSearchParams();
  const type = TEMPLATE_TYPES.includes(params.get('type')) ? params.get('type') : 'all';
  const query = params.get('q') || '';

  const update = (key, value) => {
    const next = new URLSearchParams(params);
    if (!value || value === 'all') next.delete(key); else next.set(key, value);
    setParams(next, { replace: true });
  };

  const labels = {
    all: t.tplAll || 'All',
    academic: t.landCatAcademic,
    urban: t.landCatUrban,
    ai: t.landCatAi,
    scheme: 'SP-Scheme',
  };
  const countFor = (key) => filterTemplates(templates, key, '').length;
  const shown = filterTemplates(templates, type, query);

  return (
    <Box sx={{ minHeight: '100vh', bgcolor: 'background.default', display: 'flex', flexDirection: 'column' }}>
      <PublicHeader />

      <Container maxWidth="lg" sx={{ py: { xs: 4, md: 6 }, flex: 1 }} data-testid="templates-page">
        <Stack
          direction={{ xs: 'column', md: 'row' }}
          spacing={2}
          alignItems={{ xs: 'flex-start', md: 'flex-end' }}
          justifyContent="space-between"
          sx={{ mb: 3 }}
        >
          <Box>
            <Typography variant="h4" component="h1" fontWeight={700} sx={{ mb: 0.5 }}>
              {t.landTemplatesTitle}
            </Typography>
            <Typography variant="body1" color="text.secondary">
              {t.landTemplatesSubtitle}
            </Typography>
          </Box>
          <Stack direction={{ xs: 'column', sm: 'row' }} spacing={1} sx={{ flexShrink: 0 }}>
            <Button variant="outlined" size="small" startIcon={<Article />} onClick={() => navigate('/request-template')}>
              {t.landRequestTemplate}
            </Button>
            <Button variant="outlined" size="small" color="secondary" startIcon={<DesignServices />} onClick={() => navigate('/request-survey-design')}>
              {t.landRequestDesign}
            </Button>
          </Stack>
        </Stack>

        <TextField
          fullWidth
          placeholder={t.landSearchTemplates}
          value={query}
          onChange={(e) => update('q', e.target.value)}
          InputProps={{ startAdornment: <InputAdornment position="start"><Search /></InputAdornment> }}
          inputProps={{ 'aria-label': t.landSearchTemplates }}
          sx={{ mb: 2, maxWidth: 560 }}
          size="small"
        />

        <Stack direction="row" spacing={1} useFlexGap flexWrap="wrap" sx={{ mb: 3 }} role="group" aria-label={t.tplTypeFilter || 'Template type'}>
          {TEMPLATE_TYPES.map((key) => {
            const n = countFor(key);
            if (key !== 'all' && n === 0 && !loading) return null;
            return (
              <Chip
                key={key}
                label={loading ? labels[key] : `${labels[key]} ${n}`}
                color={type === key ? 'primary' : 'default'}
                variant={type === key ? 'filled' : 'outlined'}
                onClick={() => update('type', key)}
                aria-pressed={type === key}
                sx={{ fontWeight: 600 }}
              />
            );
          })}
        </Stack>

        {loading ? (
          <Box sx={{ textAlign: 'center', py: 8 }}><CircularProgress /></Box>
        ) : shown.length === 0 ? (
          <Box sx={{ textAlign: 'center', py: 8 }}>
            <Typography color="text.secondary">
              {query ? tf(t.landNoTemplates, { q: query }) : (t.tplNoneOfType || 'No templates of this type yet.')}
            </Typography>
          </Box>
        ) : (
          <Box sx={{ display: 'grid', gridTemplateColumns: { xs: '1fr', sm: '1fr 1fr', md: 'repeat(3, 1fr)' }, gap: 2 }}>
            {shown.map((tpl) => (type === 'scheme'
              ? <SchemeExampleCard key={tpl.id} template={tpl} onUse={() => navigate(templatePath)} />
              : <TemplateCard key={tpl.id} template={tpl} onUse={() => navigate(templatePath)} />))}
          </Box>
        )}
      </Container>

      <PublicFooter />
    </Box>
  );
}
