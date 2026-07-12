import React, { memo, useMemo, useState } from 'react';
import {
  Box, Button, Chip, Collapse, Stack, Tab, Tabs, Typography,
} from '@mui/material';
import {
  Clear, ExpandLess, ExpandMore,
} from '@mui/icons-material';
import {
  buildLibraryDashboard,
  filterLabel,
  LOCATION_CHART_MIN_COVERAGE,
  canonicalFilterDimension,
} from '../../lib/researchPaperAnalytics';

const TONES = {
  teal: { solid: '#0f766e', soft: '#ccfbf1', ink: '#134e4a', bar: '#14b8a6' },
  amber: { solid: '#b45309', soft: '#ffedd5', ink: '#7c2d12', bar: '#f59e0b' },
  moss: { solid: '#3f6212', soft: '#ecfccb', ink: '#365314', bar: '#65a30d' },
  ink: { solid: '#1e3a5f', soft: '#e2e8f0', ink: '#0f172a', bar: '#334155' },
  coral: { solid: '#9f1239', soft: '#ffe4e6', ink: '#881337', bar: '#e11d48' },
  slate: { solid: '#475569', soft: '#f1f5f9', ink: '#1e293b', bar: '#64748b' },
};

const DIM_TONE = {
  year: 'ink',
  perception: 'teal',
  visualSource: 'amber',
  presentation: 'amber',
  viewContext: 'amber',
  scale: 'slate',
  responseProtocol: 'moss',
  measurementChannel: 'moss',
  recruitment: 'slate',
  sample_size: 'coral',
  countries: 'amber',
  regions: 'amber',
  researchMethods: 'coral',
};

function toneOf(key) {
  return TONES[DIM_TONE[key] || key] || TONES.slate;
}

function CoverageRing({ label, tagged, total, tone = 'slate', hint }) {
  const t = toneOf(tone);
  const pct = total ? tagged / total : 0;
  const r = 16;
  const c = 2 * Math.PI * r;
  const dash = Math.max(0.001, pct) * c;
  return (
    <Box
      title={hint}
      sx={{
        display: 'flex',
        alignItems: 'center',
        gap: 0.85,
        px: 1,
        py: 0.65,
        borderRadius: 2,
        bgcolor: 'rgba(255,255,255,0.78)',
        border: '1px solid',
        borderColor: 'rgba(15,39,68,0.08)',
        minWidth: 148,
      }}
    >
      <Box sx={{ position: 'relative', width: 40, height: 40, flexShrink: 0 }}>
        <svg width="40" height="40" viewBox="0 0 40 40" aria-hidden>
          <circle cx="20" cy="20" r={r} fill="none" stroke={t.soft} strokeWidth="4.5" />
          <circle
            cx="20"
            cy="20"
            r={r}
            fill="none"
            stroke={t.bar}
            strokeWidth="4.5"
            strokeLinecap="round"
            strokeDasharray={`${dash} ${c}`}
            transform="rotate(-90 20 20)"
          />
        </svg>
        <Typography
          variant="caption"
          sx={{
            position: 'absolute',
            inset: 0,
            display: 'grid',
            placeItems: 'center',
            fontWeight: 800,
            fontSize: 9,
            color: t.ink,
          }}
        >
          {`${Math.round(pct * 100)}%`}
        </Typography>
      </Box>
      <Box sx={{ minWidth: 0 }}>
        <Typography variant="caption" color="text.secondary" display="block" lineHeight={1.15}>
          {label}
        </Typography>
        <Typography variant="caption" fontWeight={700} sx={{ color: t.ink }} noWrap>
          {tagged}/{total}
        </Typography>
      </Box>
    </Box>
  );
}

function SpotlightCard({ spot, onSelect }) {
  const t = toneOf(spot.tone);
  const clickable = Boolean(spot.filter && onSelect);
  return (
    <Box
      onClick={() => clickable && onSelect(spot.filter)}
      role={clickable ? 'button' : undefined}
      tabIndex={clickable ? 0 : undefined}
      onKeyDown={(e) => {
        if (!clickable) return;
        if (e.key === 'Enter' || e.key === ' ') {
          e.preventDefault();
          onSelect(spot.filter);
        }
      }}
      sx={{
        p: 1.35,
        borderRadius: 2,
        bgcolor: t.soft,
        border: '1px solid',
        borderColor: 'rgba(15,39,68,0.06)',
        cursor: clickable ? 'pointer' : 'default',
        height: '100%',
        '&:hover': clickable ? { boxShadow: '0 8px 20px rgba(15,39,68,0.08)' } : undefined,
      }}
    >
      <Typography
        variant="caption"
        sx={{
          letterSpacing: '0.08em',
          textTransform: 'uppercase',
          fontWeight: 700,
          color: t.solid,
          fontSize: 10,
        }}
      >
        {spot.eyebrow}
      </Typography>
      <Typography
        variant="subtitle1"
        sx={{ mt: 0.35, fontWeight: 800, color: t.ink, lineHeight: 1.25, fontSize: '0.98rem' }}
      >
        {spot.title}
      </Typography>
      <Typography variant="caption" sx={{ mt: 0.5, display: 'block', color: t.ink, opacity: 0.75 }}>
        {spot.detail}
        {clickable ? ' · filter' : ''}
      </Typography>
    </Box>
  );
}

