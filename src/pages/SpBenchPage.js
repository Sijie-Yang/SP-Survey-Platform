import React, { useEffect, useMemo, useState } from 'react';
import {
  Box, Container, Typography, Paper, Table, TableBody, TableCell,
  TableHead, TableRow, Chip, CircularProgress, Alert, Tabs, Tab, Stack,
} from '@mui/material';
import PublicHeader, { PublicFooter } from '../components/layout/PublicHeader';
import { getBenchPublic } from '../lib/spBenchApi';
import { useRegion } from '../contexts/RegionContext';

function fmt(v) {
  if (v == null || Number.isNaN(Number(v))) return '—';
  return Number(v).toFixed(3);
}

function LeaderboardTable({ rows, groupKey }) {
  const sorted = useMemo(() => {
    const list = [...(rows || [])];
    if (groupKey) {
      list.sort((a, b) => {
        const av = a.group_scores?.[groupKey] ?? -Infinity;
        const bv = b.group_scores?.[groupKey] ?? -Infinity;
        return bv - av;
      });
    } else {
      list.sort((a, b) => (b.overall_score ?? -Infinity) - (a.overall_score ?? -Infinity));
    }
    return list;
  }, [rows, groupKey]);

  return (
    <Table size="small">
      <TableHead>
        <TableRow>
          <TableCell>#</TableCell>
          <TableCell>Model</TableCell>
          <TableCell>Provider</TableCell>
          <TableCell align="right">{groupKey ? `${groupKey}` : 'Overall'}</TableCell>
          <TableCell align="right">Latency</TableCell>
          <TableCell align="right">Cost (USD)</TableCell>
          <TableCell>Versions</TableCell>
        </TableRow>
      </TableHead>
      <TableBody>
        {sorted.map((row, idx) => (
          <TableRow key={row.run_id}>
            <TableCell>{idx + 1}</TableCell>
            <TableCell>
              <Typography fontWeight={600}>{row.model_name}</Typography>
              <Typography variant="caption" color="text.secondary">{row.model_id}</Typography>
            </TableCell>
            <TableCell>{row.provider_name}</TableCell>
            <TableCell align="right">
              {fmt(groupKey ? row.group_scores?.[groupKey] : row.overall_score)}
            </TableCell>
            <TableCell align="right">
              {row.latency_ms_avg != null ? `${Math.round(row.latency_ms_avg)} ms` : '—'}
            </TableCell>
            <TableCell align="right">
              {row.cost_usd != null ? Number(row.cost_usd).toFixed(4) : '—'}
            </TableCell>
            <TableCell>
              <Chip size="small" label={`data ${row.dataset_version}`} sx={{ mr: 0.5 }} />
              <Chip size="small" label={`method ${row.method_version}`} />
            </TableCell>
          </TableRow>
        ))}
        {!sorted.length && (
          <TableRow>
            <TableCell colSpan={7}>
              <Typography color="text.secondary">No published results yet.</Typography>
            </TableCell>
          </TableRow>
        )}
      </TableBody>
    </Table>
  );
}

