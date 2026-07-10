/**
 * Shared L0 / SegFormer batch jobs writing features to R2 CSV.
 * Used by project Media Dataset and admin Template image dialog.
 */
import React, { useEffect, useMemo, useRef, useState } from 'react';
import {
  Box, Button, Typography, LinearProgress, Alert, Chip, Stack,
} from '@mui/material';
import { normalizeMediaEntry, getMediaId } from '../../lib/mediaUtils';
import { extractL0Features, L0_MODEL } from '../../lib/imageFeaturesL0';
import { featureStorageKey } from '../../lib/imageFeaturesStore';
import {
  runStreetscapeSegmentation, STREETSCAPE_VOCAB, SEG_MODEL,
  SEGFORMER_HF_MODEL, segLabelToKey, maskUrlToRatio,
} from '../../lib/falInference';
import {
  loadFeaturesMapFromR2,
  saveFeatureCsv,
  FEATURE_MODELS,
} from '../../lib/imageFeaturesR2';
import { isR2Configured } from '../../lib/r2';

const yieldToUi = () => new Promise((r) => setTimeout(r, 0));

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

  const images = useMemo(
    () => (rawImages || [])
      .map(normalizeMediaEntry)
      .filter((m) => m && m.type === 'image' && m.url),
    [rawImages],
  );

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

  const l0Ready = images.filter((m) => {
    const rec = featureMap[featureStorageKey(getMediaId(m), L0_MODEL)]
      || featureMap[featureStorageKey(m.name, L0_MODEL)];
    return rec?.status === 'ready' || (rec?.features && Object.keys(rec.features).length > 0);
  }).length;
  const segReady = images.filter((m) => {
    const rec = featureMap[featureStorageKey(getMediaId(m), SEG_MODEL)]
      || featureMap[featureStorageKey(m.name, SEG_MODEL)];
    return rec?.status === 'ready' || (rec?.features && Object.keys(rec.features).length > 0);
  }).length;

  const requestStop = () => { abortRef.current = true; };

  const runL0 = async () => {
    if (!isR2Configured()) {
      setError('R2 is not configured — features are stored as CSV on R2.');
      return;
    }
    if (!r2Prefix) {
      setError('Missing R2 prefix.');
      return;
    }
    if (!images.length) {
      setError('No images.');
      return;
    }
    abortRef.current = false;
    setBusy('l0');
    setError(null);
    const map = { ...featureMap };
    const pending = images.filter((m) => {
      const rec = map[featureStorageKey(getMediaId(m), L0_MODEL)]
        || map[featureStorageKey(m.name, L0_MODEL)];
      return !(rec?.status === 'ready' || (rec?.features && Object.keys(rec.features).length > 0));
    });
    const work = pending.length ? pending : images;
    setProgress({ done: 0, total: work.length });
    const batch = [];
    let done = 0;
    let stopped = false;
    const FLUSH = 10;

    const flush = async () => {
      if (!batch.length) return;
      await saveFeatureCsv(r2Prefix, L0_MODEL, batch.splice(0, batch.length));
    };

    for (let i = 0; i < work.length; i += 1) {
      if (abortRef.current) { stopped = true; break; }
      const media = work[i];
      const mediaId = getMediaId(media);
      let record;
      try {
        // eslint-disable-next-line no-await-in-loop
        record = await extractL0Features(media.url);
        record = { ...record, media_id: mediaId, name: media.name };
      } catch (err) {
        record = {
          model: L0_MODEL,
          media_id: mediaId,
          name: media.name,
          status: 'error',
          error: err.message || String(err),
          computed_at: new Date().toISOString(),
          features: {},
        };
      }
      batch.push(record);
      map[featureStorageKey(mediaId, L0_MODEL)] = record;
      done += 1;
      setProgress({ done, total: work.length });
      setFeatureMap({ ...map });
      if (batch.length >= FLUSH) {
        // eslint-disable-next-line no-await-in-loop
        await flush();
      }
      // eslint-disable-next-line no-await-in-loop
      await yieldToUi();
    }
    try {
      await flush();
      await reloadMap();
    } catch (err) {
      setError(err.message || String(err));
    }
    setBusy(null);
    setMessage(stopped
      ? `L0 stopped. Wrote ${done}/${work.length} to R2 CSV.`
      : `L0 done for ${done} image(s) → R2 features/${L0_MODEL}.csv`);
  };

  const runSeg = async () => {
    const token = String(hfToken || '').trim();
    if (!token) {
      setError('HuggingFace token required (save it in Spatial Intelligence / API keys).');
      return;
    }
    if (!isR2Configured() || !r2Prefix) {
      setError('R2 is not configured.');
      return;
    }
    if (!images.length) {
      setError('No images.');
      return;
    }
    abortRef.current = false;
    setBusy('seg');
    setError(null);
    const map = { ...featureMap };
    const pending = images.filter((m) => {
      const rec = map[featureStorageKey(getMediaId(m), SEG_MODEL)]
        || map[featureStorageKey(m.name, SEG_MODEL)];
      return !(rec?.status === 'ready' || (rec?.features && Object.keys(rec.features).length > 0));
    });
    const work = pending.length ? pending : [];
    if (!work.length) {
      setBusy(null);
      setMessage('All images already have Seg features on R2.');
      return;
    }
    setProgress({ done: 0, total: work.length });
    const batch = [];
    let done = 0;
    let stopped = false;
    const FLUSH = 5;

    const flush = async () => {
      if (!batch.length) return;
      await saveFeatureCsv(r2Prefix, SEG_MODEL, batch.splice(0, batch.length));
    };

    for (let i = 0; i < work.length; i += 1) {
      if (abortRef.current) { stopped = true; break; }
      const media = work[i];
      const mediaId = getMediaId(media);
      let record;
      try {
        // eslint-disable-next-line no-await-in-loop
        const { masks, labels, model, compute_runtime } = await runStreetscapeSegmentation({
          hfToken: token,
          imageUrl: media.url,
        });
        const features = {
          seg_vocab: labels || STREETSCAPE_VOCAB,
          seg_backbone: model || SEGFORMER_HF_MODEL,
        };
        const labelList = labels?.length ? labels : Object.keys(masks || {});
        // eslint-disable-next-line no-await-in-loop
        for (const label of labelList) {
          features[`seg_ratio_${segLabelToKey(label)}`] = await maskUrlToRatio(masks?.[label]);
        }
        record = {
          model: SEG_MODEL,
          media_id: mediaId,
          name: media.name,
          features,
          status: 'ready',
          compute_runtime: compute_runtime || 'hf_segformer_cityscapes',
          computed_at: new Date().toISOString(),
        };
      } catch (err) {
        if (err?.name === 'AbortError') { stopped = true; break; }
        record = {
          model: SEG_MODEL,
          media_id: mediaId,
          name: media.name,
          status: 'error',
          error: err.message || String(err),
          features: {},
          computed_at: new Date().toISOString(),
        };
      }
      batch.push(record);
      map[featureStorageKey(mediaId, SEG_MODEL)] = record;
      done += 1;
      setProgress({ done, total: work.length });
      setFeatureMap({ ...map });
      if (batch.length >= FLUSH) {
        // eslint-disable-next-line no-await-in-loop
        await flush();
      }
    }
    try {
      await flush();
      await reloadMap();
    } catch (err) {
      setError(err.message || String(err));
    }
    setBusy(null);
    setMessage(stopped
      ? `Seg stopped. Wrote ${done}/${work.length} to R2 CSV.`
      : `SegFormer done for ${done} image(s) → R2 features/${SEG_MODEL}.csv`);
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
