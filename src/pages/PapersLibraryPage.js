import React, { useCallback, useEffect, useMemo, useRef, useState, memo } from 'react';
import { useVirtualizer } from '@tanstack/react-virtual';
import {
  Alert, Box, Button, Chip, CircularProgress, Container, IconButton,
  Paper, Stack, TextField, Tooltip, Typography,
} from '@mui/material';
import { Clear, OpenInNew, Search } from '@mui/icons-material';
import PublicHeader, { PublicFooter } from '../components/layout/PublicHeader';
import { listPublicResearchPapers } from '../lib/researchPaperStore';
import { ensureAnalysisMeta } from '../lib/researchPaperMeta.mjs';
import { paperMatchesMetaFilters } from '../lib/researchPaperAnalytics';
import PaperLibraryAnalytics from '../components/papers/PaperLibraryAnalytics';

const ROW_H = 56;
const COLS = '52px minmax(0, 1fr) 64px 120px 56px';

function sourceLabel(s) {
  if (s === 'semantic_scholar') return 'S2';
  if (s === 'scopus') return 'Scopus';
  return s;
}

function sortPapersStable(rows) {
  return [...(rows || [])].sort((a, b) => {
    const ya = a.year || 0;
    const yb = b.year || 0;
    if (ya !== yb) return yb - ya;
    const sa = Number(a.relevance_score) || 0;
    const sb = Number(b.relevance_score) || 0;
    if (sa !== sb) return sb - sa;
    const ta = String(a.title || '').localeCompare(String(b.title || ''), undefined, { sensitivity: 'base' });
    if (ta !== 0) return ta;
    return String(a.id || a.doi || a.title || '').localeCompare(String(b.id || b.doi || b.title || ''));
  });
}

function normalizePaper(p, i = 0) {
  const paper = {
    id: p.id || p.doi || `paper-${i}`,
    doi: p.doi || '',
    title: p.title || '',
    authors: p.authors || [],
    year: p.year || null,
    abstract: p.abstract || '',
    venue: p.venue || '',
    paper_url: p.paper_url || (p.doi ? `https://doi.org/${p.doi}` : null),
    keywords: Array.isArray(p.keywords) ? p.keywords : [],
    relevance_score: p.relevance_score ?? null,
    sources: p.sources || ['scopus'],
    template_id: p.template_id || null,
    analysis_meta: p.analysis_meta || {},
  };
  paper.analysis_meta = ensureAnalysisMeta(paper);
  return paper;
}

async function loadShortlistFallback() {
  const res = await fetch('/research/scopus-shortlist.json');
  if (!res.ok) throw new Error(`Could not load shortlist (${res.status})`);
  const payload = await res.json();
  return (payload.papers || []).map((p, i) => normalizePaper(p, i));
}

