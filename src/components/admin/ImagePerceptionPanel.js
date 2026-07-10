import React, { useEffect, useMemo, useState } from 'react';
import {
  Accordion, AccordionSummary, AccordionDetails, Box, Button, Typography,
  Table, TableBody, TableCell, TableContainer, TableHead, TableRow, Paper,
  Chip, Alert, FormControl, InputLabel, Select, MenuItem, CircularProgress,
} from '@mui/material';
import { ExpandMore, Download } from '@mui/icons-material';
import {
  buildImagePerceptionRows,
  correlateFeaturesWithPerception,
  exportImagePerceptionCsv,
  L0_MODEL,
  SEG_MODEL,
  SAM_PREANNOT_MODEL,
} from '../../lib/imagePerceptionJoin';
import { loadFeaturesMapFromR2, FEATURE_MODELS } from '../../lib/imageFeaturesR2';
import { isR2Configured } from '../../lib/r2';
import { useAuth } from '../../contexts/AuthContext';

/**
 * Results: join image features (L0 / seg / SAM from R2 CSV) with perception ratings.
 */
export default function ImagePerceptionPanel({ currentProject, responses, questions }) {
  const { user } = useAuth();
  const [modelFilter, setModelFilter] = useState('all'); // all | l0 | seg | sam
  const [featureMap, setFeatureMap] = useState(null);
  const [loadingFeatures, setLoadingFeatures] = useState(false);

  const userId = user?.id || currentProject?.user_id || 'anonymous';
  const projectId = currentProject?.id;
  const r2Prefix = projectId ? `${userId}/${projectId}/` : '';

  useEffect(() => {
    let cancelled = false;
    (async () => {
      if (!r2Prefix || !isR2Configured()) {
        setFeatureMap({});
        return;
      }
      setLoadingFeatures(true);
      try {
        const map = await loadFeaturesMapFromR2(r2Prefix, FEATURE_MODELS);
        if (!cancelled) setFeatureMap(map);
      } catch (err) {
        console.warn(err);
        if (!cancelled) setFeatureMap({});
      } finally {
        if (!cancelled) setLoadingFeatures(false);
      }
    })();
    return () => { cancelled = true; };
  }, [r2Prefix]);

  const rows = useMemo(
    () => buildImagePerceptionRows(currentProject, responses, questions, featureMap || {}),
    [currentProject, responses, questions, featureMap],
  );

  const filteredRows = useMemo(() => {
    if (modelFilter === 'l0') return rows.filter((r) => r.l0_status === 'ready');
    if (modelFilter === 'seg') return rows.filter((r) => r.seg_status === 'ready');
    if (modelFilter === 'sam') return rows.filter((r) => r.sam_status === 'ready');
    return rows;
  }, [rows, modelFilter]);

  const correlations = useMemo(
    () => correlateFeaturesWithPerception(filteredRows),
    [filteredRows],
  );

  const featureCols = useMemo(() => {
    const skip = new Set([
      'media_id', 'name', 'url', 'mean_score', 'n_ratings',
      'l0_status', 'seg_status', 'sam_status', 'seg_vocab',
    ]);
    const keys = new Set();
    filteredRows.forEach((r) => {
      Object.keys(r).forEach((k) => {
        if (skip.has(k)) return;
        if (modelFilter === 'l0' && (k.startsWith('seg_') || k.startsWith('sam_'))) return;
        if (modelFilter === 'seg' && !k.startsWith('seg_')) return;
        if (modelFilter === 'sam' && !k.startsWith('sam_')) return;
        if (typeof r[k] === 'number') keys.add(k);
      });
    });
    return [...keys].slice(0, 12);
  }, [filteredRows, modelFilter]);

  const l0Count = rows.filter((r) => r.l0_status === 'ready').length;
  const segCount = rows.filter((r) => r.seg_status === 'ready').length;
  const samCount = rows.filter((r) => r.sam_status === 'ready').length;
  const ratedCount = rows.filter((r) => r.n_ratings > 0).length;

  if (loadingFeatures || featureMap == null) {
    return (
      <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, mb: 2 }}>
        <CircularProgress size={18} />
        <Typography variant="body2" color="text.secondary">Loading R2 feature CSVs…</Typography>
      </Box>
    );
  }

  if (!rows.length) {
    return (
      <Alert severity="info" sx={{ mb: 2 }}>
        No image features or perception ratings to join yet. Extract L0 / Seg / SAM pre-annotate
        in Media Dataset (R2 CSV), then collect image rating responses.
      </Alert>
    );
  }

  return (
    <Accordion defaultExpanded sx={{ mb: 3 }}>
      <AccordionSummary expandIcon={<ExpandMore />}>
        <Box>
          <Typography variant="subtitle1" fontWeight={700}>
            Image × Perception
          </Typography>
          <Typography variant="caption" color="text.secondary">
            Join {L0_MODEL} / {SEG_MODEL} / {SAM_PREANNOT_MODEL} (R2 CSV) with ratings
          </Typography>
        </Box>
      </AccordionSummary>
      <AccordionDetails>
        <Box sx={{ display: 'flex', gap: 1, flexWrap: 'wrap', mb: 2, alignItems: 'center' }}>
          <Chip size="small" label={`L0: ${l0Count}`} color={l0Count ? 'success' : 'default'} />
          <Chip size="small" label={`Seg: ${segCount}`} color={segCount ? 'success' : 'default'} />
          <Chip size="small" label={`SAM: ${samCount}`} color={samCount ? 'secondary' : 'default'} />
          <Chip size="small" label={`Rated images: ${ratedCount}`} />
          <FormControl size="small" sx={{ minWidth: 160 }}>
            <InputLabel>Features</InputLabel>
            <Select
              label="Features"
              value={modelFilter}
              onChange={(e) => setModelFilter(e.target.value)}
            >
              <MenuItem value="all">All models</MenuItem>
              <MenuItem value="l0">L0 only</MenuItem>
              <MenuItem value="seg">Seg only</MenuItem>
              <MenuItem value="sam">SAM pre-annot only</MenuItem>
            </Select>
          </FormControl>
          <Button
            size="small"
            variant="outlined"
            startIcon={<Download />}
            onClick={() => exportImagePerceptionCsv(filteredRows)}
            disabled={!filteredRows.length}
          >
            Export wide CSV
          </Button>
        </Box>

        {correlations.length > 0 && (
          <Box sx={{ mb: 2 }}>
            <Typography variant="subtitle2" sx={{ mb: 1 }}>
              Correlation with mean rating (Pearson r, n≥3)
            </Typography>
            <Box sx={{ display: 'flex', flexWrap: 'wrap', gap: 0.75 }}>
              {correlations.slice(0, 10).map((c) => (
                <Chip
                  key={c.feature}
                  size="small"
                  variant="outlined"
                  label={`${c.feature}: r=${c.r.toFixed(2)} (n=${c.n})`}
                  color={Math.abs(c.r) >= 0.3 ? 'primary' : 'default'}
                />
              ))}
            </Box>
          </Box>
        )}

        <TableContainer component={Paper} variant="outlined" sx={{ maxHeight: 420 }}>
          <Table size="small" stickyHeader>
            <TableHead>
              <TableRow>
                <TableCell>Image</TableCell>
                <TableCell align="right">Mean</TableCell>
                <TableCell align="right">n</TableCell>
                <TableCell>L0</TableCell>
                <TableCell>Seg</TableCell>
                <TableCell>SAM</TableCell>
                {featureCols.map((c) => (
                  <TableCell key={c} align="right">{c}</TableCell>
                ))}
              </TableRow>
            </TableHead>
            <TableBody>
              {filteredRows.slice(0, 100).map((r) => (
                <TableRow key={r.media_id}>
                  <TableCell sx={{ maxWidth: 160, overflow: 'hidden', textOverflow: 'ellipsis' }}>
                    {r.name}
                  </TableCell>
                  <TableCell align="right">{r.mean_score != null ? r.mean_score.toFixed(2) : '—'}</TableCell>
                  <TableCell align="right">{r.n_ratings || 0}</TableCell>
                  <TableCell>
                    <Chip size="small" label={r.l0_status} color={r.l0_status === 'ready' ? 'success' : 'default'} />
                  </TableCell>
                  <TableCell>
                    <Chip size="small" label={r.seg_status} color={r.seg_status === 'ready' ? 'success' : 'default'} />
                  </TableCell>
                  <TableCell>
                    <Chip size="small" label={r.sam_status || 'missing'} color={r.sam_status === 'ready' ? 'secondary' : 'default'} />
                  </TableCell>
                  {featureCols.map((c) => (
                    <TableCell key={c} align="right">
                      {typeof r[c] === 'number' ? r[c].toFixed(3) : (r[c] ?? '—')}
                    </TableCell>
                  ))}
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </TableContainer>
      </AccordionDetails>
    </Accordion>
  );
}