function ComparedBars({
  title,
  caption,
  rows,
  activeId,
  onSelect,
  tone = 'slate',
  maxItems = 8,
  showBaseline = false,
}) {
  const t = toneOf(tone);
  const items = (rows || []).filter((r) => r.count > 0 || (showBaseline && r.baselineCount > 0)).slice(0, maxItems);
  if (!items.length) return null;
  const maxShare = Math.max(
    ...items.map((r) => Math.max(r.share || 0, showBaseline ? (r.baselineShare || 0) : 0)),
    0.01,
  );

  return (
    <Box
      sx={{
        p: 1.5,
        height: '100%',
        borderRadius: 2,
        bgcolor: 'rgba(255,255,255,0.85)',
        border: '1px solid',
        borderColor: 'rgba(15,39,68,0.08)',
      }}
    >
      <Stack direction="row" spacing={1} alignItems="baseline" sx={{ mb: 0.25 }}>
        <Box sx={{ width: 8, height: 8, borderRadius: '50%', bgcolor: t.bar, flexShrink: 0 }} />
        <Typography variant="subtitle2" fontWeight={800} sx={{ color: t.ink }}>
          {title}
        </Typography>
      </Stack>
      {caption && (
        <Typography variant="caption" color="text.secondary" display="block" sx={{ mb: 1, pl: 2 }}>
          {caption}
        </Typography>
      )}
      <Stack spacing={0.75}>
        {items.map((row) => {
          const selected = activeId === row.id;
          const subsetPct = ((row.share || 0) / maxShare) * 100;
          const basePct = ((row.baselineShare || 0) / maxShare) * 100;
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
                borderRadius: 1.25,
                px: 0.6,
                py: 0.35,
                bgcolor: selected ? t.soft : 'transparent',
                outline: selected ? `1px solid ${t.bar}55` : '1px solid transparent',
                '&:hover': onSelect ? { bgcolor: t.soft } : undefined,
              }}
            >
              <Stack direction="row" spacing={1} alignItems="center" sx={{ mb: 0.3 }}>
                <Typography
                  variant="caption"
                  sx={{ flex: 1, fontWeight: selected ? 800 : 600, color: t.ink }}
                  noWrap
                  title={row.label}
                >
                  {row.label}
                </Typography>
                <Typography
                  variant="caption"
                  sx={{ fontWeight: 700, color: t.solid, fontVariantNumeric: 'tabular-nums' }}
                >
                  {row.count}
                  <Typography component="span" variant="caption" sx={{ ml: 0.5, color: 'text.secondary' }}>
                    {`${Math.round((row.share || 0) * 100)}%`}
                  </Typography>
                  {showBaseline && Number.isFinite(row.deltaPp) ? (
                    <Typography
                      component="span"
                      variant="caption"
                      sx={{
                        ml: 0.6,
                        color: row.deltaPp > 1 ? '#047857' : row.deltaPp < -1 ? '#b91c1c' : 'text.secondary',
                        fontWeight: 600,
                      }}
                    >
                      {row.deltaPp > 0 ? '+' : ''}
                      {row.deltaPp.toFixed(0)}pp
                    </Typography>
                  ) : null}
                </Typography>
              </Stack>
              <Box sx={{ position: 'relative', height: 8, borderRadius: 99, bgcolor: 'rgba(15,39,68,0.06)' }}>
                {showBaseline && (
                  <Box
                    sx={{
                      position: 'absolute',
                      left: 0,
                      top: 0,
                      bottom: 0,
                      width: `${basePct}%`,
                      borderRadius: 99,
                      bgcolor: `${t.bar}33`,
                    }}
                  />
                )}
                <Box
                  sx={{
                    position: 'absolute',
                    left: 0,
                    top: 0,
                    bottom: 0,
                    width: `${subsetPct}%`,
                    borderRadius: 99,
                    background: `linear-gradient(90deg, ${t.bar}, ${t.solid})`,
                  }}
                />
              </Box>
            </Box>
          );
        })}
      </Stack>
    </Box>
  );
}

