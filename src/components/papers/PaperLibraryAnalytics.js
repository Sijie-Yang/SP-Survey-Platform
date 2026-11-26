import React, { memo, useMemo } from 'react';
import { Box, Stack, Typography } from '@mui/material';
import { buildSimpleLibraryView } from '../../lib/researchPaperAnalytics';
import { barLabel, cardTitle } from './paperLibraryLabels';

/** Same palette as before: one colour family per card. */
const TONES = {
  teal: { solid: '#0f766e', soft: '#ccfbf1', ink: '#134e4a', bar: '#14b8a6' },
  amber: { solid: '#b45309', soft: '#ffedd5', ink: '#7c2d12', bar: '#f59e0b' },
  moss: { solid: '#3f6212', soft: '#ecfccb', ink: '#365314', bar: '#65a30d' },
  ink: { solid: '#1e3a5f', soft: '#e2e8f0', ink: '#0f172a', bar: '#334155' },
  coral: { solid: '#9f1239', soft: '#ffe4e6', ink: '#881337', bar: '#e11d48' },
  slate: { solid: '#475569', soft: '#f1f5f9', ink: '#1e293b', bar: '#64748b' },
};

const CARD_TONE = {
  year: 'ink',
  concept: 'teal',
  task: 'moss',
  modality: 'amber',
  participants: 'slate',
  sample: 'ink',
  country: 'coral',
};

const toneOf = (dimension) => TONES[CARD_TONE[dimension]] || TONES.slate;

const cardSx = {
  p: 1.5,
  height: '100%',
  borderRadius: 2,
  bgcolor: 'rgba(255,255,255,0.85)',
  border: '1px solid',
  borderColor: 'rgba(15,39,68,0.08)',
};

function CardHead({ dimension, sub, zh }) {
  const t = toneOf(dimension);
  return (
    <>
      <Stack direction="row" spacing={1} alignItems="center">
        <Box sx={{ width: 8, height: 8, borderRadius: '50%', bgcolor: t.bar, flexShrink: 0 }} />
        <Typography variant="subtitle2" fontWeight={800} sx={{ color: t.ink }}>
          {cardTitle(zh, dimension)}
        </Typography>
      </Stack>
      <Typography variant="caption" color="text.secondary" display="block" sx={{ mb: 1, pl: 2 }}>
        {sub}
      </Typography>
    </>
  );
}

function clickProps(onClick) {
  if (!onClick) return {};
  return {
    onClick,
    role: 'button',
    tabIndex: 0,
    onKeyDown: (e) => {
      if (e.key === 'Enter' || e.key === ' ') {
        e.preventDefault();
        onClick();
      }
    },
  };
}

function YearCard({ view, activeId, onSelect, zh }) {
  const t = toneOf('year');
  const max = Math.max(...view.years.map((r) => r.count), 1);
  const sub = view.yearMin
    ? (zh
      ? `${view.yearMin}–${view.yearMax} · 近五年占 ${Math.round(view.recentShare * 100)}%`
      : `${view.yearMin}–${view.yearMax} · ${Math.round(view.recentShare * 100)}% in the last 5 years`)
    : '';
  return (
    <Box sx={{ ...cardSx, gridColumn: '1 / -1' }}>
      <CardHead dimension="year" sub={sub} zh={zh} />
      <Box sx={{ display: 'flex', alignItems: 'flex-end', gap: 0.4, height: 112 }}>
        {view.years.map((row) => {
          const selected = row.id && activeId === row.id;
          const h = row.count ? Math.max(4, Math.round((row.count / max) * 96)) : 2;
          const click = row.id && row.count
            ? () => onSelect({ dimension: 'year', id: row.id, label: row.label })
            : null;
          return (
            <Box
              key={row.label}
              {...clickProps(click)}
              title={`${row.label}: ${row.count}`}
              sx={{
                flex: '1 1 0',
                minWidth: 0,
                display: 'flex',
                flexDirection: 'column',
                alignItems: 'center',
                justifyContent: 'flex-end',
                cursor: click ? 'pointer' : 'default',
              }}
            >
              <Typography sx={{ mb: 0.3, fontSize: 9, fontWeight: 700, color: selected ? t.solid : 'text.secondary' }}>
                {row.count || ''}
              </Typography>
              <Box
                sx={{
                  width: '72%',
                  height: h,
                  borderRadius: '5px 5px 2px 2px',
                  background: selected
                    ? `linear-gradient(180deg, ${t.bar}, ${t.solid})`
                    : `linear-gradient(180deg, ${t.bar}bb, ${t.solid}88)`,
                  opacity: row.earlier ? 0.55 : 1,
                }}
              />
              <Typography sx={{ mt: 0.45, fontSize: 9, fontWeight: selected ? 800 : 500, color: t.ink, whiteSpace: 'nowrap' }}>
                {row.earlier ? (zh ? '更早' : 'older') : `'${row.label.slice(2)}`}
              </Typography>
            </Box>
          );
        })}
      </Box>
    </Box>
  );
}

