import React, { lazy, Suspense, useState, useEffect } from 'react';
import {
  Box, Typography, Button, Card, CardContent, Chip, CircularProgress,
  Stack, Dialog, DialogTitle, DialogContent, DialogActions, Skeleton,
} from '@mui/material';
import { Article, Dataset, Preview } from '@mui/icons-material';
import { supabase } from '../../lib/supabase';
import { stripOwnResponseSupabase } from '../../lib/ownResponseSupabase';
import { projectTemplates } from '../../lib/projectTemplates';
import { useRegion } from '../../contexts/RegionContext';
import { tf } from '../../contexts/adminI18n';
import { filterMediaByType } from '../../lib/mediaUtils';
import { coverCandidatesForTemplate, DEFAULT_TEMPLATE_COVER, hashString, loadCoverIndex, useCoverCandidate } from '../../lib/templateCover';
import { listPreviewMedia } from '../../lib/previewMediaLibrary';
import { paperTemplateDoc } from '../../pages/paperTemplateDocs';
import SchemePageCover from '../SchemePageCover';

/*
 * The public template library: loading, ordering and the cards. Used by the
 * homepage (a few newest ones) and by /templates (all of them).
 */

// SurveyJS is heavy and only needed when a template preview is opened.
const SurveyPreview = lazy(() => import('../admin/SurveyPreview'));
const CLAMP = (lines) => ({
  display: '-webkit-box',
  WebkitLineClamp: lines,
  WebkitBoxOrient: 'vertical',
  overflow: 'hidden',
});

export function normalizeCategory(raw) {
  const c = raw?.toLowerCase() || '';
  if (c.includes('ai')) return 'ai';
  if (c.includes('urban')) return 'urban';
  return 'academic';
}

/**
 * Templates built with SP-Scheme (an LLM-designed participant page uploaded as
 * the whole survey). Recognised by name or id, so an admin features one by
 * putting "SP-Scheme" in its name; no column or SQL needed.
 */
export function isSpSchemeTemplate(tpl) {
  return /sp[\s_-]?scheme/i.test(`${tpl?.name || ''} ${tpl?.id || ''}`);
}

/**
 * Newest first: paper year, then when it went online. (The admin pin only
 * orders the editor's template list, not the public library.)
 */
export function sortNewestFirst(list) {
  return [...list].sort((a, b) =>
    ((Number(b.year) || 0) - (Number(a.year) || 0))
    || String(b.created_at || '').localeCompare(String(a.created_at || '')));
}

/** Free-text match on name, author, description and id. */
export function matchesTemplateSearch(tpl, query) {
  const q = String(query || '').trim().toLowerCase();
  if (!q) return true;
  return [tpl.name, tpl.author, tpl.description, tpl.id, tpl.year && String(tpl.year),
    tpl.paper?.title, tpl.paper?.venue, ...(tpl.paper?.authors || [])]
    .some((v) => v?.toLowerCase().includes(q));
}

function getStaticTemplates() {
  return projectTemplates.map((tpl) => ({
    id: tpl.id,
    name: tpl.name,
    description: tpl.description,
    author: tpl.author,
    year: tpl.year,
    category: normalizeCategory(tpl.category),
    paper_url: null,
    dataset: null,
  }));
}

/** Family name from "Ito K.", "Ito, Koichi" or "Koichi Ito". */
function familyName(raw) {
  const name = String(raw || '').trim();
  if (!name) return '';
  if (name.includes(',')) return name.split(',')[0].trim();
  const parts = name.split(/\s+/);
  if (parts.length === 1) return parts[0];
  const isInitials = (w) => /^(?:[A-Z]\.?-?)+$/.test(w);
  if (isInitials(parts[parts.length - 1])) {
    const family = parts.filter((w) => !isInitials(w));
    return family.join(' ') || parts[0];
  }
  return parts[parts.length - 1];
}

