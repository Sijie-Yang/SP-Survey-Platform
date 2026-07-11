/**
 * Shared L0 / SegFormer batch jobs writing features to R2 CSV.
 * Used by project Media Dataset and admin Template image dialog.
 */
import React, { useEffect, useMemo, useRef, useState } from 'react';
import {
  Box, Button, Typography, LinearProgress, Alert, Chip, Stack,
} from '@mui/material';
import { L0_MODEL } from '../../lib/imageFeaturesL0';
import { SEG_MODEL, SEGFORMER_HF_MODEL } from '../../lib/falInference';
import {
  loadFeaturesMapFromR2,
  FEATURE_MODELS,
} from '../../lib/imageFeaturesR2';
import { isR2Configured } from '../../lib/r2';
import {
  normalizeImageList,
  isFeatureReady,
  getFeatureRec,
  runL0Extraction,
  runSegExtraction,
} from '../../lib/runFeatureExtraction';

/**
 * @param {{
 *   r2Prefix: string,
 *   images: array,
 *   hfToken: string,
 *   onFeaturesUpdated?: (map) => void,
 * }} props
 */
export default function FeatureExtractionJobs({
  r2Prefix,
  images: rawImages,
  hfToken = '',
  onFeaturesUpdated,
}) {
  const [busy, setBusy] = useState(null);
  const [progress, setProgress] = useState({ done: 0, total: 0 });
  const [message, setMessage] = useState(null);
  const [error, setError] = useState(null);
  const [featureMap, setFeatureMap] = useState({});
  const [loadingMap, setLoadingMap] = useState(false);
  const abortRef = useRef(false);

  const images = useMemo(() => normalizeImageList(rawImages), [rawImages]);

  const reloadMap = async () => {
    if (!r2Prefix || !isR2Configured()) {
      setFeatureMap({});
      return {};
    }
    setLoadingMap(true);
    try {
      const map = await loadFeaturesMapFromR2(r2Prefix, FEATURE_MODELS);
      setFeatureMap(map);
      onFeaturesUpdated?.(map);
      return map;
    } catch (err) {
      console.warn(err);
      return {};
    } finally {
      setLoadingMap(false);
    }
  };

  useEffect(() => {
    reloadMap();
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [r2Prefix]);

  const l0Ready = images.filter((m) => isFeatureReady(getFeatureRec(featureMap, m, L0_MODEL))).length;
  const segReady = images.filter((m) => isFeatureReady(getFeatureRec(featureMap, m, SEG_MODEL))).length;

  const requestStop = () => { abortRef.current = true; };

  const runL0 = async () => {
    abortRef.current = false;
    setBusy('l0');
    setError(null);
    setMessage(null);
    try {
      // If nothing pending, re-run all (manual refresh of features).
      const pending = images.filter((m) => !isFeatureReady(getFeatureRec(featureMap, m, L0_MODEL)));
      const result = await runL0Extraction({
        r2Prefix,
        images,
        featureMap,
        skipReady: pending.length > 0,
        onProgress: ({ done, total, featureMap: map }) => {
          setProgress({ done, total });
          setFeatureMap({ ...map });
        },
        shouldAbort: () => abortRef.current,
      });
      setFeatureMap(result.featureMap);
      onFeaturesUpdated?.(result.featureMap);
      await reloadMap();
      setMessage(result.stopped
        ? `L0 stopped. Wrote ${result.done}/${result.total} to R2 CSV.`
        : result.total === 0
          ? `All ${result.skipped} image(s) already have L0 features.`
          : `L0 done for ${result.done} image(s) → R2 features/${L0_MODEL}.csv`
            + (result.skipped ? ` (skipped ${result.skipped} ready)` : ''));
    } catch (err) {
      setError(err.message || String(err));
    }
    setBusy(null);
  };

  const runSeg = async () => {
    abortRef.current = false;
    setBusy('seg');
    setError(null);
    setMessage(null);
    try {
      const result = await runSegExtraction({
        r2Prefix,
        images,
        featureMap,
        hfToken,
        onProgress: ({ done, total, featureMap: map }) => {
          setProgress({ done, total });
          setFeatureMap({ ...map });
        },
        shouldAbort: () => abortRef.current,
      });
      setFeatureMap(result.featureMap);
      onFeaturesUpdated?.(result.featureMap);
      await reloadMap();
      setMessage(result.stopped
        ? `Seg stopped. Wrote ${result.done}/${result.total} to R2 CSV.`
        : result.total === 0
          ? 'All images already have Seg features on R2.'
          : `SegFormer done for ${result.done} image(s) → R2 features/${SEG_MODEL}.csv`
            + (result.skipped ? ` (skipped ${result.skipped} ready)` : ''));
    } catch (err) {
      setError(err.message || String(err));
    }
    setBusy(null);
  };

  return (
    <Stack spacing={1.5}>
      {message && <Alert severity="success" onClose={() => setMessage(null)}>{message}</Alert>}
      {error && <Alert severity="error" onClose={() => setError(null)}>{error}</Alert>}
      <Typography variant="body2" color="text.secondary">
        Features stored on R2 as CSV under <code>{r2Prefix}features/</code> (keyed by media_id / filename — migrates with template→project).
        {loadingMap ? ' Loading existing CSV…' : ''}
      </Typography>

      <Typography variant="subtitle2">L0 ({L0_MODEL})</Typography>
      <Stack direction="row" spacing={1} alignItems="center" flexWrap="wrap">
        <Chip size="small" label={`L0 ready: ${l0Ready}/${images.length}`} color={l0Ready ? 'success' : 'default'} />
        <Button size="small" variant="contained" disabled={!!busy || !images.length} onClick={runL0}>
          Extract L0 features
        </Button>
        {busy === 'l0' && <Button size="small" color="warning" variant="outlined" onClick={requestStop}>Stop</Button>}
      </Stack>

      <Typography variant="subtitle2">Streetscape Seg ({SEG_MODEL})</Typography>
      <Typography variant="caption" color="text.secondary">
        {SEGFORMER_HF_MODEL} via HuggingFace — needs HF token saved above.
      </Typography>
      <Stack direction="row" spacing={1} alignItems="center" flexWrap="wrap">
        <Chip size="small" label={`Seg ready: ${segReady}/${images.length}`} color={segReady ? 'success' : 'default'} />
        <Button
          size="small"
          variant="contained"
          color="secondary"
          disabled={!!busy || !images.length || !String(hfToken || '').trim()}
          onClick={runSeg}
        >
          Run streetscape segmentation
        </Button>
        {busy === 'seg' && <Button size="small" color="warning" variant="outlined" onClick={requestStop}>Stop</Button>}
      </Stack>

      {busy && (
        <Box>
          <Typography variant="caption">
            {busy === 'l0' ? 'Extracting L0…' : 'Segmenting…'} {progress.done}/{progress.total}
          </Typography>
          <LinearProgress
            variant={progress.total ? 'determinate' : 'indeterminate'}
            value={progress.total ? (100 * progress.done) / progress.total : 0}
          />
        </Box>
      )}
    </Stack>
  );
}
