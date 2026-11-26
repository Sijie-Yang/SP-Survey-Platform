import React, { useEffect, useState } from 'react';
import {
  Box, Container, Typography, Button, Chip, TextField, InputAdornment,
  CircularProgress, Stack, MenuItem,
} from '@mui/material';
import { Search, Article, DesignServices } from '@mui/icons-material';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { useAuth } from '../contexts/AuthContext';
import { templateUsePath } from '../lib/researcherEntry';
import PublicHeader, { PublicFooter } from '../components/layout/PublicHeader';
import { useRegion } from '../contexts/RegionContext';
import { tf } from '../contexts/adminI18n';
import {
  matchesTemplateSearch, TemplateRow, useTemplateLibrary,
} from '../components/templates/TemplateLibrary';
import {
  dimensionLabel, facetCounts, facetLabel, parseFacets, templateSource,
} from '../lib/templateFacets';

export const PAGE_SIZE = 50;

/** Source buttons; "all" leaves out demos, which have their own button. */
export const SOURCES = ['all', 'paper', 'ai', 'demo'];
/** Dimensions offered as dropdown filters, in this order. */
export const FILTER_DIMENSIONS = ['task', 'modality', 'concept', 'participants', 'country'];

/**
 * filters: { source, q, task, modality, concept, participants, country };
 * every dropdown that is set must match one of the template's values.
 */
export function filterTemplates(templates, filters = {}) {
  const source = SOURCES.includes(filters.source) ? filters.source : 'all';
  return templates.filter((tpl) => {
    if (!matchesTemplateSearch(tpl, filters.q)) return false;
    const src = templateSource(tpl);
    if (source === 'all' ? src === 'demo' : src !== source) return false;
    const facets = parseFacets(tpl.tags);
    return FILTER_DIMENSIONS.every((key) => !filters[key] || (facets[key] || []).includes(filters[key]));
  });
}

/**
 * /templates — every published template, newest first: one search box, a
 * row of source buttons and a few dropdowns (see src/lib/templateFacets.js).
 * The homepage shows only the newest few.
 */
export default function TemplatesPage() {
  const navigate = useNavigate();
  const { isAuthenticated, loading: authLoading } = useAuth();
  const templatePath = templateUsePath(!authLoading && isAuthenticated);
  const { t, language } = useRegion();
  const zh = String(language || '').startsWith('zh');
  const { templates, loading } = useTemplateLibrary();
  const [params, setParams] = useSearchParams();
  const filters = Object.fromEntries(['source', 'q', ...FILTER_DIMENSIONS].map((k) => [k, params.get(k) || '']));
  if (!SOURCES.includes(filters.source)) filters.source = 'all';

  const update = (key, value) => {
    const next = new URLSearchParams(params);
    if (!value || value === 'all') next.delete(key); else next.set(key, value);
    setParams(next, { replace: true });
  };

  const sourceLabel = (key) => (key === 'all' ? (t.tplAll || 'All') : facetLabel('source', key, zh));
  const countFor = (source) => filterTemplates(templates, { ...filters, source, q: filters.q }).length;
  const shown = filterTemplates(templates, filters);
  // Dropdown options: values used by templates of the chosen source, most used first.
  const inSource = filterTemplates(templates, { source: filters.source });
  // Long lists render in pages of PAGE_SIZE; a new filter starts from the top again.
  const [limit, setLimit] = useState(PAGE_SIZE);
  const filterKey = JSON.stringify(filters);
  useEffect(() => { setLimit(PAGE_SIZE); }, [filterKey]);
  const anyDropdown = FILTER_DIMENSIONS.some((k) => filters[k]);

  return (
    <Box sx={{ minHeight: '100vh', bgcolor: 'background.default', display: 'flex', flexDirection: 'column' }}>
      <PublicHeader />

      <Container maxWidth="md" sx={{ py: { xs: 4, md: 6 }, flex: 1 }} data-testid="templates-page">
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
          value={filters.q}
          onChange={(e) => update('q', e.target.value)}
          InputProps={{ startAdornment: <InputAdornment position="start"><Search /></InputAdornment> }}
          inputProps={{ 'aria-label': t.landSearchTemplates }}
          sx={{ mb: 2, maxWidth: 560 }}
          size="small"
        />

        <Stack direction="row" spacing={1} useFlexGap flexWrap="wrap" sx={{ mb: 1.5 }} role="group" aria-label={t.tplTypeFilter || 'Template type'}>
          {SOURCES.map((key) => (
            <Chip
              key={key}
              label={loading ? sourceLabel(key) : `${sourceLabel(key)} ${countFor(key)}`}
              color={filters.source === key ? 'primary' : 'default'}
              variant={filters.source === key ? 'filled' : 'outlined'}
              onClick={() => update('source', key)}
              aria-pressed={filters.source === key}
              sx={{ fontWeight: 600 }}
            />
          ))}
        </Stack>

        <Stack direction="row" spacing={1} useFlexGap flexWrap="wrap" alignItems="center" sx={{ mb: 3 }}>
          {FILTER_DIMENSIONS.map((key) => {
            const options = facetCounts(inSource, key);
            if (!options.length && !filters[key]) return null;
            return (
              <TextField
                key={key}
                select
                size="small"
                label={dimensionLabel(key, zh)}
                value={filters[key]}
                onChange={(e) => update(key, e.target.value)}
                sx={{ minWidth: 132 }}
                SelectProps={{ MenuProps: { PaperProps: { sx: { maxHeight: 360 } } } }}
              >
                <MenuItem value="">{t.tplAll || 'All'}</MenuItem>
                {options.map(([value, n]) => (
                  <MenuItem key={value} value={value}>{facetLabel(key, value, zh)} ({n})</MenuItem>
                ))}
              </TextField>
            );
          })}
          {anyDropdown && (
            <Button size="small" onClick={() => {
              const next = new URLSearchParams(params);
              FILTER_DIMENSIONS.forEach((k) => next.delete(k));
              setParams(next, { replace: true });
            }}>
              {t.tplClearFilters || 'Clear filters'}
            </Button>
          )}
          {!loading && (
            <Typography variant="body2" color="text.secondary" sx={{ ml: 'auto' }}>
              {tf(t.tplCount || '{n} templates', { n: shown.length })}
            </Typography>
          )}
        </Stack>

        {loading ? (
          <Box sx={{ textAlign: 'center', py: 8 }}><CircularProgress /></Box>
        ) : shown.length === 0 ? (
          <Box sx={{ textAlign: 'center', py: 8 }}>
            <Typography color="text.secondary">
              {filters.q ? tf(t.landNoTemplates, { q: filters.q }) : (t.tplNoneOfType || 'No templates of this type yet.')}
            </Typography>
          </Box>
        ) : (
          <Box sx={{ borderTop: '1px solid', borderColor: 'divider' }}>
            {shown.slice(0, limit).map((tpl) => (
              <TemplateRow key={tpl.id} template={tpl} onUse={() => navigate(templatePath)} onFacet={update} activeConcept={filters.concept} />
            ))}
            {shown.length > limit && (
              <Box sx={{ textAlign: 'center', pt: 3 }}>
                <Button variant="outlined" onClick={() => setLimit((n) => n + PAGE_SIZE)}>
                  {tf(t.tplShowMore || 'Show more ({n} left)', { n: shown.length - limit })}
                </Button>
              </Box>
            )}
          </Box>
        )}
      </Container>

      <PublicFooter />
    </Box>
  );
}
