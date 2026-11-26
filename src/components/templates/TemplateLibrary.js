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
  return [tpl.name, tpl.author, tpl.description, tpl.id, tpl.year && String(tpl.year)]
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

async function loadTemplates() {
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
        const [mediaResult, previewPool, coverIndex] = await Promise.all([mediaPromise, previewPoolPromise, coverIndexPromise]);
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

function TemplatePreviewDialog({ templateId, templateName, open, onClose }) {
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
