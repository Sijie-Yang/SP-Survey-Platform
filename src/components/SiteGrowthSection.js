import React, { useEffect, useState } from 'react';
import { Alert, Box, Card, CardContent, CircularProgress, Typography } from '@mui/material';
import { useTheme } from '@mui/material/styles';
import { useRegion } from '../contexts/RegionContext';
import { tf } from '../contexts/adminI18n';
import { intlLocale } from '../lib/uiLanguages';
import { cumulativeSeries, getSiteGrowthStats } from '../lib/siteGrowth';

const W = 240;
const H = 56;
const PAD = 3;

function Sparkline({ series, color, formatValue, label }) {
  const [hover, setHover] = useState(null);
  if (!series.length) return null;
  const max = Math.max(1, ...series.map((p) => p.value));
  const step = series.length > 1 ? (W - PAD * 2) / (series.length - 1) : 0;
  const x = (i) => PAD + i * step;
  const y = (v) => H - PAD - (v / max) * (H - PAD * 2);
  const line = series.map((p, i) => `${i ? 'L' : 'M'}${x(i).toFixed(1)},${y(p.value).toFixed(1)}`).join(' ');
  const area = `${line} L${x(series.length - 1).toFixed(1)},${H - PAD} L${x(0).toFixed(1)},${H - PAD} Z`;
  const active = hover == null ? null : series[hover];
  return (
    <Box sx={{ mt: 1.5 }}>
      <Box
        component="svg"
        viewBox={`0 0 ${W} ${H}`}
        preserveAspectRatio="none"
        role="img"
        aria-label={label}
        sx={{ width: '100%', height: H, display: 'block', overflow: 'visible' }}
        onMouseLeave={() => setHover(null)}
      >
        <path d={area} fill={color} opacity={0.12} />
        <path d={line} fill="none" stroke={color} strokeWidth={2} vectorEffect="non-scaling-stroke" strokeLinejoin="round" />
        {active && (
          <>
            <line x1={x(hover)} x2={x(hover)} y1={PAD} y2={H - PAD} stroke={color} strokeOpacity={0.35} vectorEffect="non-scaling-stroke" />
            <circle cx={x(hover)} cy={y(active.value)} r={3.5} fill={color} vectorEffect="non-scaling-stroke" />
          </>
        )}
        {series.map((p, i) => (
          <rect
            key={p.month || i}
            x={x(i) - step / 2}
            y={0}
            width={Math.max(step, 8)}
            height={H}
            fill="transparent"
            onMouseEnter={() => setHover(i)}
            onTouchStart={() => setHover(i)}
          />
        ))}
      </Box>
      <Typography variant="caption" color="text.secondary" sx={{ display: 'block', mt: 0.5, minHeight: 18 }}>
        {active ? `${active.month} · ${formatValue(active.value)}` : `${series[0].month} – ${series[series.length - 1].month}`}
      </Typography>
    </Box>
  );
}

// Admin-only: get_site_growth_stats() refuses anyone who isn't a platform admin.
export default function SiteGrowthSection() {
  const { t, language } = useRegion();
  const theme = useTheme();
  const [stats, setStats] = useState(undefined);

  useEffect(() => {
    let cancelled = false;
    getSiteGrowthStats()
      .then((data) => { if (!cancelled) setStats(data); })
      .catch(() => { if (!cancelled) setStats(null); });
    return () => { cancelled = true; };
  }, []);

  if (stats === undefined) {
    return <Box sx={{ textAlign: 'center', py: 6 }}><CircularProgress /></Box>;
  }
  if (!stats || !Array.isArray(stats.months)) {
    return <Alert severity="warning">{t.landGrowthUnavailable}</Alert>;
  }

  const fmt = new Intl.NumberFormat(intlLocale(language));
  const formatValue = (n) => fmt.format(Number(n) || 0);
  const color = theme.palette.primary.main;
  const visits30 = Number(stats.visits_30d) || 0;

  const tiles = [
    {
      key: 'users',
      title: t.landGrowthUsers,
      value: stats.users,
      series: cumulativeSeries(stats.months, 'users', stats.users_before),
    },
    {
      key: 'projects',
      title: t.landGrowthProjects,
      value: stats.projects,
      series: cumulativeSeries(stats.months, 'projects', stats.projects_before),
    },
    {
      key: 'responses',
      title: t.landGrowthResponses,
      value: stats.responses,
      series: cumulativeSeries(stats.months, 'responses', stats.responses_before),
    },
  ];
  if (visits30 > 0) {
    // Monthly visits, starting from the first month the counter ran.
    const months = stats.months.filter((m) => !stats.visits_since || m.month >= String(stats.visits_since).slice(0, 7));
    tiles.push({
      key: 'visits',
      title: t.landGrowthVisits,
      value: visits30,
      hint: tf(t.landGrowthVisitorsHint, { n: formatValue(stats.visitors_30d) }),
      series: months.map((m) => ({ month: m.month, value: Number(m.visits) || 0 })),
    });
  }

  return (
    <Box>
      <Box sx={{ mb: 3 }}>
        <Typography variant="h6" fontWeight={700}>
          {t.landGrowthTitle}
        </Typography>
        <Typography variant="body2" color="text.secondary">
          {t.landGrowthSubtitle}
        </Typography>
      </Box>
      <Box
        sx={{
          display: 'grid',
          gridTemplateColumns: { xs: '1fr', sm: '1fr 1fr', md: `repeat(${tiles.length}, 1fr)` },
          gap: 3,
        }}
      >
        {tiles.map((tile) => (
          <Card key={tile.key} sx={{ borderRadius: 2, boxShadow: '0 2px 12px rgba(0,0,0,0.06)' }}>
            <CardContent sx={{ p: 3 }}>
              <Typography variant="body2" color="text.secondary" fontWeight={600}>
                {tile.title}
              </Typography>
              <Typography sx={{ fontSize: '2rem', fontWeight: 800, lineHeight: 1.2, mt: 0.5 }}>
                {formatValue(tile.value)}
              </Typography>
              <Typography variant="caption" color="text.secondary" sx={{ display: 'block', minHeight: 18 }}>
                {tile.hint || t.landGrowthTotalHint}
              </Typography>
              <Sparkline series={tile.series} color={color} formatValue={formatValue} label={tile.title} />
            </CardContent>
          </Card>
        ))}
      </Box>
    </Box>
  );
}
