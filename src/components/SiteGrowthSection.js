import React, { useCallback, useEffect, useState } from 'react';
import {
  Alert,
  Box,
  Button,
  Card,
  CardContent,
  Chip,
  CircularProgress,
  IconButton,
  Link,
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableRow,
  ToggleButton,
  ToggleButtonGroup,
  Tooltip,
  Typography,
} from '@mui/material';
import RefreshIcon from '@mui/icons-material/Refresh';
import { useTheme } from '@mui/material/styles';
import SiteGrowthLegacy from './SiteGrowthLegacy';
import {
  FEATURE_LABELS,
  USD_TO_CNY,
  cacheHitShare,
  formatCny,
  formatTokens,
  formatUsd,
  funnelSteps,
  getPlatformDashboard,
  percentChange,
  runningTotal,
} from '../lib/platformDashboard';

// Admin-only platform dashboard (平台管理 → 平台增长). Data: get_platform_dashboard()
// in supabase/platform_dashboard.sql. Chinese only, like the rest of 平台管理.

const fmt = new Intl.NumberFormat('zh-CN');
const n = (v) => fmt.format(Number(v) || 0);
const pct = (v) => `${Math.round((Number(v) || 0) * 100)}%`;

function seriesColors(theme) {
  const dark = theme.palette.mode === 'dark';
  return { free: dark ? '#338ced' : '#257de0', own: dark ? '#e76624' : '#f47230' };
}

function shortDate(label) {
  // 'YYYY-MM-DD' → 'M/D', 'YYYY-MM' → 'YYYY-MM'
  const m = /^\d{4}-(\d{2})-(\d{2})$/.exec(label || '');
  return m ? `${Number(m[1])}/${Number(m[2])}` : label;
}

/**
 * Small bar or line chart. `points` = [{ label, values: [a, b?] }]; bars stack
 * the values. Hovering a column shows `describe(point)` under the chart.
 */
function MiniChart({ points, kind = 'bar', colors, height = 64, describe, ariaLabel }) {
  const [hover, setHover] = useState(null);
  if (!points?.length) return null;
  const W = 300;
  const H = height;
  const PAD = 2;
  const totals = points.map((p) => p.values.reduce((s, v) => s + (Number(v) || 0), 0));
  const max = Math.max(1e-9, ...totals);
  const slot = (W - PAD * 2) / points.length;
  const y = (v) => H - PAD - (v / max) * (H - PAD * 2);
  const active = hover == null ? null : points[hover];
  let line = '';
  if (kind === 'line') {
    line = points.map((p, i) => `${i ? 'L' : 'M'}${(PAD + slot * (i + 0.5)).toFixed(1)},${y(totals[i]).toFixed(1)}`).join(' ');
  }
  return (
    <Box>
      <Box
        component="svg"
        viewBox={`0 0 ${W} ${H}`}
        preserveAspectRatio="none"
        role="img"
        aria-label={ariaLabel}
        sx={{ width: '100%', height: H, display: 'block', overflow: 'visible' }}
        onMouseLeave={() => setHover(null)}
      >
        <line x1={0} x2={W} y1={H - PAD} y2={H - PAD} stroke="currentColor" strokeOpacity={0.15} vectorEffect="non-scaling-stroke" />
        {kind === 'line' ? (
          <>
            <path d={`${line} L${(PAD + slot * (points.length - 0.5)).toFixed(1)},${H - PAD} L${(PAD + slot * 0.5).toFixed(1)},${H - PAD} Z`} fill={colors[0]} opacity={0.12} />
            <path d={line} fill="none" stroke={colors[0]} strokeWidth={2} vectorEffect="non-scaling-stroke" strokeLinejoin="round" />
            {active && (
              <circle cx={PAD + slot * (hover + 0.5)} cy={y(totals[hover])} r={3.5} fill={colors[0]} vectorEffect="non-scaling-stroke" />
            )}
          </>
        ) : points.map((p, i) => {
          const gap = Math.min(2, slot * 0.25);
          const x = PAD + slot * i + gap / 2;
          const w = Math.max(0.5, slot - gap);
          let base = H - PAD;
          return p.values.map((v, j) => {
            const h = ((Number(v) || 0) / max) * (H - PAD * 2);
            if (h <= 0) return null;
            const top = base - h;
            const rect = (
              <rect
                key={`${p.label}-${j}`}
                x={x}
                y={top}
                width={w}
                height={Math.max(0, h - (j > 0 ? 0.5 : 0))}
                fill={colors[j] || colors[0]}
                opacity={hover == null || hover === i ? 1 : 0.55}
              />
            );
            base = top;
            return rect;
          });
        })}
        {points.map((p, i) => (
          <rect
            key={`hit-${p.label}`}
            x={PAD + slot * i}
            y={0}
            width={slot}
            height={H}
            fill="transparent"
            onMouseEnter={() => setHover(i)}
            onTouchStart={() => setHover(i)}
          />
        ))}
      </Box>
      <Typography variant="caption" color="text.secondary" sx={{ display: 'block', mt: 0.5, minHeight: 18 }}>
        {active
          ? describe(active)
          : `${shortDate(points[0].label)} – ${shortDate(points[points.length - 1].label)}`}
      </Typography>
    </Box>
  );
}