function YearRibbon({ rows, activeId, onSelect }) {
  if (!rows?.length) return null;
  const max = Math.max(...rows.map((r) => r.count), 1);
  const t = toneOf('year');
  return (
    <Box
      sx={{
        p: 1.5,
        borderRadius: 2,
        bgcolor: 'rgba(255,255,255,0.85)',
        border: '1px solid',
        borderColor: 'rgba(15,39,68,0.08)',
      }}
    >
      <Typography variant="subtitle2" fontWeight={800} sx={{ color: t.ink }}>
        Publications by year
      </Typography>
      <Typography variant="caption" color="text.secondary" display="block" sx={{ mb: 1 }}>
        Dated papers only · future years excluded · click to filter
      </Typography>
      <Box
        sx={{
          display: 'flex',
          alignItems: 'flex-end',
          gap: 0.5,
          height: 120,
          overflowX: 'auto',
          pb: 0.25,
        }}
      >
        {rows.map((row) => {
          const selected = activeId === row.id;
          const h = Math.max(6, Math.round((row.count / max) * 88));
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
                minWidth: 26,
                flex: '1 1 26px',
                display: 'flex',
                flexDirection: 'column',
                alignItems: 'center',
                justifyContent: 'flex-end',
                cursor: 'pointer',
              }}
            >
              <Typography
                variant="caption"
                sx={{
                  mb: 0.3,
                  fontSize: 9,
                  fontWeight: 700,
                  color: selected ? t.solid : 'text.secondary',
                }}
              >
                {row.count}
              </Typography>
              <Box
                sx={{
                  width: '70%',
                  height: h,
                  borderRadius: '6px 6px 2px 2px',
                  background: selected
                    ? `linear-gradient(180deg, ${t.bar}, ${t.solid})`
                    : `linear-gradient(180deg, ${t.bar}bb, ${t.solid}88)`,
                }}
              />
              <Typography
                variant="caption"
                sx={{ mt: 0.45, fontSize: 9, fontWeight: selected ? 800 : 500, color: t.ink }}
              >
                {String(row.label).slice(2)}
              </Typography>
            </Box>
          );
        })}
      </Box>
    </Box>
  );
}

function Heatmap({
  title,
  caption,
  matrix,
  activeRowId,
  activeColId,
  onSelectCell,
}) {
  if (!matrix?.rows?.length || !matrix?.cols?.length) {
    return (
      <Box
        sx={{
          p: 1.5,
          borderRadius: 2,
          bgcolor: 'rgba(255,255,255,0.85)',
          border: '1px solid',
          borderColor: 'rgba(15,39,68,0.08)',
        }}
      >
        <Typography variant="subtitle2" fontWeight={800}>{title}</Typography>
        <Typography variant="caption" color="text.secondary">
          {caption || 'Insufficient tagged papers in the current cohort.'}
        </Typography>
      </Box>
    );
  }
  const max = Math.max(matrix.max || 1, 1);
  const cellMap = new Map(matrix.cells.map((c) => [`${c.rowId}|${c.colId}`, c]));

  return (
    <Box
      sx={{
        p: 1.5,
        borderRadius: 2,
        bgcolor: 'rgba(255,255,255,0.85)',
        border: '1px solid',
        borderColor: 'rgba(15,39,68,0.08)',
        overflowX: 'auto',
      }}
    >
      <Typography variant="subtitle2" fontWeight={800} sx={{ color: '#0f2744' }}>
        {title}
      </Typography>
      <Typography variant="caption" color="text.secondary" display="block" sx={{ mb: 1 }}>
        {caption}
        {Number.isFinite(matrix.effectiveN)
          ? ` · effective n=${matrix.effectiveN} / cohort ${matrix.cohortSize}`
          : ''}
      </Typography>
      <Box
        sx={{
          display: 'grid',
          gridTemplateColumns: `120px repeat(${matrix.cols.length}, minmax(52px, 1fr))`,
          gap: 0.5,
          minWidth: 120 + matrix.cols.length * 56,
        }}
      >
        <Box />
        {matrix.cols.map((col) => (
          <Typography
            key={col.id}
            variant="caption"
            sx={{
              fontWeight: activeColId === col.id ? 800 : 600,
              color: '#0f2744',
              textAlign: 'center',
              lineHeight: 1.15,
              px: 0.25,
            }}
            title={col.label}
          >
            {col.label.length > 14 ? `${col.label.slice(0, 12)}…` : col.label}
          </Typography>
        ))}
        {matrix.rows.map((row) => (
          <React.Fragment key={row.id}>
            <Typography
              variant="caption"
              sx={{
                fontWeight: activeRowId === row.id ? 800 : 600,
                color: '#0f2744',
                alignSelf: 'center',
                pr: 0.5,
              }}
              noWrap
              title={row.label}
            >
              {row.label}
            </Typography>
            {matrix.cols.map((col) => {
              const cell = cellMap.get(`${row.id}|${col.id}`);
              const count = cell?.count || 0;
              const intensity = count / max;
              const selected = activeRowId === row.id && activeColId === col.id;
              const payload = cell || {
                rowId: row.id,
                colId: col.id,
                count: 0,
                rowDimension: matrix.rowDimension,
                colDimension: matrix.colDimension,
                rowLabel: row.label,
                colLabel: col.label,
              };
              const disabled = count === 0;
              return (
                <Box
                  key={`${row.id}-${col.id}`}
                  onClick={() => !disabled && onSelectCell?.(payload)}
                  role="button"
                  tabIndex={disabled ? -1 : 0}
                  aria-disabled={disabled}
                  onKeyDown={(e) => {
                    if (disabled) return;
                    if (e.key === 'Enter' || e.key === ' ') {
                      e.preventDefault();
                      onSelectCell?.(payload);
                    }
                  }}
                  title={`${row.label} × ${col.label}: ${count}${cell?.rowShare != null ? ` (${Math.round(cell.rowShare * 100)}% of row)` : ''}`}
                  sx={{
                    height: 34,
                    borderRadius: 1,
                    display: 'grid',
                    placeItems: 'center',
                    cursor: disabled ? 'default' : 'pointer',
                    opacity: disabled ? 0.55 : 1,
                    bgcolor: count
                      ? `rgba(15, 118, 110, ${0.12 + intensity * 0.72})`
                      : 'rgba(15,39,68,0.04)',
                    outline: selected ? '2px solid #0f2744' : '1px solid transparent',
                    color: intensity > 0.55 ? '#fff' : '#0f2744',
                    fontSize: 11,
                    fontWeight: 700,
                    fontVariantNumeric: 'tabular-nums',
                  }}
                >
                  {count || '·'}
                </Box>
              );
            })}
          </React.Fragment>
        ))}
      </Box>
    </Box>
  );
}