/** One-line author list: "Kang, Zhang & Ratti" or "Kang et al." for more than three. */
export function shortAuthors(authors) {
  const names = (authors || []).map(familyName).filter(Boolean);
  if (names.length === 0) return '';
  if (names.length > 3) return `${names[0]} et al.`;
  if (names.length === 1) return names[0];
  return `${names.slice(0, -1).join(', ')} & ${names[names.length - 1]}`;
}

/**
 * The published paper behind each template, from the paper library
 * (approved papers linked by template_id). Missing papers just mean the row
 * falls back to the template's own name.
 */
async function loadTemplatePapers() {
  if (!supabase) return {};
  try {
    const { data, error } = await supabase
      .from('research_papers')
      .select('template_id, title, venue, year, doi, paper_url, authors')
      .eq('status', 'approved')
      .not('template_id', 'is', null);
    if (error) return {};
    const byTemplate = {};
    for (const row of data || []) {
      if (row.template_id && !byTemplate[row.template_id]) byTemplate[row.template_id] = row;
    }
    return byTemplate;
  } catch {
    return {};
  }
}

async function loadTemplates() {
  const papersPromise = loadTemplatePapers();
  const previewPoolPromise = listPreviewMedia().catch(() => []);
  const coverIndexPromise = loadCoverIndex();
  try {
    if (supabase) {
      // Lightweight first pass — avoid downloading every template's full media catalog.
      const { data, error } = await supabase
        .from('templates')
        .select('id, name, description, author, year, category, paper_url, dataset, thumbnail_url, show_on_landing, created_at')
        .eq('is_approved', true)
        .order('year', { ascending: false });
      if (!error && data?.length > 0) {
        const missingIds = data.filter((tpl) => !tpl.thumbnail_url).map((tpl) => tpl.id);
        const libraryById = {};
        const mediaPromise = missingIds.length
          ? supabase.from('templates').select('id, preloaded_images').in('id', missingIds)
          : Promise.resolve({ data: [] });
        const [mediaResult, previewPool, coverIndex, papers] = await Promise.all([mediaPromise, previewPoolPromise, coverIndexPromise, papersPromise]);
        for (const row of mediaResult.data || []) {
          libraryById[row.id] = row.preloaded_images || [];
        }
        const previewUrls = filterMediaByType(previewPool, 'image')
          .map((img) => img.url)
          .filter(Boolean);
        const normalized = await Promise.all(data.map(async (tpl) => {
          const withLibrary = { ...tpl, preloaded_images: libraryById[tpl.id] || [] };
          const coverCandidates = await coverCandidatesForTemplate(withLibrary, previewUrls, coverIndex);
          return {
            id: tpl.id,
            name: tpl.name,
            description: tpl.description,
            author: tpl.author,
            year: tpl.year,
            category: normalizeCategory(tpl.category),
            paper_url: tpl.paper_url,
            dataset: tpl.dataset,
            thumbnail_url: coverCandidates[0],
            coverCandidates,
            // The cover an admin set, as opposed to one picked from the library.
            own_thumbnail: tpl.thumbnail_url || null,
            show_on_landing: tpl.show_on_landing,
            created_at: tpl.created_at || null,
            paper: papers[tpl.id] || null,
          };
        }));
        return sortNewestFirst(normalized);
      }
    }
    const [previewPool, coverIndex] = await Promise.all([previewPoolPromise, coverIndexPromise]);
    const previewUrls = filterMediaByType(previewPool, 'image').map((img) => img.url).filter(Boolean);
    return sortNewestFirst(await Promise.all(getStaticTemplates().map(async (tpl) => {
      const coverCandidates = await coverCandidatesForTemplate(tpl, previewUrls, coverIndex);
      return { ...tpl, thumbnail_url: coverCandidates[0], coverCandidates };
    })));
  } catch {
    const coverIndex = await loadCoverIndex().catch(() => ({}));
    return sortNewestFirst(await Promise.all(getStaticTemplates().map(async (tpl) => {
      const coverCandidates = await coverCandidatesForTemplate(tpl, [], coverIndex);
      return { ...tpl, thumbnail_url: coverCandidates[0], coverCandidates };
    })));
  }
}

