import React, { useCallback, useEffect, useRef, useState } from 'react';
import {
  Alert,
  Box,
  Button,
  Card,
  CardContent,
  Chip,
  FormControl,
  InputLabel,
  LinearProgress,
  MenuItem,
  Select,
  Stack,
  TextField,
  Typography,
} from '@mui/material';
import { useRegion } from '../../contexts/RegionContext';
import { tf } from '../../contexts/adminI18n';
import {
  cancelSiliconRun,
  createSiliconRun,
  deleteSiliconPersona,
  getCredentialStatus,
  getSiliconCompare,
  listSiliconPersonas,
  listSiliconRuns,
  exportSiliconRun,
  processSiliconRun,
  saveSiliconPersona,
} from '../../lib/agentApi';

export default function SiliconSamples({ currentProject }) {
  const { t } = useRegion();
  const projectId = currentProject?.id;
  const [personas, setPersonas] = useState([]);
  const [runs, setRuns] = useState([]);
  const [name, setName] = useState('');
  const [city, setCity] = useState('');
  const [notes, setNotes] = useState('');
  const [repeats, setRepeats] = useState(1);
  const [budgetTokens, setBudgetTokens] = useState(25000);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [compare, setCompare] = useState(null);
  const [selectedIds, setSelectedIds] = useState([]);
  const [visionRoutes, setVisionRoutes] = useState([]);
  const [overrideRoute, setOverrideRoute] = useState('');
  const [overrideEffort, setOverrideEffort] = useState('');
  const projectIdRef = useRef(projectId);
  projectIdRef.current = projectId;

  const refresh = useCallback(async () => {
    if (!projectId) return;
    const [p, r] = await Promise.all([
      listSiliconPersonas(projectId),
      listSiliconRuns(projectId),
    ]);
    if (projectIdRef.current !== projectId) return;
    if (p.success) setPersonas(p.personas || []);
    if (r.success) setRuns(r.runs || []);
    if (p.error || r.error) setError(p.error || r.error || '');
    const status = await getCredentialStatus();
    if (status.success !== false) {
      const options = [];
      (status.directory || []).forEach((provider) => {
        if (!provider.configured || provider.authUnsupported) return;
        (provider.models || []).forEach((model) => {
          const vision = !!(model.vision || (model.input || []).includes('image'));
          if (!vision || !model.id) return;
          options.push({
            value: `${provider.id}::${model.id}`,
            provider: provider.id,
            model: model.id,
            label: `${provider.displayName} / ${model.label || model.name || model.id}`,
            reasoningEfforts: model.reasoningEfforts || false,
            defaultEffort: model.defaultEffort || '',
          });
        });
      });
      setVisionRoutes(options);
      const def = status.siliconRoute;
      if (def?.provider && def?.model) {
        setOverrideRoute((current) => {
          if (current) return current;
          setOverrideEffort(def.reasoningEffort || '');
          return `${def.provider}::${def.model}`;
        });
      }
    }
  }, [projectId]);

  useEffect(() => { refresh(); }, [refresh]);
  useEffect(() => {
    setSelectedIds([]);
    setCompare(null);
    setError('');
    setBusy(false);
  }, [projectId]);

  const addPersona = async () => {
    if (!name.trim()) return;
    setBusy(true);
    const result = await saveSiliconPersona({
      projectId,
      name: name.trim(),
      attributes: { city, notes },
    });
    setBusy(false);
    if (!result.success) {
      setError(result.error || 'Could not save persona');
      return;
    }
    setName('');
    setCity('');
    setNotes('');
    refresh();
  };

  const togglePersona = (id) => {
    setSelectedIds((cur) => (cur.includes(id) ? cur.filter((x) => x !== id) : [...cur, id]));
  };

  const pumpRun = async (runId, requestProjectId = projectId) => {
    const maxSteps = 102;
    for (let i = 0; i < maxSteps; i += 1) {
      const step = await processSiliconRun(runId);
      if (projectIdRef.current !== requestProjectId) return step;
      if (!step.success) return step;
      await refresh();
      if (step.finished) return step;
    }
    return { success: false, error: 'Run did not finish' };
  };

  const startRun = async () => {
    if (!selectedIds.length) {
      setError(t.siliconPickPersona);
      return;
    }
    if (!overrideRoute) {
      setError(t.modelsSelectVision);
      return;
    }
    setBusy(true);
    setError('');
    const requestProjectId = projectId;
    const [provider, model] = String(overrideRoute || '').split('::');
    const created = await createSiliconRun({
      projectId,
      personaIds: selectedIds,
      repeats: Number(repeats) || 1,
      budgetTokens: Number(budgetTokens) || 25000,
      provider: provider || undefined,
      model: model || undefined,
      reasoningEffort: overrideEffort || undefined,
    });
    if (!created.success) {
      setBusy(false);
      setError(created.error || 'Could not start run');
      return;
    }
    if (projectIdRef.current !== requestProjectId) return;
    const runId = created.run?.id;
    const step = await pumpRun(runId, requestProjectId);
    if (step?.success && step.status === 'completed') {
      const cmp = await getSiliconCompare(runId);
      if (cmp.success) setCompare(cmp);
    } else if (step && !step.success) {
      setError(step.error || step.code || `Run ${step.status || 'failed'}`);
    }
    setBusy(false);
    refresh();
  };

  const resumeRun = async (runId) => {
    setBusy(true);
    setError('');
    const step = await pumpRun(runId);
    if (step?.success && step.status === 'completed') {
      const cmp = await getSiliconCompare(runId);
      if (cmp.success) setCompare(cmp);
    } else if (step && !step.success) {
      setError(step.error || step.code || `Run ${step.status || 'failed'}`);
    }
    setBusy(false);
    refresh();
  };

  const downloadExport = async (runId) => {
    const payload = await exportSiliconRun(runId);
    if (!payload?.success) {
      setError(payload?.error || 'Export failed');
      return;
    }
    const blob = new Blob([JSON.stringify(payload, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = `silicon-run-${runId}.json`;
    link.click();
    URL.revokeObjectURL(url);
    if (payload.csv) {
      const csvBlob = new Blob([payload.csv], { type: 'text/csv;charset=utf-8' });
      const csvUrl = URL.createObjectURL(csvBlob);
      const csvLink = document.createElement('a');
      csvLink.href = csvUrl;
      csvLink.download = `silicon-run-${runId}.csv`;
      csvLink.click();
      URL.revokeObjectURL(csvUrl);
    }
  };

  if (!projectId) {
    return <Typography color="text.secondary">{t.noProjectBody}</Typography>;
  }

  return (
    <Box>
      <Typography variant="h5" gutterBottom>{t.tabSilicon}</Typography>
      <Alert severity="info" sx={{ mb: 2 }}>{t.siliconDisclaimer}</Alert>
      {error && <Alert severity="warning" sx={{ mb: 2 }} onClose={() => setError('')}>{error}</Alert>}

      <Stack direction={{ xs: 'column', md: 'row' }} spacing={2} alignItems="stretch">
        <Card variant="outlined" sx={{ flex: 1 }}>
          <CardContent>
            <Typography fontWeight={700} sx={{ mb: 1 }}>{t.siliconPersonas}</Typography>
            <Stack spacing={1} sx={{ mb: 2 }}>
              <TextField size="small" label={t.siliconName} value={name} onChange={(e) => setName(e.target.value)} />
              <TextField size="small" label={t.siliconCity} value={city} onChange={(e) => setCity(e.target.value)} />
              <TextField size="small" label={t.siliconNotes} value={notes} onChange={(e) => setNotes(e.target.value)} multiline minRows={2} />
              <Button variant="outlined" onClick={addPersona} disabled={busy}>{t.siliconAddPersona}</Button>
            </Stack>
            {personas.map((p) => (
              <Stack key={p.id} direction="row" spacing={1} alignItems="center" sx={{ mb: 1 }}>
                <Chip
                  label={p.name}
                  color={selectedIds.includes(p.id) ? 'primary' : 'default'}
                  onClick={() => togglePersona(p.id)}
                />
                <Button size="small" color="error" onClick={() => deleteSiliconPersona(p.id).then(refresh)}>
                  {t.siliconRemove}
                </Button>
              </Stack>
            ))}
          </CardContent>
        </Card>

        <Card variant="outlined" sx={{ flex: 1 }}>
          <CardContent>
            <Typography fontWeight={700} sx={{ mb: 1 }}>{t.siliconRun}</Typography>
            <FormControl size="small" fullWidth sx={{ mb: 2 }}>
              <InputLabel>{t.siliconOverrideModel}</InputLabel>
              <Select
                label={t.siliconOverrideModel}
                value={visionRoutes.some((route) => route.value === overrideRoute) ? overrideRoute : ''}
                onChange={(event) => {
                  const value = event.target.value;
                  setOverrideRoute(value);
                  const hit = visionRoutes.find((route) => route.value === value);
                  setOverrideEffort(hit?.defaultEffort || '');
                }}
              >
                <MenuItem value="" disabled>{t.modelsSelectVision}</MenuItem>
                {visionRoutes.map((route) => (
                  <MenuItem key={route.value} value={route.value}>{route.label}</MenuItem>
                ))}
              </Select>
            </FormControl>
            {visionRoutes.find((route) => route.value === overrideRoute)?.reasoningEfforts && (
              <FormControl size="small" fullWidth sx={{ mb: 2 }}>
                <InputLabel>{t.siliconEffort}</InputLabel>
                <Select
                  label={t.siliconEffort}
                  value={overrideEffort}
                  onChange={(event) => setOverrideEffort(event.target.value)}
                >
                  {Object.keys(visionRoutes.find((route) => route.value === overrideRoute).reasoningEfforts).map((effort) => (
                    <MenuItem key={effort} value={effort}>{effort}</MenuItem>
                  ))}
                </Select>
              </FormControl>
            )}
            <TextField
              size="small"
              type="number"
              label={t.siliconRepeats}
              value={repeats}
              onChange={(e) => setRepeats(e.target.value)}
              sx={{ mb: 2, width: 140 }}
            />
            <TextField
              size="small"
              type="number"
              label={t.siliconBudget}
              value={budgetTokens}
              inputProps={{ min: 512, max: 100000, step: 1000 }}
              onChange={(e) => setBudgetTokens(e.target.value)}
              sx={{ mb: 2, ml: { xs: 0, sm: 1 }, width: 160 }}
            />
            <Stack direction="row" spacing={1}>
              <Button variant="contained" onClick={startRun} disabled={busy || !overrideRoute}>{t.siliconStart}</Button>
            </Stack>
            {busy && <LinearProgress sx={{ mt: 2 }} />}
            <Typography variant="body2" color="text.secondary" sx={{ mt: 2 }}>
              {t.siliconNeedVlm}
            </Typography>
            <Typography variant="body2" color="text.secondary" sx={{ mt: 1 }}>
              {t.siliconDraftSnapshot}
            </Typography>
          </CardContent>
        </Card>
      </Stack>

      <Card variant="outlined" sx={{ mt: 2 }}>
        <CardContent>
          <Typography fontWeight={700} sx={{ mb: 1 }}>{t.siliconRuns}</Typography>
          {(runs || []).map((run) => (
            <Stack key={run.id} direction="row" spacing={1} alignItems="center" sx={{ mb: 1 }}>
              <Chip size="small" label={run.status} />
              <Typography variant="body2">
                {run.model || '—'} · {run.progress_done}/{run.progress_total}
              </Typography>
              {run.budget_tokens && (
                <Typography variant="caption" color="text.secondary">
                  {tf(t.siliconBudgetUsage, { used: run.tokens_used || 0, budget: run.budget_tokens })}
                </Typography>
              )}
              {['queued', 'running'].includes(run.status) && (
                <>
                  <Button size="small" onClick={() => resumeRun(run.id)} disabled={busy}>{t.siliconResume || 'Resume'}</Button>
                  <Button size="small" onClick={() => cancelSiliconRun(run.id).then(refresh)}>{t.siliconCancel}</Button>
                </>
              )}
              <Button size="small" onClick={() => getSiliconCompare(run.id).then((c) => c.success && setCompare(c))}>
                {t.siliconCompare}
              </Button>
              <Button size="small" onClick={() => downloadExport(run.id)}>{t.siliconExport}</Button>
            </Stack>
          ))}
          {compare && (
            <Box sx={{ mt: 2 }}>
              <Alert severity="warning" sx={{ mb: 1 }}>{compare.disclaimer}</Alert>
              <Typography variant="body2">{t.siliconCount}: {compare.responseCount}</Typography>
              {Object.entries(compare.byQuestion || {}).map(([q, rows]) => (
                <Typography key={q} variant="body2" sx={{ mt: 0.5 }}>
                  {q}: {rows.length} {t.siliconAnswers}
                </Typography>
              ))}
            </Box>
          )}
        </CardContent>
      </Card>
    </Box>
  );
}