function ReportingPanel({ reporting }) {
  if (!reporting?.signals?.length) return null;
  return (
    <Box
      sx={{
        p: 1.5,
        borderRadius: 2,
        bgcolor: 'rgba(255,255,255,0.85)',
        border: '1px solid',
        borderColor: 'rgba(15,39,68,0.08)',
        height: '100%',
      }}
    >
      <Typography variant="subtitle2" fontWeight={800} sx={{ color: '#0f2744' }}>
        Abstract reporting coverage
      </Typography>
      <Typography variant="caption" color="text.secondary" display="block" sx={{ mb: 1.25 }}>
        View-only rule hits — not a reproducibility audit; not filterable.
      </Typography>
      <Stack spacing={1}>
        {reporting.signals.map((s) => {
          const pct = Math.round((s.share || 0) * 100);
          return (
            <Box key={s.id}>
              <Stack direction="row" justifyContent="space-between" sx={{ mb: 0.35 }}>
                <Typography variant="caption" fontWeight={600} sx={{ color: '#0f2744' }}>
                  {s.label}
                </Typography>
                <Typography variant="caption" fontWeight={800} sx={{ color: '#9f1239' }}>
                  {pct}%
                </Typography>
              </Stack>
              <Box sx={{ height: 7, borderRadius: 99, bgcolor: 'rgba(15,39,68,0.06)' }}>
                <Box
                  sx={{
                    width: `${pct}%`,
                    height: '100%',
                    borderRadius: 99,
                    background: 'linear-gradient(90deg, #fb7185, #9f1239)',
                  }}
                />
              </Box>
            </Box>
          );
        })}
      </Stack>
    </Box>
  );
}

