import React, { useEffect, useRef, useState } from 'react';
import {
  Accordion, AccordionSummary, AccordionDetails, Box, Button, TextField, Typography,
  Alert, Chip, Stack,
} from '@mui/material';
import { ExpandMore } from '@mui/icons-material';
import { testFalKey } from '../../lib/falInference';
import { testHuggingFaceToken } from '../../lib/huggingface';
import {
  loadUserSpatialSettings,
  saveUserSpatialSettings,
  coalesceSpatialSettings,
  mergeSpatialIntoConfig,
  pickSpatialSettings,
} from '../../lib/spatialSettingsStore';
import { useAuth } from '../../contexts/AuthContext';
import FeatureExtractionJobs from './FeatureExtractionJobs';

function keyHint(key) {
  if (!key || key.length < 4) return '';
  return key.slice(-4);
}

/**
 * Spatial intelligence: HF + fal keys (researcher) + L0/Seg jobs.
 * SAM is for Media Dataset pre-annotation only — never live surveys.
 */
export default function SpatialIntelligencePanel({
  currentProject,
  onProjectUpdate,
  onConfigChange,
  onFeaturesUpdated,
}) {
  const { user } = useAuth();
  const cfg = currentProject?.imageDatasetConfig || {};
  const savedFalKey = cfg.falApiKey || '';
  const savedHfToken = cfg.huggingFaceToken || '';
  const [falKey, setFalKey] = useState(savedFalKey);
  const [hfKey, setHfKey] = useState(savedHfToken);
  const [editingFal, setEditingFal] = useState(!savedFalKey);
  const [editingHf, setEditingHf] = useState(!savedHfToken);
  const [busy, setBusy] = useState(null);
  const [message, setMessage] = useState(null);
  const [error, setError] = useState(null);
  const [userSettingsLoaded, setUserSettingsLoaded] = useState(false);
  const cfgRef = useRef(cfg);
  cfgRef.current = cfg;
  const projectRef = useRef(currentProject);
  projectRef.current = currentProject;
  const hydratedProjectRef = useRef(null);

  const userId = user?.id || 'anonymous';
  const projectId = currentProject?.id;
  const r2Prefix = projectId ? `${userId}/${projectId}/` : '';

  useEffect(() => {
    setFalKey(cfg.falApiKey || '');
    setHfKey(cfg.huggingFaceToken || '');
    setEditingFal(!(cfg.falApiKey));
    setEditingHf(!(cfg.huggingFaceToken));
  }, [cfg.falApiKey, cfg.huggingFaceToken, currentProject?.id]);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      if (!user?.id || !currentProject?.id) {
        setUserSettingsLoaded(true);
        return;
      }
      if (hydratedProjectRef.current === currentProject.id) {
        setUserSettingsLoaded(true);
        return;
      }
      const userSettings = await loadUserSpatialSettings(user.id);
      if (cancelled) return;
      setUserSettingsLoaded(true);
      hydratedProjectRef.current = currentProject.id;
      if (!userSettings) return;

      const merged = coalesceSpatialSettings(cfgRef.current, userSettings);
      const projectHadGaps = !cfgRef.current?.falApiKey || !cfgRef.current?.huggingFaceToken;
      setFalKey(merged.falApiKey);
      setHfKey(merged.huggingFaceToken);
      setEditingFal(!merged.falApiKey);
      setEditingHf(!merged.huggingFaceToken);

      if (projectHadGaps && (merged.falApiKey || merged.huggingFaceToken)) {
        const nextCfg = mergeSpatialIntoConfig(cfgRef.current, {
          ...merged,
          enableSamAssist: false,
        });
        const latest = cfgRef.current || {};
        const { imageFeatures: _drop, ...rest } = latest;
        const full = { ...rest, ...nextCfg, enableSamAssist: false };
        const base = projectRef.current;
        const updated = { ...base, imageDatasetConfig: full };
        cfgRef.current = full;
        projectRef.current = updated;
        onProjectUpdate?.(updated);
        onConfigChange?.(true, full);
      }
    })();
    return () => { cancelled = true; };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [user?.id, currentProject?.id]);

  const persistConfig = (nextCfg) => {
    const latest = cfgRef.current || {};
    const { imageFeatures: _drop, ...rest } = latest;
    const merged = { ...rest, ...nextCfg, enableSamAssist: false };
    delete merged.imageFeatures;
    const base = projectRef.current || currentProject;
    const updated = { ...base, imageDatasetConfig: merged };
    cfgRef.current = merged;
    projectRef.current = updated;
    onProjectUpdate?.(updated);
    onConfigChange?.(true, merged);
    return merged;
  };

  const saveAllSettings = async (overrides = {}) => {
    setBusy('save-settings');
    setError(null);
    const spatial = pickSpatialSettings({
      falApiKey: overrides.falApiKey !== undefined ? overrides.falApiKey : falKey,
      huggingFaceToken: overrides.huggingFaceToken !== undefined ? overrides.huggingFaceToken : hfKey,
      enableSamAssist: false,
    });
    setFalKey(spatial.falApiKey);
    setHfKey(spatial.huggingFaceToken);
    const next = mergeSpatialIntoConfig(cfgRef.current, spatial);
    persistConfig(next);
    const userResult = await saveUserSpatialSettings(user?.id, spatial);
    setEditingFal(!spatial.falApiKey);
    setEditingHf(!spatial.huggingFaceToken);
    setBusy(null);
    if (userResult.success) {
      setMessage('Settings saved to this project and your account (syncs across computers when logged in).');
    } else if (user?.id) {
      setMessage('Settings saved to this project. Account sync unavailable — run supabase/spatial_intelligence.sql for user_spatial_settings.');
    } else {
      setMessage('Settings saved to this project. Log in with Supabase to sync across computers.');
    }
  };

  const clearFalKey = async () => {
    setFalKey('');
    setEditingFal(true);
    await saveAllSettings({ falApiKey: '' });
  };

  const clearHfKey = async () => {
    setHfKey('');
    setEditingHf(true);
    await saveAllSettings({ huggingFaceToken: '' });
  };

  const handleTestFal = async () => {
    setBusy('test-fal');
    setError(null);
    try {
      await testFalKey(falKey);
      setMessage('Fal API key looks valid.');
    } catch (err) {
      setError(err.message || String(err));
    } finally {
      setBusy(null);
    }
  };

  const handleTestHf = async () => {
    setBusy('test-hf');
    setError(null);
    try {
      const info = await testHuggingFaceToken(hfKey);
      setMessage(info.name
        ? `HuggingFace token valid (user: ${info.name}).`
        : 'HuggingFace token looks valid.');
    } catch (err) {
      setError(err.message || String(err));
    } finally {
      setBusy(null);
    }
  };

  return (
    <Accordion defaultExpanded={false} sx={{ mb: 2 }}>
      <AccordionSummary expandIcon={<ExpandMore />}>
        <Box>
          <Typography variant="subtitle1" fontWeight={700}>
            Spatial Intelligence — Features & API keys
          </Typography>
          <Typography variant="caption" color="text.secondary">
            L0 / Seg → R2 CSV · SAM3 pre-annotate in Uploaded Media (not in surveys)
          </Typography>
        </Box>
      </AccordionSummary>
      <AccordionDetails>
        <Stack spacing={2}>
          {message && <Alert severity="success" onClose={() => setMessage(null)}>{message}</Alert>}
          {error && <Alert severity="error" onClose={() => setError(null)}>{error}</Alert>}

          <Alert severity="info">
            Live surveys never use SAM. Use SAM3 under Uploaded Media → Pre-annotate.
            SegFormer needs HF; SAM3 pre-annotate needs fal.
            {!userSettingsLoaded ? ' Loading account settings…' : ''}
          </Alert>

          <Typography variant="subtitle2">HuggingFace token</Typography>
          {!editingHf && (savedHfToken || hfKey) ? (
            <Box sx={{ display: 'flex', gap: 1, alignItems: 'center', flexWrap: 'wrap' }}>
              <Chip label={`HF saved · …${keyHint(savedHfToken || hfKey)}`} color="success" size="small" />
              <Button size="small" onClick={() => setEditingHf(true)}>Replace</Button>
            </Box>
          ) : (
            <TextField
              type="password"
              size="small"
              fullWidth
              label="HF_TOKEN"
              value={hfKey}
              onChange={(e) => setHfKey(e.target.value)}
              helperText="From huggingface.co/settings/tokens — SegFormer streetscape."
            />
          )}
          <Box sx={{ display: 'flex', gap: 1, flexWrap: 'wrap' }}>
            <Button size="small" variant="outlined" disabled={!hfKey || busy === 'test-hf'} onClick={handleTestHf}>
              Test HF
            </Button>
            <Button size="small" color="error" variant="text" disabled={!savedHfToken && !hfKey} onClick={clearHfKey}>
              Clear HF
            </Button>
          </Box>

          <Typography variant="subtitle2" sx={{ pt: 1 }}>fal.ai API key</Typography>
          <Typography variant="body2" color="text.secondary">
            For SAM3 pre-annotation in Media Dataset only (researcher tool).
          </Typography>
          {!editingFal && (savedFalKey || falKey) ? (
            <Box sx={{ display: 'flex', gap: 1, alignItems: 'center', flexWrap: 'wrap' }}>
              <Chip label={`fal saved · …${keyHint(savedFalKey || falKey)}`} color="success" size="small" />
              <Button size="small" onClick={() => setEditingFal(true)}>Replace</Button>
            </Box>
          ) : (
            <TextField
              type="password"
              size="small"
              fullWidth
              label="FAL_KEY"
              value={falKey}
              onChange={(e) => setFalKey(e.target.value)}
              helperText="From fal.ai/dashboard/keys — full key_id:secret."
            />
          )}
          <Box sx={{ display: 'flex', gap: 1, flexWrap: 'wrap' }}>
            <Button
              size="small"
              variant="contained"
              disabled={busy === 'save-settings'}
              onClick={() => saveAllSettings()}
            >
              Save settings
            </Button>
            <Button size="small" variant="outlined" disabled={!falKey || busy === 'test-fal'} onClick={handleTestFal}>
              Test fal
            </Button>
            <Button size="small" color="error" variant="text" disabled={!savedFalKey && !falKey} onClick={clearFalKey}>
              Clear fal
            </Button>
          </Box>

          {busy === 'save-settings' && (
            <Typography variant="caption" color="text.secondary">Saving settings…</Typography>
          )}

          <FeatureExtractionJobs
            r2Prefix={r2Prefix}
            images={currentProject?.preloadedImages || []}
            hfToken={hfKey || savedHfToken}
            onFeaturesUpdated={onFeaturesUpdated}
          />
        </Stack>
      </AccordionDetails>
    </Accordion>
  );
}