function Section({ title, subtitle, action, children }) {
  return (
    <Box sx={{ mt: 4 }}>
      <Box sx={{ display: 'flex', alignItems: 'flex-end', justifyContent: 'space-between', gap: 2, flexWrap: 'wrap', mb: 1.5 }}>
        <Box>
          <Typography variant="subtitle1" fontWeight={700}>{title}</Typography>
          {subtitle ? <Typography variant="body2" color="text.secondary">{subtitle}</Typography> : null}
        </Box>
        {action}
      </Box>
      {children}
    </Box>
  );
}

const cardSx = { borderRadius: 2, boxShadow: '0 2px 12px rgba(0,0,0,0.06)', height: '100%' };

function Change({ current, previous }) {
  const change = percentChange(current, previous);
  if (change == null) return null;
  const up = change > 0;
  const flat = change === 0;
  return (
    <Typography
      component="span"
      variant="caption"
      sx={{ ml: 1, fontWeight: 700, color: flat ? 'text.secondary' : (up ? 'success.main' : 'error.main') }}
    >
      {flat ? '持平' : `${up ? '↑' : '↓'} ${Math.abs(change)}%`}
    </Typography>
  );
}

function StatCard({ title, value, recent, previous, recentLabel = '近 30 天', points, kind, color, unit = '' }) {
  return (
    <Card sx={cardSx}>
      <CardContent sx={{ p: 2.5 }}>
        <Typography variant="body2" color="text.secondary" fontWeight={600}>{title}</Typography>
        <Typography sx={{ fontSize: '1.9rem', fontWeight: 800, lineHeight: 1.2, mt: 0.5 }}>{n(value)}</Typography>
        <Typography variant="caption" color="text.secondary" sx={{ display: 'block', minHeight: 18 }}>
          {recentLabel} +{n(recent)}{unit}
          <Tooltip title={`前 30 天 +${n(previous)}${unit}`}><span><Change current={recent} previous={previous} /></span></Tooltip>
        </Typography>
        <Box sx={{ mt: 1.5 }}>
          <MiniChart
            points={points}
            kind={kind}
            colors={[color]}
            ariaLabel={title}
            describe={(p) => `${shortDate(p.label)} · ${n(p.values[0])}${unit}`}
          />
        </Box>
      </CardContent>
    </Card>
  );
}

function Kpi({ label, value, hint }) {
  return (
    <Box sx={{ minWidth: 0 }}>
      <Typography variant="caption" color="text.secondary" fontWeight={600} sx={{ display: 'block' }}>{label}</Typography>
      <Typography sx={{ fontSize: '1.5rem', fontWeight: 800, lineHeight: 1.25 }}>{value}</Typography>
      {hint ? <Typography variant="caption" color="text.secondary">{hint}</Typography> : null}
    </Box>
  );
}

function Legend({ items }) {
  return (
    <Box sx={{ display: 'flex', gap: 2, flexWrap: 'wrap' }}>
      {items.map((item) => (
        <Box key={item.label} sx={{ display: 'flex', alignItems: 'center', gap: 0.75 }}>
          <Box sx={{ width: 10, height: 10, borderRadius: '2px', bgcolor: item.color }} />
          <Typography variant="caption" color="text.secondary">{item.label}</Typography>
        </Box>
      ))}
    </Box>
  );
}