function TrendLines({ title, trend, onSelect, scopeNote }) {
  if (!trend?.series?.length) return null;
  const years = trend.years || [];
  const w = 280;
  const h = 96;
  const pad = 8;
  const maxShare = Math.max(
    0.05,
    ...trend.series.flatMap((s) => s.points.map((p) => p.share)),
  );
  const colors = ['#0f766e', '#b45309', '#1e3a5f', '#9f1239', '#3f6212'];

  return (
    <Box
      sx={{
        p: 1.5,
        borderRadius: 2,
        bgcolor: 'rgba(255,255,255,0.85)',
        border: '1px solid',
        borderColor: 'rgba(15,39,68,0.08)',
      }}
    >
      <Typography variant="subtitle2" fontWeight={800} sx={{ color: '#0f2744', mb: 0.25 }}>
        {title}
      </Typography>
      {scopeNote && (
        <Typography variant="caption" color="text.secondary" display="block" sx={{ mb: 0.5 }}>
          {scopeNote}
        </Typography>
      )}
      <Box sx={{ overflowX: 'auto' }}>
        <svg width={Math.max(w, years.length * 36)} height={h + 24} role="img">
          {trend.series.map((series, idx) => {
            const color = colors[idx % colors.length];
            const pts = series.points.map((p, i) => {
              const x = pad + (years.length <= 1
                ? (w - pad * 2) / 2
                : (i / (years.length - 1)) * (w - pad * 2));
              const y = pad + (1 - p.share / maxShare) * (h - pad * 2);
              return `${x},${y}`;
            }).join(' ');
            return (
              <polyline
                key={series.id}
                points={pts}
                fill="none"
                stroke={color}
                strokeWidth="2.2"
                strokeLinejoin="round"
                strokeLinecap="round"
              />
            );
          })}
          {years.map((y, i) => {
            const x = pad + (years.length <= 1
              ? (w - pad * 2) / 2
              : (i / (years.length - 1)) * (w - pad * 2));
            return (
              <text
                key={y}
                x={x}
                y={h + 16}
                textAnchor="middle"
                fontSize="9"
                fill="#64748b"
              >
                {String(y).slice(2)}
              </text>
            );
          })}
        </svg>
      </Box>
      <Stack direction="row" spacing={0.75} flexWrap="wrap" useFlexGap sx={{ mt: 0.75 }}>
        {trend.series.map((s, idx) => (
          <Chip
            key={s.id}
            size="small"
            clickable
            onClick={() => onSelect?.({
              dimension: s.dimension,
              id: s.id,
              label: s.label,
            })}
            label={`${s.label}${s.slope > 0.02 ? ' ↑' : s.slope < -0.02 ? ' ↓' : ''}`}
            sx={{
              fontWeight: 600,
              bgcolor: `${colors[idx % colors.length]}18`,
              border: '1px solid',
              borderColor: `${colors[idx % colors.length]}55`,
            }}
          />
        ))}
      </Stack>
    </Box>
  );
}

function TopicLists({ trends, onSelect }) {
  const emerging = [
    ...(trends?.responseProtocol?.emerging || []),
    ...(trends?.perception?.emerging || []),
    ...(trends?.methods?.emerging || []),
  ].slice(0, 6);
  const established = [
    ...(trends?.responseProtocol?.established || []),
    ...(trends?.perception?.established || []),
    ...(trends?.methods?.established || []),
  ].slice(0, 6);

  return (
    <Box
      sx={{
        display: 'grid',
        gridTemplateColumns: { xs: '1fr', md: '1fr 1fr' },
        gap: 1.25,
      }}
    >
      <Box
        sx={{
          p: 1.5,
          borderRadius: 2,
          bgcolor: 'rgba(255,255,255,0.85)',
          border: '1px solid',
          borderColor: 'rgba(15,39,68,0.08)',
        }}
      >
        <Typography variant="subtitle2" fontWeight={800} sx={{ mb: 1, color: '#0f2744' }}>
          Emerging (rising share)
        </Typography>
        <Stack spacing={0.75}>
          {emerging.length ? emerging.map((t) => (
            <Chip
              key={`e-${t.dimension}-${t.id}`}
              clickable
              onClick={() => onSelect?.({ dimension: t.dimension, id: t.id, label: t.label })}
              label={`${t.label} · +${(t.slope * 100).toFixed(0)}pp`}
              sx={{ justifyContent: 'flex-start', fontWeight: 600, bgcolor: '#ecfccb' }}
            />
          )) : (
            <Typography variant="caption" color="text.secondary">No strong risers in window.</Typography>
          )}
        </Stack>
      </Box>
      <Box
        sx={{
          p: 1.5,
          borderRadius: 2,
          bgcolor: 'rgba(255,255,255,0.85)',
          border: '1px solid',
          borderColor: 'rgba(15,39,68,0.08)',
        }}
      >
        <Typography variant="subtitle2" fontWeight={800} sx={{ mb: 1, color: '#0f2744' }}>
          Established (high recent volume)
        </Typography>
        <Stack spacing={0.75}>
          {established.length ? established.map((t) => (
            <Chip
              key={`a-${t.dimension}-${t.id}`}
              clickable
              onClick={() => onSelect?.({ dimension: t.dimension, id: t.id, label: t.label })}
              label={`${t.label} · ${t.recentCount}`}
              sx={{ justifyContent: 'flex-start', fontWeight: 600, bgcolor: '#e2e8f0' }}
            />
          )) : (
            <Typography variant="caption" color="text.secondary">No topics yet.</Typography>
          )}
        </Stack>
      </Box>
    </Box>
  );
}

/**
 * Library analytics V4 — layered taxonomy, human-evaluation cohort, share-based bars.
 */