function BarCard({ card, activeId, onSelect, zh }) {
  const t = toneOf(card.dimension);
  const max = Math.max(...card.rows.map((r) => r.count), 1);
  const stated = card.dimension === 'task' || card.dimension === 'participants' || card.dimension === 'sample';
  const sub = stated
    ? (zh ? `${card.tagged} 篇写明了` : `${card.tagged} papers say so`)
    : (zh ? `${card.tagged} 篇能识别出` : `${card.tagged} papers tagged`);
  return (
    <Box sx={cardSx}>
      <CardHead dimension={card.dimension} sub={sub} zh={zh} />
      {!card.rows.length && (
        <Typography variant="caption" color="text.secondary" sx={{ pl: 2 }}>
          {zh ? '没有可识别的论文' : 'Nothing tagged'}
        </Typography>
      )}
      <Stack spacing={0.4}>
        {card.rows.map((row) => {
          const selected = activeId === row.id;
          const label = barLabel(zh, card.dimension, row.id, row.label);
          return (
            <Box
              key={row.id}
              {...clickProps(() => onSelect({ dimension: card.dimension, id: row.id, label }))}
              sx={{
                display: 'grid',
                gridTemplateColumns: '92px 1fr 34px',
                alignItems: 'center',
                gap: 1,
                cursor: 'pointer',
                borderRadius: 1.25,
                px: 0.6,
                py: 0.35,
                bgcolor: selected ? t.soft : 'transparent',
                outline: selected ? `1px solid ${t.bar}55` : '1px solid transparent',
                '&:hover': { bgcolor: t.soft },
              }}
            >
              <Typography variant="caption" noWrap title={label} sx={{ fontWeight: selected ? 800 : 600, color: t.ink }}>
                {label}
                {row.rising && (
                  <Box
                    component="span"
                    title={zh ? '近几年占比在上升' : 'Share rising in recent years'}
                    sx={{ ml: 0.4, color: '#b45309', fontWeight: 800 }}
                  >
                    ↑
                  </Box>
                )}
              </Typography>
              <Box sx={{ height: 8, borderRadius: 99, bgcolor: 'rgba(15,39,68,0.06)', overflow: 'hidden' }}>
                <Box
                  sx={{
                    height: '100%',
                    width: `${(row.count / max) * 100}%`,
                    borderRadius: 99,
                    background: `linear-gradient(90deg, ${t.bar}, ${t.solid})`,
                  }}
                />
              </Box>
              <Typography
                variant="caption"
                sx={{ textAlign: 'right', fontWeight: 700, color: t.solid, fontVariantNumeric: 'tabular-nums' }}
              >
                {row.count}
              </Typography>
            </Box>
          );
        })}
      </Stack>
      {card.lowCoverage && card.tagged > 0 && (
        <Typography
          variant="caption"
          display="block"
          sx={{ mt: 1, px: 1, py: 0.5, borderRadius: 1, bgcolor: '#fffbeb', color: '#92400e' }}
        >
          {zh
            ? `多数摘要没写${cardTitle(true, card.dimension)}，这里只代表写了的 ${card.tagged} 篇。`
            : `Most abstracts do not say this; this covers only ${card.tagged} papers.`}
        </Typography>
      )}
    </Box>
  );
}

/**
 * One panel, six cards, computed on whatever the reader has filtered to.
 * Clicking a bar adds (or removes) that filter; the list below follows.
 */
const PaperLibraryAnalytics = memo(function PaperLibraryAnalytics({
  papers,
  filters = [],
  onToggleFilter,
  zh = false,
}) {
  const view = useMemo(() => buildSimpleLibraryView(papers), [papers]);
  const activeByDim = useMemo(() => {
    const map = {};
    for (const f of filters) map[f.dimension] = f.id;
    return map;
  }, [filters]);

  if (!view.total) return null;
  const select = (f) => onToggleFilter?.(f);

  return (
    <Box
      data-testid="paper-library-analytics"
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
      <Typography variant="caption" color="text.secondary" display="block" sx={{ mb: 1.25 }}>
        {zh
          ? `标签和模板库用同一套分类。${view.reviewed ? `其中 ${view.reviewed} 篇已逐篇读摘要核对，其余` : ''}按标题、摘要和关键词自动识别。点任意一条柱子只看这类论文，再点一次取消。`
          : `Tags use the same categories as the template library. ${view.reviewed ? `${view.reviewed} papers were checked by reading the abstract; the rest are ` : 'They are '}read automatically from titles, abstracts and keywords. Click a bar to show only those papers; click again to undo.`}
      </Typography>
      <Box
        sx={{
          display: 'grid',
          gridTemplateColumns: { xs: '1fr', sm: '1fr 1fr', lg: 'repeat(3, 1fr)' },
          gap: 1.25,
        }}
      >
        <YearCard view={view} activeId={activeByDim.year} onSelect={select} zh={zh} />
        {view.cards.map((card) => (
          <BarCard
            key={card.dimension}
            card={card}
            activeId={activeByDim[card.dimension]}
            onSelect={select}
            zh={zh}
          />
        ))}
      </Box>
    </Box>
  );
});

export default PaperLibraryAnalytics;