const PapersList = memo(function PapersList({ rows }) {
  const parentRef = useRef(null);
  const virtualizer = useVirtualizer({
    count: rows.length,
    getScrollElement: () => parentRef.current,
    estimateSize: () => ROW_H,
    overscan: 16,
  });

  if (!rows.length) {
    return (
      <Typography variant="body2" color="text.secondary" sx={{ py: 4, textAlign: 'center' }}>
        No matching papers.
      </Typography>
    );
  }

  return (
    <Paper variant="outlined" sx={{ overflow: 'hidden' }}>
      <Box
        sx={{
          display: 'grid',
          gridTemplateColumns: COLS,
          gap: 1,
          px: 1.5,
          py: 0.75,
          bgcolor: 'grey.50',
          borderBottom: 1,
          borderColor: 'divider',
          fontWeight: 700,
          typography: 'caption',
          color: 'text.secondary',
        }}
      >
        <Box textAlign="right">#</Box>
        <Box>Title</Box>
        <Box textAlign="center">Year</Box>
        <Box>Template</Box>
        <Box textAlign="right">Link</Box>
      </Box>
      <Box ref={parentRef} sx={{ height: '70vh', overflow: 'auto', position: 'relative' }}>
        <Box sx={{ height: virtualizer.getTotalSize(), width: '100%', position: 'relative' }}>
          {virtualizer.getVirtualItems().map((vRow) => {
            const paper = rows[vRow.index];
            const href = paper.paper_url
              || (paper.doi ? `https://doi.org/${paper.doi}` : null);
            return (
              <Box
                key={paper.id || `${paper.doi}-${vRow.index}`}
                sx={{
                  position: 'absolute',
                  top: 0,
                  left: 0,
                  width: '100%',
                  height: `${vRow.size}px`,
                  transform: `translateY(${vRow.start}px)`,
                  display: 'grid',
                  gridTemplateColumns: COLS,
                  gap: 1,
                  alignItems: 'center',
                  px: 1.5,
                  borderBottom: 1,
                  borderColor: 'divider',
                  '&:hover': { bgcolor: 'action.hover' },
                }}
              >
                <Typography variant="caption" color="text.secondary" textAlign="right">
                  {vRow.index + 1}
                </Typography>
                <Box sx={{ minWidth: 0 }}>
                  <Typography variant="body2" fontWeight={600} noWrap title={paper.title}>
                    {paper.title}
                  </Typography>
                  <Typography
                    variant="caption"
                    color="text.secondary"
                    noWrap
                    display="block"
                    title={paper.abstract || ''}
                  >
                    {(paper.authors || []).slice(0, 2).join(', ') || '—'}
                    {paper.venue ? ` · ${paper.venue}` : ''}
                    {paper.doi ? ` · ${paper.doi}` : ''}
                    {(paper.sources || []).length
                      ? ` · ${(paper.sources || []).map(sourceLabel).join(', ')}`
                      : ''}
                  </Typography>
                </Box>
                <Typography variant="body2" textAlign="center">{paper.year || '—'}</Typography>
                <Box sx={{ minWidth: 0 }}>
                  {paper.template_id ? (
                    <Chip
                      size="small"
                      color="success"
                      variant="outlined"
                      label={paper.template_id}
                      title={`Linked survey template: ${paper.template_id}`}
                      sx={{ maxWidth: '100%', '& .MuiChip-label': { overflow: 'hidden', textOverflow: 'ellipsis' } }}
                    />
                  ) : (
                    <Typography variant="caption" color="text.disabled">—</Typography>
                  )}
                </Box>
                <Box display="flex" justifyContent="flex-end">
                  {href ? (
                    <Tooltip title="Open paper">
                      <IconButton
                        size="small"
                        component="a"
                        href={href}
                        target="_blank"
                        rel="noreferrer"
                      >
                        <OpenInNew fontSize="small" />
                      </IconButton>
                    </Tooltip>
                  ) : (
                    <Typography variant="caption" color="text.disabled">—</Typography>
                  )}
                </Box>
              </Box>
            );
          })}
        </Box>
      </Box>
    </Paper>
  );
});

