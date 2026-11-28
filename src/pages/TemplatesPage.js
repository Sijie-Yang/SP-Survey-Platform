import React, { useEffect, useRef, useState } from 'react';
import {
  Box, Container, Typography, Button, TextField, InputAdornment,
  CircularProgress, Stack, MenuItem, Menu,
} from '@mui/material';
import { alpha } from '@mui/material/styles';
import {
  Search, Article, DesignServices, KeyboardArrowDown, Close, Check,
} from '@mui/icons-material';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { useAuth } from '../contexts/AuthContext';
import { templateUsePath } from '../lib/researcherEntry';
import PublicHeader, { PublicFooter } from '../components/layout/PublicHeader';
import { useRegion } from '../contexts/RegionContext';
import { tf } from '../contexts/adminI18n';
import {
  matchesTemplateSearch, TemplatePreviewDialog, TemplateRow, templateDisplayName, useTemplateLibrary,
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
 * A rounded filter button. Empty: "Concept ▾". Set: "Concept: Cycling ×" in
 * the primary tint; the × clears it. The menu lists values with counts.
 */
function FilterPill({ label, value, valueLabel, options, allLabel, onChange }) {
  const [anchor, setAnchor] = useState(null);
  const active = Boolean(value);
  const pick = (v) => { setAnchor(null); onChange(v); };
  return (
    <>
      <Box
        component="button"
        type="button"
        aria-haspopup="listbox"
        aria-expanded={Boolean(anchor)}
        onClick={(e) => setAnchor(e.currentTarget)}
        sx={(theme) => ({
          display: 'inline-flex', alignItems: 'center', gap: 0.5, height: 32, pl: 1.5, pr: active ? 0.5 : 1,
          borderRadius: 999, cursor: 'pointer', font: 'inherit', fontSize: 13.5, whiteSpace: 'nowrap',
          border: '1px solid',
          borderColor: active ? alpha(theme.palette.primary.main, 0.5) : theme.palette.divider,
          bgcolor: active ? alpha(theme.palette.primary.main, 0.08) : theme.palette.background.paper,
          color: active ? theme.palette.primary.main : theme.palette.text.primary,
          fontWeight: active ? 600 : 500,
          transition: 'border-color .15s, background-color .15s',
          '&:hover': { borderColor: active ? theme.palette.primary.main : theme.palette.text.secondary },
        })}
      >
        {active ? (
          <>
            <Box component="span" sx={{ fontWeight: 500, opacity: 0.75 }}>{label}:</Box>
            {valueLabel}
            <Box
              component="span"
              role="button"
              aria-label={`${label} ×`}
              onClick={(e) => { e.stopPropagation(); onChange(''); }}
              sx={{ display: 'inline-flex', ml: 0.25, p: 0.25, borderRadius: '50%', '&:hover': { bgcolor: 'action.hover' } }}
            >
              <Close sx={{ fontSize: 16 }} />
            </Box>
          </>
        ) : (
          <>
            {label}
            <KeyboardArrowDown sx={{ fontSize: 18, color: 'text.secondary' }} />
          </>
        )}
      </Box>
      <Menu
        anchorEl={anchor}
        open={Boolean(anchor)}
        onClose={() => setAnchor(null)}
        PaperProps={{ sx: { maxHeight: 380, minWidth: 220, mt: 0.75, borderRadius: 2 } }}
        MenuListProps={{ dense: true, role: 'listbox' }}
      >
        <MenuItem selected={!active} onClick={() => pick('')}>
          <Box sx={{ flex: 1 }}>{allLabel}</Box>
          {!active && <Check sx={{ fontSize: 16, color: 'primary.main' }} />}
        </MenuItem>
        {options.map((o) => (
          <MenuItem key={o.value} selected={o.value === value} onClick={() => pick(o.value)}>
            <Box sx={{ flex: 1, pr: 2 }}>{o.label}</Box>
            {o.value === value
              ? <Check sx={{ fontSize: 16, color: 'primary.main' }} />
              : <Typography component="span" variant="caption" color="text.disabled">{o.n}</Typography>}
          </MenuItem>
        ))}
      </Menu>
    </>
  );
}

/** The template a `?preview=<id>` link points at; nothing for an id the library does not list. */
export function linkedPreview(templates, id) {
  return (id && (templates || []).find((tpl) => tpl.id === id)) || null;
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

  // The search text lives in the URL, but the router applies URL changes with
  // a delay; an input bound straight to the URL loses characters typed in
  // between. So the box keeps its own text, and follows the URL only when the
  // change came from somewhere else (Clear filters, a link).
  const [query, setQuery] = useState(filters.q);
  const searchRef = useRef(null);
  useEffect(() => {
    if (document.activeElement !== searchRef.current) setQuery(filters.q);
  }, [filters.q]);

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

  // A link can open one template's preview directly: /templates?preview=<template id>.
  const linked = linkedPreview(templates, params.get('preview'));
  const closeLinked = () => {
    const next = new URLSearchParams(params);
    next.delete('preview');
    setParams(next, { replace: true });
  };

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
          value={query}
          onChange={(e) => { setQuery(e.target.value); update('q', e.target.value); }}
          inputRef={searchRef}
          InputProps={{ startAdornment: <InputAdornment position="start"><Search /></InputAdornment> }}
          inputProps={{ 'aria-label': t.landSearchTemplates }}
          sx={{ mb: 2, maxWidth: 560 }}
          size="small"
        />

        <Box
          role="tablist"
          aria-label={t.tplTypeFilter || 'Template type'}
          sx={{ display: 'flex', gap: { xs: 2, sm: 3 }, borderBottom: '1px solid', borderColor: 'divider', mb: 2, overflowX: 'auto' }}
        >
          {SOURCES.map((key) => {
            const active = filters.source === key;
            return (
              <Box
                key={key}
                component="button"
                type="button"
                role="tab"
                aria-selected={active}
                onClick={() => update('source', key)}
                sx={{
                  border: 0, bgcolor: 'transparent', cursor: 'pointer', font: 'inherit', px: 0, pb: 1.25, pt: 0.5,
                  mb: '-1px', whiteSpace: 'nowrap', display: 'flex', alignItems: 'baseline', gap: 0.75,
                  borderBottom: '2px solid', borderColor: active ? 'primary.main' : 'transparent',
                  color: active ? 'text.primary' : 'text.secondary', fontWeight: active ? 700 : 500, fontSize: 15,
                  '&:hover': { color: 'text.primary' },
                }}
              >
                {sourceLabel(key)}
                {!loading && (
                  <Box component="span" sx={{ fontSize: 12, fontWeight: 600, color: active ? 'primary.main' : 'text.disabled' }}>
                    {countFor(key)}
                  </Box>
                )}
              </Box>
            );
          })}
        </Box>

        <Stack direction="row" spacing={1} useFlexGap flexWrap="wrap" alignItems="center" sx={{ mb: 2.5 }}>
          {FILTER_DIMENSIONS.map((key) => {
            const options = facetCounts(inSource, key);
            if (!options.length && !filters[key]) return null;
            return (
              <FilterPill
                key={key}
                label={dimensionLabel(key, zh)}
                value={filters[key]}
                valueLabel={filters[key] ? facetLabel(key, filters[key], zh) : ''}
                options={options.map(([value, n]) => ({ value, n, label: facetLabel(key, value, zh) }))}
                allLabel={t.tplAll || 'All'}
                onChange={(v) => update(key, v)}
              />
            );
          })}
          {anyDropdown && (
            <Button size="small" sx={{ borderRadius: 999, color: 'text.secondary' }} onClick={() => {
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

      {linked && (
        <TemplatePreviewDialog templateId={linked.id} templateName={templateDisplayName(linked)} open onClose={closeLinked} />
      )}

      <PublicFooter />
    </Box>
  );
}