const PaperLibraryAnalytics = memo(function PaperLibraryAnalytics({
  papers,
  subsetPapers,
  filters = [],
  onToggleFilter,
  onSetFilters,
  onClearFilters,
}) {
  const [tab, setTab] = useState(0);
  const [collapsed, setCollapsed] = useState(false);
  const [trendScope, setTrendScope] = useState('focused');

  const dashboard = useMemo(
    () => buildLibraryDashboard(papers, subsetPapers ?? papers),
    [papers, subsetPapers],
  );

  const activeByDim = useMemo(() => {
    const map = {};
    for (const f of filters) {
      const dim = canonicalFilterDimension(f.dimension);
      map[dim] = f.id;
    }
    return map;
  }, [filters]);

  if (!dashboard.libraryTotal) return null;

  const { baseline, focused, isSubset, spotlights } = dashboard;
  const showCountries = baseline.coverage.country / baseline.total >= LOCATION_CHART_MIN_COVERAGE;
  const showRegions = baseline.coverage.region / baseline.total >= LOCATION_CHART_MIN_COVERAGE;
  const activeTrends = trendScope === 'baseline'
    ? dashboard.trends.baseline
    : dashboard.trends.focused;

  const handleSelect = (row) => {
    if (!onToggleFilter || !row?.dimension || !row?.id) return;
    onToggleFilter({
      dimension: canonicalFilterDimension(row.dimension),
      id: row.id,
      label: row.label,
    });
  };

  const handleFilterObj = (f) => {
    if (!onToggleFilter || !f) return;
    onToggleFilter({
      ...f,
      dimension: canonicalFilterDimension(f.dimension),
    });
  };

  const handleHeatCell = (cell) => {
    if (!cell?.rowDimension || !cell?.colDimension || !cell.count) return;
    const nextPair = [
      { dimension: canonicalFilterDimension(cell.rowDimension), id: cell.rowId, label: cell.rowLabel },
      { dimension: canonicalFilterDimension(cell.colDimension), id: cell.colId, label: cell.colLabel },
    ];
    // Merge: replace same fields, keep unrelated filters (year/location/etc.)
    const kept = (filters || []).filter((f) => {
      const dim = canonicalFilterDimension(f.dimension);
      return !nextPair.some((n) => n.dimension === dim);
    });
    const next = [...kept, ...nextPair];
    if (onSetFilters) {
      onSetFilters(next);
      return;
    }
    next.forEach((f) => onToggleFilter?.(f));
  };

  const shareCaption = (tagged, total) => (
    isSubset
      ? 'Subset vs library baseline · bars = share of papers'
      : `Tagged ${tagged}/${total} · % of papers (multi-label may exceed 100%)`
  );

  return (
    <Box
      sx={{
        mb: 2.5,
        p: { xs: 1.25, md: 1.75 },
        borderRadius: 3,
        background:
          'radial-gradient(1000px 360px at 8% -10%, rgba(20,184,166,0.14), transparent 55%),'
          + 'radial-gradient(800px 320px at 92% 0%, rgba(245,158,11,0.10), transparent 50%),'
          + 'linear-gradient(180deg, #f8fafc 0%, #eef2f6 100%)',
        border: '1px solid',
        borderColor: 'rgba(15,39,68,0.08)',
      }}
    >
      <Stack
        direction="row"
        spacing={1}
        alignItems="center"
        justifyContent="space-between"
        flexWrap="wrap"
        useFlexGap
        sx={{ mb: collapsed ? 0 : 1.25 }}
      >
        <Box>
          <Typography
            variant="overline"
            sx={{ letterSpacing: '0.12em', color: '#0f766e', fontWeight: 800 }}
          >
            Library profile · taxonomy v4
          </Typography>
          <Typography variant="h6" sx={{ fontWeight: 800, color: '#0f2744', lineHeight: 1.2 }}>
            How this corpus is tagged
          </Typography>
        </Box>
        <Stack direction="row" spacing={1} alignItems="center" flexWrap="wrap" useFlexGap>
          <Chip
            size="small"
            label={`${baseline.total.toLocaleString()} papers`}
            sx={{ fontWeight: 800, bgcolor: '#0f2744', color: '#fff' }}
          />
          <Chip
            size="small"
            color="success"
            variant="outlined"
            label={`Human eval ${dashboard.humanLibraryTotal}`}
            sx={{ fontWeight: 700 }}
          />
          {baseline.yearMin && baseline.yearMax && (
            <Chip
              size="small"
              variant="outlined"
              label={`${baseline.yearMin}–${baseline.yearMax}`}
              sx={{ fontWeight: 700, borderColor: '#0f274455' }}
            />
          )}
          <Button
            size="small"
            onClick={() => setCollapsed((v) => !v)}
            endIcon={collapsed ? <ExpandMore /> : <ExpandLess />}
            sx={{ fontWeight: 700 }}
          >
            {collapsed ? 'Expand' : 'Collapse'}
          </Button>
        </Stack>
      </Stack>

      <Collapse in={!collapsed}>
        <Typography variant="body2" color="text.secondary" sx={{ mb: 1.25, maxWidth: 760 }}>
          Rule-extracted from titles, abstracts, and keywords. Method charts emphasize the
          human-evaluation cohort. Solid bars = current subset share; pale track = library baseline share.
        </Typography>

        {(filters.length > 0 || isSubset) && (
          <Stack direction="row" spacing={1} alignItems="center" flexWrap="wrap" useFlexGap sx={{ mb: 1.25 }}>
            <Chip
              size="small"
              color="primary"
              label={`Subset ${dashboard.subsetTotal} / ${dashboard.libraryTotal}`}
              sx={{ fontWeight: 700 }}
            />
            <Chip
              size="small"
              variant="outlined"
              label={`Human eval in subset ${dashboard.humanFocusedTotal}`}
              sx={{ fontWeight: 700 }}
            />
            {filters.map((f) => (
              <Chip
                key={`${f.dimension}:${f.id}`}
                size="small"
                label={filterLabel(f)}
                onDelete={() => onToggleFilter?.(f)}
                sx={{
                  fontWeight: 700,
                  bgcolor: toneOf(canonicalFilterDimension(f.dimension)).soft,
                  color: toneOf(canonicalFilterDimension(f.dimension)).ink,
                }}
              />
            ))}
            <Button size="small" startIcon={<Clear />} onClick={onClearFilters} sx={{ fontWeight: 700 }}>
              Clear filters
            </Button>
          </Stack>
        )}

        <Tabs
          value={tab}
          onChange={(_, v) => setTab(v)}
          variant="scrollable"
          allowScrollButtonsMobile
          sx={{
            minHeight: 36,
            mb: 1.5,
            '& .MuiTab-root': { minHeight: 36, textTransform: 'none', fontWeight: 700 },
          }}
        >
          <Tab label="Overview" />
          <Tab label="Annotation methods" />
          <Tab label="Trends" />
        </Tabs>

        {tab === 0 && (
          <Box>
            {spotlights.length > 0 && (
              <Box
                sx={{
                  display: 'grid',
                  gridTemplateColumns: { xs: '1fr', sm: '1fr 1fr', lg: 'repeat(4, 1fr)' },
                  gap: 1,
                  mb: 1.25,
                }}
              >
                {spotlights.map((spot) => (
                  <SpotlightCard key={spot.id} spot={spot} onSelect={handleFilterObj} />
                ))}
              </Box>
            )}

            <Stack direction="row" spacing={0.75} flexWrap="wrap" useFlexGap sx={{ mb: 1.25 }}>
              <CoverageRing
                label="All papers"
                tagged={focused.total}
                total={focused.total}
                tone="ink"
                hint="Current focused set size"
              />
              <CoverageRing
                label="Human evaluation"
                tagged={focused.coverage.human_evaluation}
                total={focused.total}
                tone="moss"
                hint="Papers with clear human assessment evidence"
              />
              <CoverageRing label="Perception" tagged={focused.coverage.perception} total={focused.total} tone="teal" />
              <CoverageRing label="Visual source" tagged={focused.coverage.visual_source} total={focused.total} tone="amber" />
              <CoverageRing label="Scale" tagged={focused.coverage.scale} total={focused.total} tone="slate" />
              <CoverageRing label="Response protocol" tagged={focused.coverage.response_protocol} total={focused.total} tone="moss" />
              <CoverageRing label="Sample size" tagged={focused.coverage.sample_size} total={focused.total} tone="coral" />
            </Stack>

            <Box sx={{ mb: 1.25 }}>
              <YearRibbon
                rows={focused.byYear}
                activeId={activeByDim.year}
                onSelect={handleSelect}
              />
            </Box>

            <Box
              sx={{
                display: 'grid',
                gridTemplateColumns: { xs: '1fr', md: '1fr 1fr' },
                gap: 1.25,
              }}
            >
              <ComparedBars
                title="Perception constructs"
                caption={shareCaption(focused.coverage.perception, focused.total)}
                rows={dashboard.compared.perception}
                activeId={activeByDim.perception}
                onSelect={handleSelect}
                tone="teal"
                showBaseline={isSubset}
              />
              <ComparedBars
                title="Visual data sources"
                caption={shareCaption(focused.coverage.visual_source, focused.total)}
                rows={dashboard.compared.visualSource}
                activeId={activeByDim.visualSource}
                onSelect={handleSelect}
                tone="amber"
                showBaseline={isSubset}
              />
              <ComparedBars
                title="Spatial scales"
                caption={shareCaption(focused.coverage.scale, focused.total)}
                rows={dashboard.compared.scale}
                activeId={activeByDim.scale}
                onSelect={handleSelect}
                tone="slate"
                showBaseline={isSubset}
              />
              <ComparedBars
                title="Presentation modes"
                caption={shareCaption(focused.coverage.presentation || 0, focused.total)}
                rows={dashboard.compared.presentation}
                activeId={activeByDim.presentation}
                onSelect={handleSelect}
                tone="amber"
                showBaseline={isSubset}
              />
            </Box>
          </Box>
        )}

        {tab === 1 && (
          <Box
            sx={{
              display: 'grid',
              gridTemplateColumns: { xs: '1fr', lg: '1.4fr 0.9fr' },
              gap: 1.25,
            }}
          >
            <Stack spacing={1.25}>
              <Heatmap
                title="Perception × response protocol"
                caption="Human-evaluation cohort only · cell = co-mention count · zero cells disabled"
                matrix={dashboard.matrices.perceptionByProtocol}
                activeRowId={activeByDim.perception}
                activeColId={activeByDim.responseProtocol}
                onSelectCell={handleHeatCell}
              />
              <Heatmap
                title="Visual source × spatial scale"
                caption="All papers in focused subset · street view no longer implies street scale"
                matrix={dashboard.matrices.sourceByScale}
                activeRowId={activeByDim.visualSource}
                activeColId={activeByDim.scale}
                onSelectCell={handleHeatCell}
              />
            </Stack>
            <Stack spacing={1.25}>
              <ComparedBars
                title="Response protocols"
                caption={shareCaption(focused.coverage.response_protocol, focused.total)}
                rows={dashboard.compared.responseProtocol}
                activeId={activeByDim.responseProtocol}
                onSelect={handleSelect}
                tone="moss"
                showBaseline={isSubset}
              />
              <ComparedBars
                title="Measurement channels"
                caption={shareCaption(focused.coverage.measurement_channel, focused.total)}
                rows={dashboard.compared.measurementChannel}
                activeId={activeByDim.measurementChannel}
                onSelect={handleSelect}
                tone="moss"
                showBaseline={isSubset}
              />
              <ComparedBars
                title="Recruitment modes"
                caption={shareCaption(focused.coverage.recruitment, focused.total)}
                rows={dashboard.compared.recruitment}
                activeId={activeByDim.recruitment}
                onSelect={handleSelect}
                tone="slate"
                showBaseline={isSubset}
              />
              <ReportingPanel reporting={dashboard.reporting} />
              {showCountries && (
                <ComparedBars
                  title="Study countries"
                  caption={shareCaption(focused.coverage.country, focused.total)}
                  rows={dashboard.compared.countries}
                  activeId={activeByDim.countries}
                  onSelect={handleSelect}
                  tone="amber"
                  showBaseline={isSubset}
                  maxItems={8}
                />
              )}
              {showRegions && (
                <ComparedBars
                  title="Study regions"
                  caption="Derived from countries + explicit region phrases · separate axis"
                  rows={dashboard.compared.regions}
                  activeId={activeByDim.regions}
                  onSelect={handleSelect}
                  tone="amber"
                  showBaseline={isSubset}
                  maxItems={6}
                />
              )}
            </Stack>
          </Box>
        )}

        {tab === 2 && (
          <Stack spacing={1.25}>
            <Stack direction="row" spacing={1} alignItems="center">
              <Typography variant="caption" fontWeight={700} color="text.secondary">
                Trend scope
              </Typography>
              <Chip
                size="small"
                clickable
                color={trendScope === 'focused' ? 'primary' : 'default'}
                label="Focused subset"
                onClick={() => setTrendScope('focused')}
                sx={{ fontWeight: 700 }}
              />
              <Chip
                size="small"
                clickable
                color={trendScope === 'baseline' ? 'primary' : 'default'}
                label="Library baseline"
                onClick={() => setTrendScope('baseline')}
                sx={{ fontWeight: 700 }}
              />
            </Stack>
            <Box
              sx={{
                display: 'grid',
                gridTemplateColumns: { xs: '1fr', md: '1fr 1fr' },
                gap: 1.25,
              }}
            >
              <TrendLines
                title="Response protocol share by year"
                trend={activeTrends.responseProtocol}
                onSelect={handleFilterObj}
                scopeNote={trendScope === 'focused' ? 'Focused metadata subset' : 'Full library baseline'}
              />
              <TrendLines
                title="Perception construct share by year"
                trend={activeTrends.perception}
                onSelect={handleFilterObj}
                scopeNote={trendScope === 'focused' ? 'Focused metadata subset' : 'Full library baseline'}
              />
            </Box>
            <TopicLists trends={activeTrends} onSelect={handleFilterObj} />
            <ComparedBars
              title="Analysis methods"
              caption={shareCaption(focused.coverage.methods, focused.total)}
              rows={dashboard.compared.researchMethods}
              activeId={activeByDim.researchMethods}
              onSelect={handleSelect}
              tone="coral"
              showBaseline={isSubset}
              maxItems={6}
            />
          </Stack>
        )}
      </Collapse>
    </Box>
  );
});

export default PaperLibraryAnalytics;
