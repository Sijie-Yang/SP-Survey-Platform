import React, { memo, useMemo } from 'react';
import {
  Alert, Box, Button, Chip, Paper, Stack, Typography,
} from '@mui/material';
import { Clear } from '@mui/icons-material';
import {
  buildPaperLibraryAnalytics,
  filterLabel,
  LOCATION_CHART_MIN_COVERAGE,
} from '../../lib/researchPaperAnalytics';

function CoverageChip({ label, tagged, total }) {
  if (!total) return null;
  return (
    <Chip
      size="small"
      variant="outlined"
      label={`${label}: ${tagged}/${total}`}
      sx={{ fontWeight: 500 }}
    />
  );
}

function CountBarChart({
  title,
  caption,
  rows,
  activeId,
  onSelect,
  maxItems = 10,
}) {
  const items = (rows || []).slice(0, maxItems);
  if (!items.length) return null;
  const max = Math.max(...items.map((r) => r.count), 1);

  return (
    <Paper variant="outlined" sx={{ p: 1.5, height: '100%' }}>
      <Typography variant="subtitle2" fontWeight={700} sx={{ mb: 0.25 }}>
        {title}
      </Typography>
      {caption && (
        <Typography variant="caption" color="text.secondary" display="block" sx={{ mb: 1 }}>
          {caption}
        </Typography>
      )}
      <Stack spacing={0.75}>
        {items.map((row) => {
          const selected = activeId === row.id;
          return (
            <Box
              key={`${row.dimension}-${row.id}`}
              onClick={() => onSelect?.(row)}
              role={onSelect ? 'button' : undefined}
              tabIndex={onSelect ? 0 : undefined}
              onKeyDown={(e) => {
                if (!onSelect) return;
                if (e.key === 'Enter' || e.key === ' ') {
                  e.preventDefault();
                  onSelect(row);
                }
              }}
              sx={{
                cursor: onSelect ? 'pointer' : 'default',
                borderRadius: 1,
                px: 0.5,
                py: 0.25,
                bgcolor: selected ? 'action.selected' : 'transparent',
                '&:hover': onSelect ? { bgcolor: 'action.hover' } : undefined,
              }}
            >
              <Stack direction="row" spacing={1} alignItems="center">
                <Typography
                  variant="caption"
                  sx={{ width: 132, flexShrink: 0, fontWeight: selected ? 700 : 500 }}
                  noWrap
                  title={row.label}
                >
                  {row.label}
                </Typography>
                <Box sx={{ flex: 1, height: 10, bgcolor: 'grey.100', borderRadius: 1, overflow: 'hidden' }}>
                  <Box
                    sx={{
                      width: `${(row.count / max) * 100}%`,
                      height: '100%',
                      bgcolor: selected ? 'primary.dark' : 'primary.main',
                      opacity: 0.85,
                    }}
                  />
                </Box>
                <Typography variant="caption" color="text.secondary" sx={{ width: 44, textAlign: 'right' }}>
                  {row.count}
                </Typography>
              </Stack>
            </Box>
          );
        })}
      </Stack>
    </Paper>
  );
}

function YearBars({ rows, activeId, onSelect }) {
  if (!rows?.length) return null;
  const max = Math.max(...rows.map((r) => r.count), 1);
  return (
    <Paper variant="outlined" sx={{ p: 1.5 }}>
      <Typography variant="subtitle2" fontWeight={700} sx={{ mb: 0.25 }}>
        Publications by year
      </Typography>
      <Typography variant="caption" color="text.secondary" display="block" sx={{ mb: 1 }}>
        Click a year to filter the list below.
      </Typography>
      <Box
        sx={{
          display: 'flex',
          alignItems: 'flex-end',
          gap: 0.5,
          height: 120,
          overflowX: 'auto',
          pb: 0.5,
        }}
      >
        {rows.map((row) => {
          const selected = activeId === row.id;
          const h = Math.max(4, Math.round((row.count / max) * 96));
          return (
            <Box
              key={row.id}
              onClick={() => onSelect?.(row)}
              role="button"
              tabIndex={0}
              onKeyDown={(e) => {
                if (e.key === 'Enter' || e.key === ' ') {
                  e.preventDefault();
                  onSelect?.(row);
                }
              }}
              title={`${row.label}: ${row.count}`}
              sx={{
                minWidth: 28,
                flex: '1 1 28px',
                display: 'flex',
                flexDirection: 'column',
                alignItems: 'center',
                justifyContent: 'flex-end',
                cursor: 'pointer',
                opacity: selected ? 1 : 0.85,
              }}
            >
              <Typography variant="caption" color="text.secondary" sx={{ mb: 0.25, fontSize: 10 }}>
                {row.count}
              </Typography>
              <Box
                sx={{
                  width: '70%',
                  height: h,
                  bgcolor: selected ? 'primary.dark' : 'primary.main',
                  borderRadius: '3px 3px 0 0',
                }}
              />
              <Typography variant="caption" sx={{ mt: 0.5, fontSize: 10, fontWeight: selected ? 700 : 400 }}>
                {String(row.label).slice(2)}
              </Typography>
            </Box>
          );
        })}
      </Box>
    </Paper>
  );
}

/**
 * Library-wide analytics (uses full paper set; filters only highlight/select).
 */