/** Public browse of the urban-perception paper library. */
export default function PapersLibraryPage() {
  const [papers, setPapers] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [sourceNote, setSourceNote] = useState('');
  const [activeFilter, setActiveFilter] = useState('');
  const [metaFilters, setMetaFilters] = useState([]);
  const searchRef = useRef(null);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      setLoading(true);
      setError('');
      try {
        let rows = [];
        let note = '';
        let liveError = '';
        try {
          rows = await listPublicResearchPapers();
          if (rows.length) {
            note = `From platform library (${rows.length} approved)`;
          }
        } catch (err) {
          liveError = err.message || String(err);
          rows = [];
        }
        if (!rows.length) {
          rows = await loadShortlistFallback();
          note = `From published Scopus shortlist (${rows.length})`
            + (liveError
              ? ` — live library unread (${liveError}). Run public RLS + analysis_meta migration, then refresh.`
              : ' — live library empty or public read policy not applied yet.');
        } else {
          rows = rows.map((p, i) => normalizePaper(p, i));
        }
        if (!cancelled) {
          setPapers(sortPapersStable(rows));
          setSourceNote(note);
        }
      } catch (err) {
        if (!cancelled) setError(err.message || String(err));
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => { cancelled = true; };
  }, []);

  const filtered = useMemo(() => {
    const q = activeFilter.trim().toLowerCase();
    return papers.filter((p) => {
      if (!paperMatchesMetaFilters(p, metaFilters)) return false;
      if (!q) return true;
      const hay = [
        p.title,
        p.doi,
        p.venue,
        ...(p.authors || []),
      ].join(' ').toLowerCase();
      return hay.includes(q);
    });
  }, [papers, activeFilter, metaFilters]);

  const runSearch = useCallback(() => {
    setActiveFilter((searchRef.current?.value || '').trim());
  }, []);

  const clearSearch = useCallback(() => {
    if (searchRef.current) searchRef.current.value = '';
    setActiveFilter('');
  }, []);

  const toggleMetaFilter = useCallback((next) => {
    setMetaFilters((prev) => {
      const exists = prev.find((f) => f.dimension === next.dimension && f.id === next.id);
      if (exists) return prev.filter((f) => !(f.dimension === next.dimension && f.id === next.id));
      // One active value per dimension (replace)
      const withoutDim = prev.filter((f) => f.dimension !== next.dimension);
      return [...withoutDim, next];
    });
  }, []);

  const clearMetaFilters = useCallback(() => setMetaFilters([]), []);

  return (
    <Box sx={{ minHeight: '100vh', bgcolor: 'background.default', display: 'flex', flexDirection: 'column' }}>
      <PublicHeader />

      <Container maxWidth="lg" sx={{ py: 4, flex: 1 }}>
        <Stack direction="row" spacing={1.5} alignItems="center" flexWrap="wrap" sx={{ mb: 1 }}>
          <Typography variant="h4" fontWeight={800}>
            Paper library
          </Typography>
          {!loading && (
            <>
              <Chip size="small" label={`${papers.length} papers`} color="primary" variant="outlined" />
              <Chip
                size="small"
                label={`${papers.filter((p) => p.template_id).length} linked templates`}
                color={papers.some((p) => p.template_id) ? 'success' : 'default'}
                variant="outlined"
              />
            </>
          )}
        </Stack>
        <Typography variant="body1" color="text.secondary" sx={{ mb: 2, maxWidth: 720 }}>
          Curated urban imagery × human-survey literature used to ground survey templates on this platform.
          Linked template IDs appear when admins match a paper to an existing survey template.
          {sourceNote ? ` (${sourceNote})` : ''}
        </Typography>

        <Stack direction="row" spacing={1} alignItems="center" flexWrap="wrap" sx={{ mb: 2 }}>
          <TextField
            size="small"
            placeholder="Title / DOI / venue / author"
            inputRef={searchRef}
            defaultValue=""
            onKeyDown={(e) => { if (e.key === 'Enter') runSearch(); }}
            sx={{ width: 280 }}
            inputProps={{ autoComplete: 'off' }}
          />
          <Button size="small" variant="contained" startIcon={<Search />} onClick={runSearch}>
            Search
          </Button>
          {activeFilter ? (
            <Button size="small" startIcon={<Clear />} onClick={clearSearch}>
              Clear search
            </Button>
          ) : null}
        </Stack>

        {error && (
          <Alert severity="error" sx={{ mb: 2 }}>{error}</Alert>
        )}

        {loading ? (
          <Box sx={{ display: 'flex', justifyContent: 'center', py: 8 }}>
            <CircularProgress />
          </Box>
        ) : (
          <>
            <PaperLibraryAnalytics
              papers={papers}
              filters={metaFilters}
              onToggleFilter={toggleMetaFilter}
              onClearFilters={clearMetaFilters}
            />
            <Typography variant="subtitle2" fontWeight={700} sx={{ mb: 0.75 }}>
              {activeFilter || metaFilters.length
                ? `Showing ${filtered.length} / ${papers.length} papers`
                : `${filtered.length} papers`}
              {activeFilter ? ` · text “${activeFilter}”` : ''}
            </Typography>
            <PapersList rows={filtered} />
          </>
        )}
      </Container>

      <PublicFooter />
    </Box>
  );
}