function SubsidyStatus({ subsidy, onOpenFreeModel }) {
  const routes = Array.isArray(subsidy?.routes) ? subsidy.routes : [];
  const expired = subsidy?.expires_at && Date.parse(subsidy.expires_at) <= Date.now();
  const on = Boolean(subsidy?.enabled) && routes.length > 0 && !expired;
  return (
    <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, flexWrap: 'wrap' }}>
      <Chip
        size="small"
        color={on ? 'success' : 'default'}
        label={on ? '免费模型开放中' : '免费模型已关闭'}
      />
      {on ? (
        <Typography variant="body2" color="text.secondary">
          {routes.map((r) => r.model).join('、')}
          {subsidy.expires_at ? `，${new Date(subsidy.expires_at).toLocaleString('zh-CN')} 自动关闭` : '，一直开放到手动关闭'}
        </Typography>
      ) : null}
      {onOpenFreeModel ? (
        <Button size="small" onClick={onOpenFreeModel}>设置</Button>
      ) : null}
    </Box>
  );
}

function AiCostSection({ ai = {}, subsidy, range, onOpenFreeModel }) {
  const theme = useTheme();
  const colors = seriesColors(theme);
  const d30 = ai.d30 || {};
  const month = ai.month || {};
  const all = ai.all || {};
  const rows = range === '12m' ? (ai.months || []) : (ai.days || []);
  const points = rows.map((r) => ({ label: r.day || r.month, values: [Number(r.free_usd) || 0, Number(r.own_usd) || 0], calls: r.calls }));
  const freeUsers = ai.free_users || [];
  const features = ai.features || [];
  const models = ai.models || [];
  const ours30 = (Number(d30.free_usd) || 0) + (Number(d30.own_usd) || 0);
  const cacheShare = cacheHitShare(d30.prompt_tokens, d30.cache_read_tokens);
  const since = ai.since ? new Date(ai.since).toLocaleDateString('zh-CN') : null;
  const estimatedSince = ai.estimated_since ? new Date(ai.estimated_since).toLocaleDateString('zh-CN') : null;

  return (
    <Section
      title="免费模型开销"
      subtitle="用你的 API key 开放给大家的模型花了多少钱（按模型公开价估算）"
      action={<SubsidyStatus subsidy={subsidy} onOpenFreeModel={onOpenFreeModel} />}
    >
      <Card sx={cardSx}>
        <CardContent sx={{ p: 2.5 }}>
          <Box sx={{ display: 'grid', gridTemplateColumns: { xs: '1fr 1fr', md: 'repeat(4, 1fr)' }, gap: 2.5 }}>
            <Kpi label="本月 · 免费模型" value={formatUsd(month.free_usd)} hint={`约 ${formatCny(month.free_usd)}`} />
            <Kpi label="近 30 天 · 免费模型" value={formatUsd(d30.free_usd)} hint={`${n(d30.free_calls)} 次调用 · ${n(d30.free_users)} 位用户`} />
            <Kpi label="近 30 天 · 你自己用" value={formatUsd(d30.own_usd)} hint={`合计 ${formatUsd(ours30)}（约 ${formatCny(ours30)}）`} />
            <Kpi label="累计 · 免费模型" value={formatUsd(all.free_usd)} hint={`${n(all.free_users)} 位用户用过`} />
          </Box>
          <Box sx={{ mt: 3, mb: 1, display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 1, flexWrap: 'wrap' }}>
            <Typography variant="body2" fontWeight={600}>{range === '12m' ? '每月开销' : '每天开销'}</Typography>
            <Legend items={[{ label: '免费模型（别人用）', color: colors.free }, { label: '你自己用', color: colors.own }]} />
          </Box>
          <MiniChart
            points={points}
            colors={[colors.free, colors.own]}
            height={110}
            ariaLabel="免费模型开销"
            describe={(p) => `${shortDate(p.label)} · 免费模型 ${formatUsd(p.values[0])} · 你自己用 ${formatUsd(p.values[1])} · 共 ${n(p.calls)} 次调用`}
          />
        </CardContent>
      </Card>

      <Box sx={{ display: 'grid', gridTemplateColumns: { xs: '1fr', md: '3fr 2fr' }, gap: 2, mt: 2 }}>
        <Card sx={cardSx}>
          <CardContent sx={{ p: 2.5 }}>
            <Typography variant="body2" fontWeight={600} sx={{ mb: 1 }}>近 30 天谁在用免费模型</Typography>
            {freeUsers.length ? (
              <Box sx={{ overflowX: 'auto' }}>
                <Table size="small">
                  <TableHead>
                    <TableRow>
                      <TableCell>用户</TableCell>
                      <TableCell align="right">调用</TableCell>
                      <TableCell align="right">项目</TableCell>
                      <TableCell align="right">tokens</TableCell>
                      <TableCell align="right">费用</TableCell>
                      <TableCell align="right">最近</TableCell>
                    </TableRow>
                  </TableHead>
                  <TableBody>
                    {freeUsers.map((u) => (
                      <TableRow key={u.email || 'deleted'}>
                        <TableCell sx={{ maxWidth: 220, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{u.email || '（已删除的用户）'}</TableCell>
                        <TableCell align="right">{n(u.calls)}</TableCell>
                        <TableCell align="right">{n(u.projects)}</TableCell>
                        <TableCell align="right">{formatTokens(u.tokens)}</TableCell>
                        <TableCell align="right">{formatUsd(u.usd)}</TableCell>
                        <TableCell align="right" sx={{ whiteSpace: 'nowrap' }}>{u.last_at ? new Date(u.last_at).toLocaleDateString('zh-CN') : ''}</TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </Box>
            ) : (
              <Typography variant="body2" color="text.secondary">近 30 天没有人用免费模型。</Typography>
            )}
          </CardContent>
        </Card>
        <Card sx={cardSx}>
          <CardContent sx={{ p: 2.5 }}>
            <Typography variant="body2" fontWeight={600} sx={{ mb: 1 }}>花在哪些功能上（近 30 天，你的 key）</Typography>
            {features.length ? (
              <Table size="small">
                <TableBody>
                  {features.map((f) => (
                    <TableRow key={f.feature}>
                      <TableCell>{FEATURE_LABELS[f.feature] || f.feature}</TableCell>
                      <TableCell align="right">{n(f.calls)} 次</TableCell>
                      <TableCell align="right">{formatUsd(f.usd)}</TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            ) : (
              <Typography variant="body2" color="text.secondary">还没有记录。</Typography>
            )}
            {models.length ? (
              <Typography variant="caption" color="text.secondary" sx={{ display: 'block', mt: 1.5 }}>
                模型：{models.map((m) => `${m.model}${m.unpriced ? '（无公开价，未计费）' : ''}`).join('、')}
                {cacheShare != null ? ` · 缓存命中 ${pct(cacheShare)}（命中部分便宜很多）` : ''}
              </Typography>
            ) : null}
            <Typography variant="caption" color="text.secondary" sx={{ display: 'block', mt: 0.5 }}>
              近 30 天共 {n(d30.ai_users)} 位用户用过 AI，其中 {n(d30.byok_users)} 位用自己的 key（不算你的开销）。
            </Typography>
          </CardContent>
        </Card>
      </Box>
      <Typography variant="caption" color="text.secondary" sx={{ display: 'block', mt: 1 }}>
        费用是估算：每次调用的 token × 模型公开价（缓存命中按缓存价），人民币按 1 美元 ≈ {USD_TO_CNY} 元。实际以模型服务商账单为准。
        {since ? ` 逐次记录从 ${since} 开始。` : ' 逐次记录会在新版本上线后开始。'}
        {estimatedSince ? ` 更早的 Assistant 运行（从 ${estimatedSince} 起）来自旧记录，没有缓存信息，按全价估算，可能偏高。` : ''}
      </Typography>
    </Section>
  );
}

function FunnelSection({ funnel, recent, kinds }) {
  const theme = useTheme();
  const steps = funnelSteps(funnel);
  return (
    <Section title="用户转化" subtitle="注册以后，有多少人真正用起来（每个人只算一次）">
      <Box sx={{ display: 'grid', gridTemplateColumns: { xs: '1fr', md: '3fr 2fr' }, gap: 2 }}>
        <Card sx={cardSx}>
          <CardContent sx={{ p: 2.5 }}>
            {steps.map((step) => (
              <Box key={step.key} sx={{ display: 'grid', gridTemplateColumns: '7.5em 1fr 6.5em', alignItems: 'center', gap: 1.5, py: 0.75 }}>
                <Typography variant="body2">{step.label}</Typography>
                <Box sx={{ height: 14, bgcolor: 'action.hover', borderRadius: '4px', overflow: 'hidden' }}>
                  <Box sx={{ width: `${Math.max(step.value ? 1 : 0, step.share * 100)}%`, height: '100%', bgcolor: theme.palette.primary.main, borderRadius: '4px' }} />
                </Box>
                <Typography variant="body2" sx={{ textAlign: 'right', fontVariantNumeric: 'tabular-nums' }}>
                  {n(step.value)} <Typography component="span" variant="caption" color="text.secondary">{pct(step.share)}</Typography>
                </Typography>
              </Box>
            ))}
          </CardContent>
        </Card>
        <Card sx={cardSx}>
          <CardContent sx={{ p: 2.5, display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 2.5 }}>
            <Kpi label="近 30 天活跃用户" value={n(recent.active_users)} hint="改过项目或用过 AI" />
            <Kpi label="近 30 天在收回答的项目" value={n(recent.active_projects)} />
            <Kpi label="SP-Scheme 页面项目" value={n(kinds.sp_scheme)} />
            <Kpi label="经典编辑器项目" value={n(kinds.classic)} />
          </CardContent>
        </Card>
      </Box>
    </Section>
  );
}

function TopProjects({ projects }) {
  return (
    <Section title="近 30 天回答最多的项目" subtitle="不含研究者自己的测试回答">
      <Card sx={cardSx}>
        <CardContent sx={{ p: 2.5 }}>
          {projects.length ? (
            <Box sx={{ overflowX: 'auto' }}>
              <Table size="small">
                <TableHead>
                  <TableRow>
                    <TableCell>项目</TableCell>
                    <TableCell>负责人</TableCell>
                    <TableCell align="right">近 30 天</TableCell>
                    <TableCell align="right">累计</TableCell>
                  </TableRow>
                </TableHead>
                <TableBody>
                  {projects.map((p) => (
                    <TableRow key={p.id}>
                      <TableCell sx={{ maxWidth: 280 }}>
                        {p.name || p.id}
                        {p.sp_scheme ? <Chip size="small" label="SP-Scheme" variant="outlined" sx={{ ml: 1, height: 20 }} /> : null}
                      </TableCell>
                      <TableCell sx={{ maxWidth: 200, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{p.owner_email || ''}</TableCell>
                      <TableCell align="right">{n(p.last30)}</TableCell>
                      <TableCell align="right">{n(p.total)}</TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </Box>
          ) : (
            <Typography variant="body2" color="text.secondary">近 30 天没有项目收到回答。</Typography>
          )}
        </CardContent>
      </Card>
    </Section>
  );
}

function CommunitySection({ totals, recent, onOpenFeedback }) {
  return (
    <Section title="社区">
      <Card sx={cardSx}>
        <CardContent sx={{ p: 2.5, display: 'grid', gridTemplateColumns: { xs: '1fr 1fr', md: 'repeat(4, 1fr)' }, gap: 2.5 }}>
          <Kpi label="论坛主题" value={n(totals.forum_threads)} hint={`近 30 天 +${n(recent.forum_threads)}`} />
          <Kpi label="论坛回复" value={n(totals.forum_posts)} />
          <Kpi label="用户建议" value={n(totals.feedback)} hint={`近 30 天 +${n(recent.feedback)}`} />
          <Kpi
            label="待处理建议"
            value={n(totals.feedback_new)}
            hint={onOpenFeedback && Number(totals.feedback_new) > 0
              ? <Link component="button" variant="caption" onClick={onOpenFeedback}>去处理</Link>
              : null}
          />
        </CardContent>
      </Card>
    </Section>
  );
}

export default function SiteGrowthSection({ onOpenFreeModel, onOpenFeedback }) {
  const theme = useTheme();
  const [state, setState] = useState({ loading: true, data: null, error: null, missing: false });
  const [range, setRange] = useState('30d');

  const load = useCallback(() => {
    let cancelled = false;
    setState((s) => ({ ...s, loading: true }));
    getPlatformDashboard()
      .then((res) => { if (!cancelled) setState({ loading: false, ...res }); })
      .catch((err) => { if (!cancelled) setState({ loading: false, data: null, error: String(err?.message || err), missing: false }); });
    return () => { cancelled = true; };
  }, []);

  useEffect(() => load(), [load]);

  if (state.loading && !state.data) {
    return <Box sx={{ textAlign: 'center', py: 6 }}><CircularProgress /></Box>;
  }
  if (!state.data) {
    return (
      <Box>
        <Alert severity="info" sx={{ mb: 3 }}>
          {state.missing
            ? '完整的增长面板和免费模型开销需要先在 Supabase 运行 supabase/platform_dashboard.sql。下面是旧版面板。'
            : `完整面板加载失败：${state.error || '未知错误'}。下面是旧版面板。`}
        </Alert>
        <SiteGrowthLegacy />
      </Box>
    );
  }

  const d = state.data;
  const totals = d.totals || {};
  const recent = d.recent || {};
  const before = d.before || {};
  const color = theme.palette.primary.main;
  const daily = d.days || [];
  const monthly = d.months || [];
  const pointsFor = (key, cumulative) => {
    if (range === '12m') {
      const values = cumulative ? runningTotal(monthly, key, before[key]) : monthly.map((m) => Number(m[key]) || 0);
      return monthly.map((m, i) => ({ label: m.month, values: [values[i]] }));
    }
    return daily.map((day) => ({ label: day.day, values: [Number(day[key]) || 0] }));
  };
  const kind = (cumulative) => (range === '12m' && cumulative ? 'line' : 'bar');
  const visitsSince = totals.visits_since ? String(totals.visits_since).slice(0, 7) : null;

  const tiles = [
    { key: 'users', title: '注册用户', cumulative: true },
    { key: 'projects', title: '项目', cumulative: true },
    { key: 'responses', title: '有效回答', cumulative: true },
    { key: 'visits', title: '网站访问', cumulative: false },
  ];

  return (
    <Box>
      <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: 2, flexWrap: 'wrap' }}>
        <Box>
          <Typography variant="h6" fontWeight={700}>平台增长</Typography>
          <Typography variant="body2" color="text.secondary">
            只有平台管理员能看到。更新于 {new Date(d.generated_at || Date.now()).toLocaleString('zh-CN')}
          </Typography>
        </Box>
        <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
          <ToggleButtonGroup size="small" exclusive value={range} onChange={(_, v) => v && setRange(v)}>
            <ToggleButton value="30d">近 30 天（按天）</ToggleButton>
            <ToggleButton value="12m">近 12 个月</ToggleButton>
          </ToggleButtonGroup>
          <Tooltip title="刷新">
            <span>
              <IconButton onClick={load} disabled={state.loading} aria-label="刷新">
                {state.loading ? <CircularProgress size={20} /> : <RefreshIcon />}
              </IconButton>
            </span>
          </Tooltip>
        </Box>
      </Box>

      <Section
        title="概览"
        subtitle={range === '12m'
          ? '大数字是累计；曲线是累计增长（访问是每月次数）。小字是近 30 天新增，和前 30 天比。'
          : '大数字是累计；柱子是每天新增。小字是近 30 天新增，和前 30 天比。'}
      >
        <Box sx={{ display: 'grid', gridTemplateColumns: { xs: '1fr', sm: '1fr 1fr', lg: 'repeat(4, 1fr)' }, gap: 2 }}>
          {tiles.map((tile) => (
            <StatCard
              key={tile.key}
              title={tile.title}
              value={totals[tile.key]}
              recent={recent[tile.key]}
              previous={recent[`${tile.key}_prev`]}
              points={pointsFor(tile.key, tile.cumulative).filter((p) => tile.key !== 'visits' || range !== '12m' || !visitsSince || p.label >= visitsSince)}
              kind={kind(tile.cumulative)}
              color={color}
              unit={tile.key === 'visits' ? ' 次' : ''}
            />
          ))}
        </Box>
        <Typography variant="caption" color="text.secondary" sx={{ display: 'block', mt: 1 }}>
          访问按浏览器标签页计次，不记录 IP；近 30 天独立访客 {n(recent.visitors)}（每天每个浏览器算一次）。
        </Typography>
      </Section>

      <AiCostSection ai={d.ai} subsidy={d.subsidy} range={range} onOpenFreeModel={onOpenFreeModel} />
      <FunnelSection funnel={d.funnel || {}} recent={recent} kinds={d.project_kinds || {}} />
      <TopProjects projects={d.top_projects || []} />
      <CommunitySection totals={totals} recent={recent} onOpenFeedback={onOpenFeedback} />
    </Box>
  );
}