const PaperLibraryAnalytics = memo(function PaperLibraryAnalytics({
  papers,
  filters = [],
  onToggleFilter,
  onClearFilters,
}) {
  const analytics = useMemo(() => buildPaperLibraryAnalytics(papers), [papers]);
  const activeByDim = useMemo(() => {
    const map = {};
    for (const f of filters) map[f.dimension] = f.id;
    return map;
  }, [filters]);

  if (!analytics.total) return null;

  const showLocations = analytics.coverage.location / analytics.total >= LOCATION_CHART_MIN_COVERAGE;

  const handleSelect = (row) => {
    if (!onToggleFilter) return;
    onToggleFilter({
      dimension: row.dimension,
      id: row.id,
      label: row.label,
    });
  };

  return (
    <Box sx={{ mb: 2.5 }}>
      <Stack direction="row" spacing={1} alignItems="center" flexWrap="wrap" sx={{ mb: 1 }}>
        <Typography variant="subtitle1" fontWeight={800}>
          Library profile
        </Typography>
        <Chip size="small" color="primary" variant="outlined" label={`${analytics.total} papers`} />
        {analytics.yearMin && analytics.yearMax && (
          <Chip size="small" variant="outlined" label={`${analytics.yearMin}–${analytics.yearMax}`} />
        )}
      </Stack>

      <Alert severity="info" sx={{ mb: 1.5 }}>
        Tags are rule-extracted from title, abstract, and keywords (not author-curated metadata).
        Bars show library-wide counts; click to filter the list. Coverage chips = papers with ≥1 tag / total.
      </Alert>

      <Stack direction="row" spacing={1} flexWrap="wrap" useFlexGap sx={{ mb: 1.5 }}>
        <CoverageChip label="Perception" tagged={analytics.coverage.perception} total={analytics.total} />
        <CoverageChip label="Imagery" tagged={analytics.coverage.imagery} total={analytics.total} />
        <CoverageChip label="Scale" tagged={analytics.coverage.scale} total={analytics.total} />
        <CoverageChip label="Survey" tagged={analytics.coverage.survey} total={analytics.total} />
        <CoverageChip label="Sample size" tagged={analytics.coverage.sample_size} total={analytics.total} />
        <CoverageChip label="Location" tagged={analytics.coverage.location} total={analytics.total} />
      </Stack>

      {filters.length > 0 && (
        <Stack direction="row" spacing={1} alignItems="center" flexWrap="wrap" useFlexGap sx={{ mb: 1.5 }}>
          {filters.map((f) => (
            <Chip
              key={`${f.dimension}:${f.id}`}
              size="small"
              color="primary"
              label={filterLabel(f)}
              onDelete={() => onToggleFilter?.(f)}
            />
          ))}
          <Button size="small" startIcon={<Clear />} onClick={onClearFilters}>
            Clear filters
          </Button>
        </Stack>
      )}

      <Box sx={{ mb: 1.5 }}>
        <YearBars
          rows={analytics.byYear}
          activeId={activeByDim.year}
          onSelect={handleSelect}
        />
      </Box>

      <Box
        sx={{
          display: 'grid',
          gridTemplateColumns: { xs: '1fr', md: '1fr 1fr' },
          gap: 1.5,
          mb: 1.5,
        }}
      >
        <CountBarChart
          title="Perception dimensions"
          caption={`Tagged ${analytics.coverage.perception}/${analytics.total} papers`}
          rows={analytics.perception.map((r) => ({ ...r, dimension: 'perception' }))}
          activeId={activeByDim.perception}
          onSelect={handleSelect}
        />
        <CountBarChart
          title="Imagery / data sources"
          caption={`Tagged ${analytics.coverage.imagery}/${analytics.total} papers`}
          rows={analytics.imagery.map((r) => ({ ...r, dimension: 'imagery' }))}
          activeId={activeByDim.imagery}
          onSelect={handleSelect}
        />
        <CountBarChart
          title="Spatial scales"
          caption={`Tagged ${analytics.coverage.scale}/${analytics.total} papers`}
          rows={analytics.scale.map((r) => ({ ...r, dimension: 'scale' }))}
          activeId={activeByDim.scale}
          onSelect={handleSelect}
        />
        <CountBarChart
          title="Survey methods"
          caption={`Tagged ${analytics.coverage.survey}/${analytics.total} papers`}
          rows={analytics.survey.map((r) => ({ ...r, dimension: 'survey' }))}
          activeId={activeByDim.survey}
          onSelect={handleSelect}
        />
        <CountBarChart
          title="Survey sample size"
          caption={
            analytics.sampleSize.tagged
              ? `Extracted ${analytics.sampleSize.tagged}/${analytics.total}`
                + (analytics.sampleSize.median != null
                  ? ` · median ≈ ${analytics.sampleSize.median}`
                  : '')
              : 'Few abstracts report an explicit N'
          }
          rows={analytics.sampleSize.series}
          activeId={activeByDim.sample_size}
          onSelect={handleSelect}
        />
        <CountBarChart
          title="Top venues"
          caption="Most frequent journals / sources in this library"
          rows={analytics.venues}
          activeId={activeByDim.venue}
          onSelect={handleSelect}
          maxItems={10}
        />
        {showLocations && (
          <CountBarChart
            title="Study locations (mentioned)"
            caption={`Tagged ${analytics.coverage.location}/${analytics.total} · abstract/keyword mentions only`}
            rows={analytics.locations.map((r) => ({ ...r, dimension: 'locations' }))}
            activeId={activeByDim.locations}
            onSelect={handleSelect}
          />
        )}
        <CountBarChart
          title="Analysis methods"
          caption={`Tagged ${analytics.coverage.methods}/${analytics.total} papers`}
          rows={analytics.researchMethods.map((r) => ({ ...r, dimension: 'researchMethods' }))}
          activeId={activeByDim.researchMethods}
          onSelect={handleSelect}
        />
      </Box>
    </Box>
  );
});

export default PaperLibraryAnalytics;