/** All approved templates, newest first. */
export function useTemplateLibrary() {
  const [templates, setTemplates] = useState([]);
  const [loading, setLoading] = useState(true);
  useEffect(() => {
    let cancelled = false;
    loadTemplates()
      .then((list) => { if (!cancelled) setTemplates(list); })
      .finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, []);
  return { templates, loading };
}

export function TemplatePreviewDialog({ templateId, templateName, open, onClose }) {
  const { t } = useRegion();
  const [config, setConfig] = useState(null);
  const [preloadedImages, setPreloadedImages] = useState([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => {
    if (!open || !templateId) return;
    setConfig(null);
    setPreloadedImages([]);
    setError('');
    setLoading(true);

    const fetchConfig = async () => {
      try {
        if (supabase) {
          const { data, error: err } = await supabase
            .from('templates')
            .select('survey_config, preloaded_images')
            .eq('id', templateId)
            .single();
          if (!err && data?.survey_config) {
            setConfig(stripOwnResponseSupabase(data.survey_config));
            setPreloadedImages(Array.isArray(data.preloaded_images) ? data.preloaded_images : []);
            return;
          }
        }
        const res = await fetch(`/project_templates/${templateId}.json`);
        if (res.ok) {
          const tpl = await res.json();
          setConfig(stripOwnResponseSupabase(tpl.config || tpl.survey_config || null));
          setPreloadedImages(Array.isArray(tpl.preloadedImages) ? tpl.preloadedImages : []);
        } else {
          setError('Preview not available for this template.');
        }
      } catch {
        setError('Failed to load preview.');
      } finally {
        setLoading(false);
      }
    };

    fetchConfig();
  }, [open, templateId]);

  return (
    <Dialog open={open} onClose={onClose} maxWidth="lg" fullWidth
      PaperProps={{ sx: { height: '90vh' } }}>
      <DialogTitle>
        {tf(t.landPreviewTitle, { name: templateName })}
        <Typography variant="caption" color="text.secondary" sx={{ ml: 1 }}>{t.landReadOnly}</Typography>
      </DialogTitle>
      <DialogContent sx={{ p: 0, overflow: 'auto', display: 'flex', flexDirection: 'column' }}>
        {loading && (
          <Box sx={{ display: 'flex', justifyContent: 'center', alignItems: 'center', flex: 1, py: 6 }}>
            <CircularProgress />
          </Box>
        )}
        {error && (
          <Box sx={{ p: 3 }}>
            <Typography color="text.secondary">{error}</Typography>
          </Box>
        )}
        {config && !loading && (
          <Suspense fallback={<Box sx={{ display: 'flex', justifyContent: 'center', py: 6 }}><CircularProgress /></Box>}>
          <SurveyPreview
            config={config}
            currentProject={{
              id: `tpl-${templateId}`,
              name: templateName,
              preloadedImages,
            }}
            showMediaAssignment={false}
          />
          </Suspense>
        )}
      </DialogContent>
      <DialogActions>
        <Button onClick={onClose}>{t.landClose}</Button>
      </DialogActions>
    </Dialog>
  );
}

/**
 * A larger card for an SP-Scheme example: cover, what it is, preview and use.
 * The cover is the image an admin set for the template, otherwise the page
 * itself (drawn the same way on every load), never a random library picture.
 */
export function SchemeExampleCard({ template, onUse }) {
  const { t } = useRegion();
  const [previewOpen, setPreviewOpen] = useState(false);
  const title = String(template.name || '').replace(/^\s*sp[\s_-]?scheme\s*[:：·|-]?\s*/i, '') || template.name;

  return (
    <>
      <Card data-testid={`sp-scheme-example-${template.id}`} sx={{
        borderRadius: 2,
        overflow: 'hidden',
        boxShadow: '0 2px 10px rgba(0,0,0,0.07)',
        '&:hover': { boxShadow: '0 6px 20px rgba(0,0,0,0.12)' },
        transition: 'box-shadow 0.2s',
        display: 'flex',
        flexDirection: 'column',
      }}>
        <Box
          component="button"
          type="button"
          onClick={() => setPreviewOpen(true)}
          aria-label={`${t.landPreview}: ${title}`}
          sx={{ display: 'block', width: '100%', p: 0, border: 0, cursor: 'pointer', bgcolor: 'grey.100', borderBottom: '1px solid', borderColor: 'divider' }}
        >
          {template.own_thumbnail ? (
            <Box component="img" src={template.own_thumbnail} alt="" sx={{ display: 'block', width: '100%', height: 190, objectFit: 'cover', objectPosition: 'top' }} />
          ) : (
            <SchemePageCover templateId={template.id} height={190} fallback={<Skeleton variant="rectangular" animation="wave" sx={{ width: '100%', height: '100%' }} />} />
          )}
        </Box>
        <CardContent sx={{ p: 2.5, flex: 1, display: 'flex', flexDirection: 'column' }}>
          <Typography variant="subtitle1" fontWeight={700} sx={{ mb: 0.5, lineHeight: 1.35, ...CLAMP(2) }}>
            {title}
          </Typography>
          {(template.author || template.year) && (
            <Typography variant="caption" color="text.secondary" sx={{ mb: 1 }}>
              {[template.author, template.year].filter(Boolean).join(' · ')}
            </Typography>
          )}
          <Typography variant="body2" color="text.secondary" sx={{ mb: 2, flex: 1, ...CLAMP(3) }}>
            {template.description || ''}
          </Typography>
          <Stack direction="row" spacing={1} alignItems="center">
            <Button size="small" variant="outlined" startIcon={<Preview />} onClick={() => setPreviewOpen(true)}>
              {t.landPreview}
            </Button>
            <Button size="small" variant="contained" onClick={onUse} sx={{ ml: 'auto' }}>
              {t.landUse}
            </Button>
          </Stack>
        </CardContent>
      </Card>

      <TemplatePreviewDialog
        templateId={template.id}
        templateName={title}
        open={previewOpen}
        onClose={() => setPreviewOpen(false)}
      />
    </>
  );
}

export function TemplateCard({ template, onUse }) {
  const { t } = useRegion();
  const [previewOpen, setPreviewOpen] = useState(false);
  const isAI = template.category === 'ai';
  const isUrban = template.category === 'urban';
  const chipColor = isAI ? 'primary' : isUrban ? 'warning' : 'success';
  const chipLabel = isAI ? t.landChipAi : isUrban ? t.landChipUrban : t.landChipAcademic;
  const { src: thumb, onError: onThumbError } = useCoverCandidate(template.coverCandidates || [template.thumbnail_url || DEFAULT_TEMPLATE_COVER]);
  const coverPos = `${hashString(template.id) % 80}% ${hashString(`${template.id}-y`) % 80}%`;

  return (
    <>
      <Card sx={{
        height: 258,
        borderRadius: 2,
        overflow: 'hidden',
        boxShadow: '0 2px 8px rgba(0,0,0,0.06)',
        '&:hover': { boxShadow: '0 4px 16px rgba(0,0,0,0.12)' },
        transition: 'box-shadow 0.2s',
        display: 'flex',
        flexDirection: 'column',
      }}>
        <Box
          sx={{
            height: 110,
            flexShrink: 0,
            bgcolor: 'grey.100',
            backgroundImage: `url(${thumb})`,
            backgroundSize: 'cover',
            backgroundPosition: coverPos,
            position: 'relative',
          }}
        >
          <Box
            component="img"
            src={thumb}
            alt=""
            onError={onThumbError}
            sx={{ display: 'none' }}
          />
          <Chip
            label={chipLabel}
            size="small"
            color={chipColor}
            variant="outlined"
            sx={{
              position: 'absolute',
              top: 10,
              left: 10,
              bgcolor: 'rgba(255,255,255,0.94)',
              fontWeight: 600,
              // Filled chips use contrast (white) text; white bg made that invisible.
              borderColor: `${chipColor}.main`,
              color: `${chipColor}.dark`,
            }}
          />
        </Box>
        <CardContent sx={{ p: 2, flex: 1, minHeight: 0, boxSizing: 'border-box', display: 'flex', flexDirection: 'column' }}>
          <Typography variant="subtitle2" fontWeight={700} sx={{ mb: 0.35, flexShrink: 0, lineHeight: 1.35, ...CLAMP(2) }}>
            {template.name}
          </Typography>

          <Typography variant="caption" color="text.secondary" sx={{ mb: 0.75, flexShrink: 0, ...CLAMP(1) }}>
            {[template.author, template.year].filter(Boolean).join(' · ') || '\u00A0'}
          </Typography>

          <Typography variant="body2" color="text.secondary" sx={{ mb: 1.25, flex: 1, fontSize: '0.8rem', lineHeight: 1.4, ...CLAMP(1) }}>
            {template.description || ''}
          </Typography>

          <Box sx={{ display: 'flex', gap: 1, flexShrink: 0, flexWrap: 'wrap', alignItems: 'center' }}>
            {paperTemplateDoc(template.id) && (
              <Button size="small" href={`/docs/${template.id}`} sx={{ fontSize: '0.75rem', minWidth: 0, px: 1 }}>
                {t.navDocs}
              </Button>
            )}
            {template.paper_url && (
              <Button size="small" startIcon={<Article />} href={template.paper_url} target="_blank" sx={{ fontSize: '0.75rem', minWidth: 0, px: 1 }}>
                {t.landPaper}
              </Button>
            )}
            {template.dataset && (
              <Button size="small" startIcon={<Dataset />} href={`https://huggingface.co/datasets/${template.dataset}`} target="_blank" sx={{ fontSize: '0.75rem', minWidth: 0, px: 1 }}>
                {t.landDataset}
              </Button>
            )}
            <Button size="small" startIcon={<Preview />} onClick={() => setPreviewOpen(true)} sx={{ fontSize: '0.75rem', minWidth: 0, px: 1 }}>
              {t.landPreview}
            </Button>
            <Button size="small" variant="contained" onClick={onUse} sx={{ ml: 'auto', fontSize: '0.75rem' }}>
              {t.landUse}
            </Button>
          </Box>
        </CardContent>
      </Card>

      <TemplatePreviewDialog
        templateId={template.id}
        templateName={template.name}
        open={previewOpen}
        onClose={() => setPreviewOpen(false)}
      />
    </>
  );
}

/**
 * One line per template for /templates, so hundreds stay scannable: small
 * cover, the paper's full title, authors · year · venue, then the actions.
 */
export function TemplateRow({ template, onUse }) {
  const { t } = useRegion();
  const [previewOpen, setPreviewOpen] = useState(false);
  const scheme = isSpSchemeTemplate(template);
  const isAI = template.category === 'ai';
  const isUrban = template.category === 'urban';
  const chipColor = scheme ? 'secondary' : isAI ? 'primary' : isUrban ? 'warning' : 'success';
  const chipLabel = scheme ? 'SP-Scheme' : isAI ? t.landChipAi : isUrban ? t.landChipUrban : t.landChipAcademic;
  const { src: thumb, onError: onThumbError } = useCoverCandidate(template.coverCandidates || [template.thumbnail_url || DEFAULT_TEMPLATE_COVER]);
  const paper = template.paper;
  const title = paper?.title || template.name;
  const byline = paper
    ? [shortAuthors(paper.authors) || template.author, paper.year || template.year].filter(Boolean).join(' · ')
    : [template.author, template.year].filter(Boolean).join(' · ');
  const paperHref = paper?.paper_url || (paper?.doi ? `https://doi.org/${paper.doi}` : template.paper_url);

  return (
    <>
      <Box
        data-testid={`template-row-${template.id}`}
        sx={{
          display: 'flex',
          gap: { xs: 1.5, sm: 2 },
          alignItems: 'flex-start',
          py: 2,
          px: { xs: 0, sm: 1 },
          borderBottom: '1px solid',
          borderColor: 'divider',
        }}
      >
        <Box
          component="button"
          type="button"
          onClick={() => setPreviewOpen(true)}
          aria-label={`${t.landPreview}: ${title}`}
          sx={{ flexShrink: 0, width: { xs: 72, sm: 120 }, height: { xs: 54, sm: 80 }, p: 0, border: 0, borderRadius: 1, overflow: 'hidden', cursor: 'pointer', bgcolor: 'grey.100' }}
        >
          <Box component="img" src={thumb} alt="" onError={onThumbError} loading="lazy" sx={{ display: 'block', width: '100%', height: '100%', objectFit: 'cover' }} />
        </Box>
        <Box sx={{ flex: 1, minWidth: 0 }}>
          <Typography variant="subtitle1" component="h2" fontWeight={700} sx={{ lineHeight: 1.35, fontSize: { xs: '0.95rem', sm: '1rem' } }}>
            {title}
          </Typography>
          <Typography variant="body2" color="text.secondary" sx={{ mt: 0.25 }}>
            {byline}
            {paper?.venue && (
              <>
                {byline ? ' · ' : ''}
                <Box component="span" sx={{ fontStyle: 'italic' }}>{paper.venue}</Box>
              </>
            )}
          </Typography>
          {paper && paper.title !== template.name && (
            <Typography variant="caption" color="text.secondary" sx={{ display: 'block', mt: 0.25, ...CLAMP(1) }}>
              {(t.tplTemplateLabel || 'Template')}: {template.name}
            </Typography>
          )}
          <Stack direction="row" spacing={0.5} useFlexGap flexWrap="wrap" alignItems="center" sx={{ mt: 1 }}>
            <Chip label={chipLabel} size="small" color={chipColor} variant="outlined" sx={{ fontWeight: 600, mr: 0.5 }} />
            {paperTemplateDoc(template.id) && (
              <Button size="small" href={`/docs/${template.id}`} sx={{ fontSize: '0.75rem', minWidth: 0, px: 1 }}>
                {t.navDocs}
              </Button>
            )}
            {paperHref && (
              <Button size="small" startIcon={<Article />} href={paperHref} target="_blank" rel="noopener noreferrer" sx={{ fontSize: '0.75rem', minWidth: 0, px: 1 }}>
                {t.landPaper}
              </Button>
            )}
            {template.dataset && (
              <Button size="small" startIcon={<Dataset />} href={`https://huggingface.co/datasets/${template.dataset}`} target="_blank" rel="noopener noreferrer" sx={{ fontSize: '0.75rem', minWidth: 0, px: 1 }}>
                {t.landDataset}
              </Button>
            )}
            <Button size="small" startIcon={<Preview />} onClick={() => setPreviewOpen(true)} sx={{ fontSize: '0.75rem', minWidth: 0, px: 1 }}>
              {t.landPreview}
            </Button>
            <Button size="small" variant="contained" onClick={onUse} sx={{ ml: 'auto !important', fontSize: '0.75rem' }}>
              {t.landUse}
            </Button>
          </Stack>
        </Box>
      </Box>

      <TemplatePreviewDialog
        templateId={template.id}
        templateName={template.name}
        open={previewOpen}
        onClose={() => setPreviewOpen(false)}
      />
    </>
  );
}