export default function SpBenchPage() {
  const { t, language } = useRegion();
  const [loading, setLoading] = useState(true);
  const [data, setData] = useState(null);
  const [error, setError] = useState('');
  const [tab, setTab] = useState(0);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      setLoading(true);
      try {
        const res = await getBenchPublic();
        if (!cancelled) setData(res);
      } catch (e) {
        if (!cancelled) setError(e.message || String(e));
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => { cancelled = true; };
  }, []);

  const groupKey = tab === 1 ? 'objective' : tab === 2 ? 'subjective' : tab === 3 ? 'cognition' : null;

  return (
    <Box sx={{ minHeight: '100vh', bgcolor: 'background.default', display: 'flex', flexDirection: 'column' }}>
      <PublicHeader />
      <Container maxWidth="lg" sx={{ py: 4, flex: 1 }}>
        {loading && (
          <Box sx={{ display: 'flex', justifyContent: 'center', py: 8 }}>
            <CircularProgress />
          </Box>
        )}
        {error && <Alert severity="error">{error}</Alert>}
        {!loading && data && !data.enabled && (
          <Paper sx={{ p: 4, textAlign: 'center' }}>
            <Typography variant="h5" fontWeight={700} sx={{ mb: 1 }}>
              {t.benchNotOpenTitle || 'SP-Bench'}
            </Typography>
            <Typography color="text.secondary">
              {t.benchNotOpenBody || 'This benchmark is not open to the public yet.'}
            </Typography>
          </Paper>
        )}
        {!loading && data?.enabled && (
          <>
            <Typography variant="h4" fontWeight={800} sx={{ mb: 1 }}>
              {data.settings?.title || 'SP-Bench'}
            </Typography>
            <Typography variant="body1" color="text.secondary" sx={{ mb: 2, maxWidth: 900 }}>
              {data.settings?.subtitle}
            </Typography>
            {data.settings?.landing_blurb && (
              <Typography variant="body2" sx={{ mb: 3 }}>{data.settings.landing_blurb}</Typography>
            )}
            <Stack direction="row" spacing={1} sx={{ mb: 3 }} flexWrap="wrap" useFlexGap>
              <Chip label={`${t.benchMethod || 'Method'} ${data.method?.version || data.settings?.method_version || '—'}`} />
              <Chip label={`${t.benchDataset || 'Dataset'} ${data.dataset?.version || '—'} (${data.dataset?.item_count ?? '—'} ${t.benchSamples || 'samples'})`} />
              <Chip label={`${data.leaderboard?.length || 0} ${t.benchModels || 'models'}`} />
            </Stack>

            <Tabs value={tab} onChange={(_, v) => setTab(v)} sx={{ mb: 2 }}>
              <Tab label={t.benchOverall || 'Overall'} />
              <Tab label={t.benchObjective || 'Objective'} />
              <Tab label={t.benchSubjective || 'Subjective'} />
              <Tab label={t.benchCognition || 'Cognition'} />
              <Tab label={t.benchMethodTab || 'Methodology'} />
            </Tabs>

            {tab < 4 && (
              <Paper sx={{ overflow: 'auto' }}>
                <LeaderboardTable rows={data.leaderboard} groupKey={groupKey} />
              </Paper>
            )}

            {tab === 4 && (
              <Paper sx={{ p: 3 }}>
                <Typography variant="h6" fontWeight={700} sx={{ mb: 1 }}>
                  {language === 'zh' ? '评测方法' : 'Evaluation methodology'}
                </Typography>
                <Typography variant="body2" paragraph>
                  SP-Bench evaluates multimodal models on structured urban streetscape perception
                  and cognition tasks using a frozen method version (dimensions, prompts, metrics,
                  weights) and a dedicated labeled dataset. Scores are deterministic
                  (Macro-F1 / Balanced Accuracy for categories; MAE/RMSE/Spearman/Pearson for
                  continuous; pairwise accuracy for preferences) — no LLM-as-judge.
                </Typography>
                <Typography variant="subtitle2" sx={{ mt: 2 }}>Active method</Typography>
                <Typography component="pre" sx={{ fontSize: 12, whiteSpace: 'pre-wrap' }}>
                  {JSON.stringify({
                    version: data.method?.version,
                    title: data.method?.title,
                    frozen_at: data.method?.frozen_at,
                    dimension_count: Array.isArray(data.method?.dimensions) ? data.method.dimensions.length : undefined,
                    notes: data.method?.notes,
                  }, null, 2)}
                </Typography>
                <Typography variant="subtitle2" sx={{ mt: 2 }}>Active dataset</Typography>
                <Typography component="pre" sx={{ fontSize: 12, whiteSpace: 'pre-wrap' }}>
                  {JSON.stringify({
                    version: data.dataset?.version,
                    title: data.dataset?.title,
                    item_count: data.dataset?.item_count,
                    frozen_at: data.dataset?.frozen_at,
                  }, null, 2)}
                </Typography>
                <Alert severity="info" sx={{ mt: 2 }}>
                  Raw labels and model predictions are not exposed on this page.
                </Alert>
              </Paper>
            )}
          </>
        )}
      </Container>
      <PublicFooter />
    </Box>
  );
}
