import React, { useCallback, useEffect, useMemo, useState } from 'react';
import {
  Accordion, AccordionDetails, AccordionSummary, Alert, Box, Button, Chip,
  CircularProgress, Dialog, DialogActions, DialogContent, DialogTitle,
  FormControlLabel, IconButton, LinearProgress, MenuItem, Paper, Stack,
  Switch, Tab, Tabs, Table, TableBody, TableCell, TableHead, TableRow,
  TextField, Typography, Tooltip,
} from '@mui/material';
import {
  ExpandMore, Refresh, Delete, PlayArrow, Check, Close, Visibility,
  CloudUpload,
} from '@mui/icons-material';
import {
  getBenchSettings, patchBenchSettings,
  listBenchProviders, putBenchProviderKey, deleteBenchProviderKey,
  listBenchModels, patchBenchModel, createBenchModel,
  listBenchDimensions, saveBenchDimensions,
  listBenchMethods, freezeBenchMethod,
  listBenchDatasets, createBenchDataset, importBenchItems, listBenchItems,
  freezeBenchDataset,
  listBenchRuns, createBenchRuns, processBenchRun, reviewBenchRun, getBenchRunResults,
} from '../../lib/spBenchApi';
import { uploadImageToR2 } from '../../lib/r2';

function fmtScore(v) {
  if (v == null || Number.isNaN(Number(v))) return '—';
  return Number(v).toFixed(3);
}

function statusColor(status) {
  switch (status) {
    case 'approved':
    case 'published':
    case 'frozen':
      return 'success';
    case 'needs_review':
    case 'queued':
    case 'running':
      return 'warning';
    case 'failed':
    case 'rejected':
    case 'cancelled':
      return 'error';
    default:
      return 'default';
  }
}

export default function SpBenchManagement() {
  const [tab, setTab] = useState(0);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [msg, setMsg] = useState('');
  const [settings, setSettings] = useState(null);
  const [queueReady, setQueueReady] = useState(false);
  const [inlineRunnerAllowed, setInlineRunnerAllowed] = useState(true);
  const [suggestedDimensions, setSuggestedDimensions] = useState([]);
  const [providers, setProviders] = useState([]);
  const [models, setModels] = useState([]);
  const [dimensions, setDimensions] = useState([]);
  const [dimPreview, setDimPreview] = useState(null);
  const [methods, setMethods] = useState([]);
  const [datasets, setDatasets] = useState([]);
  const [runs, setRuns] = useState([]);
  const [keyDrafts, setKeyDrafts] = useState({});
  const [savingKey, setSavingKey] = useState('');
  const [methodVersion, setMethodVersion] = useState('v1');
  const [datasetVersion, setDatasetVersion] = useState('v1');
  const [datasetTitle, setDatasetTitle] = useState('SP-Bench v1');
  const [selectedDatasetId, setSelectedDatasetId] = useState('');
  const [itemsJson, setItemsJson] = useState('[\n  {\n    "item_key": "sample_001",\n    "media_urls": ["https://example.com/a.jpg"],\n    "labels": { "safety": 5, "beauty": 4, "scene_type": "residential" }\n  }\n]');
  const [itemsPreview, setItemsPreview] = useState([]);
  const [reviewOpen, setReviewOpen] = useState(null);
  const [reviewDetail, setReviewDetail] = useState(null);
  const [newModel, setNewModel] = useState({
    provider_id: 'openai',
    model_id: '',
    display_name: '',
    enabled: false,
  });

  const loadAll = useCallback(async () => {
    setLoading(true);
    setError('');
    try {
      const [s, p, m, d, meth, ds, r] = await Promise.all([
        getBenchSettings(),
        listBenchProviders(),
        listBenchModels(),
        listBenchDimensions(),
        listBenchMethods(),
        listBenchDatasets(),
        listBenchRuns(),
      ]);
      setSettings(s.settings);
      setQueueReady(!!s.queueReady);
      setInlineRunnerAllowed(!!s.inlineRunnerAllowed);
      setSuggestedDimensions(s.suggestedDimensions || []);
      setProviders(p.providers || []);
      setModels(m.models || []);
      setDimensions(d.dimensions || []);
      setDimPreview(d.preview || null);
      setMethods(meth.methods || []);
      setDatasets(ds.datasets || []);
      setRuns(r.runs || []);
      if (!selectedDatasetId && ds.datasets?.[0]?.id) {
        setSelectedDatasetId(ds.datasets[0].id);
      }
    } catch (e) {
      setError(e.message || String(e));
    } finally {
      setLoading(false);
    }
  }, [selectedDatasetId]);

  useEffect(() => { loadAll(); }, [loadAll]);

  const modelById = useMemo(() => {
    const map = {};
    models.forEach((m) => { map[m.id] = m; });
    return map;
  }, [models]);

  async function togglePublic(enabled) {
    setMsg('');
    try {
      const res = await patchBenchSettings({ public_enabled: enabled });
      setSettings(res.settings);
      setMsg(enabled ? 'Public SP-Bench page enabled' : 'Public SP-Bench page disabled');
    } catch (e) {
      setError(e.message);
    }
  }

  async function saveProviderKey(providerId) {
    const apiKey = (keyDrafts[providerId] || '').trim();
    if (apiKey.length < 8) {
      setError('API key too short');
      return;
    }
    setSavingKey(providerId);
    setError('');
    try {
      await putBenchProviderKey(providerId, apiKey);
      setKeyDrafts((prev) => ({ ...prev, [providerId]: '' }));
      setMsg(`Saved key for ${providerId}`);
      await loadAll();
    } catch (e) {
      setError(e.message);
    } finally {
      setSavingKey('');
    }
  }

  async function removeProviderKey(providerId) {
    if (!window.confirm(`Remove API key for ${providerId}?`)) return;
    try {
      await deleteBenchProviderKey(providerId);
      setMsg(`Removed key for ${providerId}`);
      await loadAll();
    } catch (e) {
      setError(e.message);
    }
  }

  async function toggleModel(model, enabled) {
    try {
      await patchBenchModel({ id: model.id, enabled });
      await loadAll();
    } catch (e) {
      setError(e.message);
    }
  }

  async function addModel() {
    if (!newModel.model_id.trim()) {
      setError('model_id required');
      return;
    }
    try {
      await createBenchModel({
        ...newModel,
        display_name: newModel.display_name || newModel.model_id,
      });
      setNewModel({ provider_id: 'openai', model_id: '', display_name: '', enabled: false });
      setMsg('Model added');
      await loadAll();
    } catch (e) {
      setError(e.message);
    }
  }

  async function persistDimensions() {
    try {
      await saveBenchDimensions(dimensions);
      setMsg('Dimensions saved');
      await loadAll();
    } catch (e) {
      setError(e.message);
    }
  }

  function loadSuggestedDims() {
    setDimensions(suggestedDimensions.map((d, i) => ({
      ...d,
      enabled: true,
      sort_order: d.sort_order ?? (i + 1) * 10,
    })));
  }

  function updateDim(idx, patch) {
    setDimensions((prev) => prev.map((d, i) => (i === idx ? { ...d, ...patch } : d)));
  }

  async function doFreezeMethod() {
    try {
      await freezeBenchMethod({
        version: methodVersion,
        title: `SP-Bench ${methodVersion}`,
        notes: 'Frozen from admin panel',
      });
      setMsg(`Method ${methodVersion} frozen`);
      await loadAll();
    } catch (e) {
      setError(e.message);
    }
  }

  async function createDataset() {
    try {
      const res = await createBenchDataset({
        version: datasetVersion,
        title: datasetTitle,
        method_id: settings?.active_method_id || null,
      });
      setSelectedDatasetId(res.dataset.id);
      setMsg(`Dataset ${datasetVersion} created (draft)`);
      await loadAll();
    } catch (e) {
      setError(e.message);
    }
  }

  async function importItems() {
    if (!selectedDatasetId) {
      setError('Select a dataset first');
      return;
    }
    let items;
    try {
      items = JSON.parse(itemsJson);
    } catch {
      setError('Invalid JSON for items');
      return;
    }
    if (!Array.isArray(items)) {
      setError('Items must be a JSON array');
      return;
    }
    try {
      const res = await importBenchItems(selectedDatasetId, items);
      setMsg(`Imported ${res.imported} items (${res.skipped} skipped)`);
      await loadAll();
      const listed = await listBenchItems(selectedDatasetId);
      setItemsPreview(listed.items || []);
    } catch (e) {
      setError(e.message + (e.details?.errors ? `: ${JSON.stringify(e.details.errors.slice(0, 3))}` : ''));
    }
  }

  async function uploadImages(files) {
    if (!selectedDatasetId) {
      setError('Select a dataset first');
      return;
    }
    const ds = datasets.find((d) => d.id === selectedDatasetId);
    const prefix = ds?.r2_prefix || `bench/datasets/${ds?.version || 'draft'}/`;
    setMsg('Uploading…');
    const uploaded = [];
    for (const file of files) {
      const key = `${prefix}${file.name}`;
      const res = await uploadImageToR2(file, key);
      if (res.success) uploaded.push({ name: file.name, url: res.url, key: res.key });
      else setError(res.error || 'Upload failed');
    }
    setMsg(`Uploaded ${uploaded.length} file(s) to ${prefix}`);
  }

  async function doFreezeDataset() {
    if (!selectedDatasetId) return;
    try {
      await freezeBenchDataset(selectedDatasetId, settings?.active_method_id);
      setMsg('Dataset frozen');
      await loadAll();
    } catch (e) {
      setError(e.message);
    }
  }

  async function runUnevaluated() {
    try {
      const res = await createBenchRuns({ unevaluatedOnly: true });
      setMsg(res.message || `Created ${res.created?.length || 0} run(s)`);
      await loadAll();
    } catch (e) {
      setError(e.message);
    }
  }

  async function runOneModel(modelRowId) {
    try {
      const res = await createBenchRuns({ modelIds: [modelRowId] });
      setMsg(`Created ${res.created?.length || 0} run(s)`);
      await loadAll();
    } catch (e) {
      setError(e.message);
    }
  }

  async function kickProcess(runId) {
    try {
      const res = await processBenchRun(runId);
      setMsg(res.finished ? 'Run finished' : `Processed chunk (${res.done || '?'}/${res.total || '?'})`);
      await loadAll();
    } catch (e) {
      setError(e.message);
    }
  }

  async function openReview(run) {
    setReviewOpen(run);
    setReviewDetail(null);
    try {
      const detail = await getBenchRunResults(run.id);
      setReviewDetail(detail);
    } catch (e) {
      setError(e.message);
    }
  }

  async function doReview(action, publish = false) {
    if (!reviewOpen) return;
    try {
      await reviewBenchRun(reviewOpen.id, action, '', publish);
      setMsg(`${action} ok`);
      setReviewOpen(null);
      await loadAll();
    } catch (e) {
      setError(e.message);
    }
  }

  if (loading && !settings) {
    return (
      <Box sx={{ display: 'flex', justifyContent: 'center', py: 6 }}>
        <CircularProgress />
      </Box>
    );
  }

  return (
    <Box>
      <Stack direction="row" alignItems="center" justifyContent="space-between" sx={{ mb: 2 }}>
        <Box>
          <Typography variant="h5" fontWeight={700}>SP-Bench</Typography>
          <Typography variant="body2" color="text.secondary">
            Benchmarking Subjective–Objective Spatial Perception and Cognition in Urban Environments
          </Typography>
        </Box>
        <Button startIcon={<Refresh />} onClick={loadAll} disabled={loading}>Refresh</Button>
      </Stack>

      {error && <Alert severity="error" sx={{ mb: 2 }} onClose={() => setError('')}>{error}</Alert>}
      {msg && <Alert severity="success" sx={{ mb: 2 }} onClose={() => setMsg('')}>{msg}</Alert>}

      <Paper sx={{ p: 2, mb: 2 }}>
        <Stack direction={{ xs: 'column', sm: 'row' }} spacing={2} alignItems={{ sm: 'center' }} justifyContent="space-between">
          <FormControlLabel
            control={(
              <Switch
                checked={!!settings?.public_enabled}
                onChange={(e) => togglePublic(e.target.checked)}
              />
            )}
            label="Public SP-Bench page / homepage entry"
          />
          <Stack direction="row" spacing={1} alignItems="center">
            <Chip
              size="small"
              label={queueReady ? 'Queue ready' : 'Inline runner'}
              color={queueReady ? 'success' : 'warning'}
            />
            {!queueReady && (
              <Typography variant="caption" color="text.secondary">
                {inlineRunnerAllowed
                  ? 'No SP_BENCH_QUEUE binding — runs use waitUntil/async chunks'
                  : 'Queue required'}
              </Typography>
            )}
            <Chip size="small" label={`Method ${settings?.method_version || '—'}`} />
          </Stack>
        </Stack>
        <TextField
          fullWidth
          size="small"
          label="Landing blurb"
          sx={{ mt: 2 }}
          value={settings?.landing_blurb || ''}
          onChange={(e) => setSettings((s) => ({ ...s, landing_blurb: e.target.value }))}
          onBlur={async () => {
            try {
              const res = await patchBenchSettings({ landing_blurb: settings?.landing_blurb || '' });
              setSettings(res.settings);
            } catch (e) {
              setError(e.message);
            }
          }}
        />
      </Paper>

      <Tabs value={tab} onChange={(_, v) => setTab(v)} variant="scrollable" scrollButtons="auto" sx={{ mb: 2 }}>
        <Tab label="Providers" />
        <Tab label="Models" />
        <Tab label="Dimensions" />
        <Tab label="Dataset" />
        <Tab label="Runs" />
        <Tab label="Review" />
      </Tabs>

      {tab === 0 && (
        <Table size="small">
          <TableHead>
            <TableRow>
              <TableCell>Provider</TableCell>
              <TableCell>Adapter</TableCell>
              <TableCell>Key</TableCell>
              <TableCell>API Key</TableCell>
              <TableCell align="right">Actions</TableCell>
            </TableRow>
          </TableHead>
          <TableBody>
            {providers.map((p) => (
              <TableRow key={p.id}>
                <TableCell>{p.display_name}</TableCell>
                <TableCell><Chip size="small" label={p.adapter} /></TableCell>
                <TableCell>
                  {p.configured
                    ? <Chip size="small" color="success" label={p.key_hint || 'configured'} />
                    : <Chip size="small" label="not set" />}
                </TableCell>
                <TableCell>
                  <TextField
                    size="small"
                    type="password"
                    placeholder="sk-… (never shown again)"
                    value={keyDrafts[p.id] || ''}
                    onChange={(e) => setKeyDrafts((prev) => ({ ...prev, [p.id]: e.target.value }))}
                    fullWidth
                  />
                </TableCell>
                <TableCell align="right">
                  <Button
                    size="small"
                    variant="contained"
                    disabled={savingKey === p.id}
                    onClick={() => saveProviderKey(p.id)}
                  >
                    {savingKey === p.id ? '…' : 'Save'}
                  </Button>
                  {p.configured && (
                    <IconButton size="small" onClick={() => removeProviderKey(p.id)} sx={{ ml: 0.5 }}>
                      <Delete fontSize="small" />
                    </IconButton>
                  )}
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      )}

      {tab === 1 && (
        <Box>
          <Table size="small">
            <TableHead>
              <TableRow>
                <TableCell>Display</TableCell>
                <TableCell>Provider / Model ID</TableCell>
                <TableCell>Eval</TableCell>
                <TableCell align="right">Run</TableCell>
              </TableRow>
            </TableHead>
            <TableBody>
              {models.map((m) => (
                <TableRow key={m.id}>
                  <TableCell>{m.display_name}</TableCell>
                  <TableCell>
                    <Typography variant="body2">{m.provider_id}</Typography>
                    <Typography variant="caption" color="text.secondary">{m.model_id}</Typography>
                  </TableCell>
                  <TableCell>
                    <Switch checked={!!m.enabled} onChange={(e) => toggleModel(m, e.target.checked)} />
                  </TableCell>
                  <TableCell align="right">
                    <Button size="small" startIcon={<PlayArrow />} onClick={() => runOneModel(m.id)}>
                      Evaluate
                    </Button>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
          <Paper sx={{ p: 2, mt: 2 }}>
            <Typography variant="subtitle2" sx={{ mb: 1 }}>Add model</Typography>
            <Stack direction={{ xs: 'column', sm: 'row' }} spacing={1}>
              <TextField
                select
                size="small"
                label="Provider"
                value={newModel.provider_id}
                onChange={(e) => setNewModel((n) => ({ ...n, provider_id: e.target.value }))}
                sx={{ minWidth: 140 }}
              >
                {providers.map((p) => (
                  <MenuItem key={p.id} value={p.id}>{p.id}</MenuItem>
                ))}
              </TextField>
              <TextField
                size="small"
                label="API model ID"
                value={newModel.model_id}
                onChange={(e) => setNewModel((n) => ({ ...n, model_id: e.target.value }))}
              />
              <TextField
                size="small"
                label="Display name"
                value={newModel.display_name}
                onChange={(e) => setNewModel((n) => ({ ...n, display_name: e.target.value }))}
              />
              <Button variant="outlined" onClick={addModel}>Add</Button>
            </Stack>
          </Paper>
        </Box>
      )}

      {tab === 2 && (
        <Box>
          <Stack direction="row" spacing={1} sx={{ mb: 2 }}>
            <Button onClick={loadSuggestedDims}>Load suggested template</Button>
            <Button variant="contained" onClick={persistDimensions}>Save dimensions</Button>
            <TextField
              size="small"
              label="Freeze version"
              value={methodVersion}
              onChange={(e) => setMethodVersion(e.target.value)}
              sx={{ width: 140 }}
            />
            <Button variant="outlined" onClick={doFreezeMethod}>Freeze method</Button>
          </Stack>
          <Table size="small">
            <TableHead>
              <TableRow>
                <TableCell>Key</TableCell>
                <TableCell>EN / ZH</TableCell>
                <TableCell>Group</TableCell>
                <TableCell>Type</TableCell>
                <TableCell>Weight</TableCell>
                <TableCell>On</TableCell>
              </TableRow>
            </TableHead>
            <TableBody>
              {dimensions.map((d, idx) => (
                <TableRow key={d.key || idx}>
                  <TableCell>
                    <TextField
                      size="small"
                      value={d.key || ''}
                      onChange={(e) => updateDim(idx, { key: e.target.value })}
                    />
                  </TableCell>
                  <TableCell>
                    <TextField
                      size="small"
                      value={d.name_en || ''}
                      onChange={(e) => updateDim(idx, { name_en: e.target.value })}
                      sx={{ mb: 0.5, display: 'block' }}
                    />
                    <TextField
                      size="small"
                      value={d.name_zh || ''}
                      onChange={(e) => updateDim(idx, { name_zh: e.target.value })}
                    />
                  </TableCell>
                  <TableCell>
                    <TextField
                      select
                      size="small"
                      value={d.group_key || 'subjective'}
                      onChange={(e) => updateDim(idx, { group_key: e.target.value })}
                    >
                      <MenuItem value="objective">objective</MenuItem>
                      <MenuItem value="subjective">subjective</MenuItem>
                      <MenuItem value="cognition">cognition</MenuItem>
                    </TextField>
                  </TableCell>
                  <TableCell>
                    <TextField
                      select
                      size="small"
                      value={d.label_type || 'continuous'}
                      onChange={(e) => updateDim(idx, { label_type: e.target.value })}
                    >
                      <MenuItem value="category">category</MenuItem>
                      <MenuItem value="continuous">continuous</MenuItem>
                      <MenuItem value="multi_label">multi_label</MenuItem>
                      <MenuItem value="pairwise">pairwise</MenuItem>
                    </TextField>
                  </TableCell>
                  <TableCell>
                    <TextField
                      size="small"
                      type="number"
                      value={d.weight ?? 1}
                      onChange={(e) => updateDim(idx, { weight: Number(e.target.value) })}
                      sx={{ width: 80 }}
                    />
                  </TableCell>
                  <TableCell>
                    <Switch
                      checked={d.enabled !== false}
                      onChange={(e) => updateDim(idx, { enabled: e.target.checked })}
                    />
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
          {dimPreview && (
            <Accordion sx={{ mt: 2 }}>
              <AccordionSummary expandIcon={<ExpandMore />}>
                <Typography>Prompt / JSON schema preview</Typography>
              </AccordionSummary>
              <AccordionDetails>
                <Typography component="pre" sx={{ whiteSpace: 'pre-wrap', fontSize: 12 }}>
                  {dimPreview.prompt_template}
                </Typography>
                <Typography component="pre" sx={{ whiteSpace: 'pre-wrap', fontSize: 11, mt: 2 }}>
                  {JSON.stringify(dimPreview.json_schema, null, 2)}
                </Typography>
              </AccordionDetails>
            </Accordion>
          )}
          <Typography variant="subtitle2" sx={{ mt: 2 }}>Frozen methods</Typography>
          {methods.map((m) => (
            <Chip
              key={m.id}
              sx={{ mr: 1, mt: 1 }}
              color={m.id === settings?.active_method_id ? 'primary' : 'default'}
              label={`${m.version} (${m.status})`}
            />
          ))}
        </Box>
      )}

      {tab === 3 && (
        <Box>
          <Stack direction={{ xs: 'column', sm: 'row' }} spacing={1} sx={{ mb: 2 }}>
            <TextField size="small" label="Version" value={datasetVersion} onChange={(e) => setDatasetVersion(e.target.value)} />
            <TextField size="small" label="Title" value={datasetTitle} onChange={(e) => setDatasetTitle(e.target.value)} />
            <Button variant="contained" onClick={createDataset}>Create draft dataset</Button>
          </Stack>
          <TextField
            select
            fullWidth
            size="small"
            label="Active dataset"
            value={selectedDatasetId}
            onChange={async (e) => {
              setSelectedDatasetId(e.target.value);
              try {
                const listed = await listBenchItems(e.target.value);
                setItemsPreview(listed.items || []);
              } catch {
                setItemsPreview([]);
              }
            }}
            sx={{ mb: 2 }}
          >
            {datasets.map((d) => (
              <MenuItem key={d.id} value={d.id}>
                {d.version} — {d.title} [{d.status}] ({d.item_count || 0} items)
              </MenuItem>
            ))}
          </TextField>
          <Stack direction="row" spacing={1} sx={{ mb: 2 }}>
            <Button
              component="label"
              variant="outlined"
              startIcon={<CloudUpload />}
            >
              Upload images to R2
              <input
                hidden
                type="file"
                accept="image/*"
                multiple
                onChange={(e) => uploadImages([...e.target.files])}
              />
            </Button>
            <Button variant="outlined" onClick={importItems}>Import labels JSON</Button>
            <Button variant="contained" color="warning" onClick={doFreezeDataset}>Freeze dataset</Button>
          </Stack>
          <TextField
            fullWidth
            multiline
            minRows={8}
            label="Items JSON"
            value={itemsJson}
            onChange={(e) => setItemsJson(e.target.value)}
            sx={{ mb: 2, fontFamily: 'monospace' }}
          />
          {itemsPreview.length > 0 && (
            <Typography variant="body2" color="text.secondary">
              Preview: {itemsPreview.length} items — first keys:{' '}
              {itemsPreview.slice(0, 5).map((i) => i.item_key).join(', ')}
            </Typography>
          )}
        </Box>
      )}

      {tab === 4 && (
        <Box>
          <Stack direction="row" spacing={1} sx={{ mb: 2 }}>
            <Button variant="contained" startIcon={<PlayArrow />} onClick={runUnevaluated}>
              Run all unevaluated models
            </Button>
          </Stack>
          <Table size="small">
            <TableHead>
              <TableRow>
                <TableCell>Model</TableCell>
                <TableCell>Status</TableCell>
                <TableCell>Progress</TableCell>
                <TableCell>Published</TableCell>
                <TableCell align="right">Actions</TableCell>
              </TableRow>
            </TableHead>
            <TableBody>
              {runs.map((r) => {
                const model = modelById[r.model_row_id];
                const pct = r.progress_total
                  ? Math.round((100 * (r.progress_done || 0)) / r.progress_total)
                  : 0;
                return (
                  <TableRow key={r.id}>
                    <TableCell>{model?.display_name || r.model_row_id}</TableCell>
                    <TableCell>
                      <Chip size="small" color={statusColor(r.status)} label={r.status} />
                    </TableCell>
                    <TableCell sx={{ minWidth: 140 }}>
                      <LinearProgress variant="determinate" value={pct} sx={{ mb: 0.5 }} />
                      <Typography variant="caption">{r.progress_done || 0}/{r.progress_total || 0}</Typography>
                    </TableCell>
                    <TableCell>{r.published ? 'yes' : 'no'}</TableCell>
                    <TableCell align="right">
                      {['queued', 'running'].includes(r.status) && (
                        <Button size="small" onClick={() => kickProcess(r.id)}>Process</Button>
                      )}
                      <Tooltip title="Review">
                        <IconButton size="small" onClick={() => openReview(r)}>
                          <Visibility fontSize="small" />
                        </IconButton>
                      </Tooltip>
                    </TableCell>
                  </TableRow>
                );
              })}
            </TableBody>
          </Table>
        </Box>
      )}

      {tab === 5 && (
        <Box>
          <Typography variant="body2" color="text.secondary" sx={{ mb: 2 }}>
            Approve runs after checking completeness, then publish to include them on the public leaderboard.
            Disabling a model removes it from the public board immediately.
          </Typography>
          <Table size="small">
            <TableHead>
              <TableRow>
                <TableCell>Model</TableCell>
                <TableCell>Status</TableCell>
                <TableCell>Overall</TableCell>
                <TableCell align="right">Actions</TableCell>
              </TableRow>
            </TableHead>
            <TableBody>
              {runs.filter((r) => ['needs_review', 'approved', 'rejected'].includes(r.status)).map((r) => {
                const model = modelById[r.model_row_id];
                return (
                  <TableRow key={r.id}>
                    <TableCell>{model?.display_name || r.model_row_id}</TableCell>
                    <TableCell>
                      <Chip size="small" color={statusColor(r.status)} label={r.status} />
                      {r.published && <Chip size="small" color="success" label="published" sx={{ ml: 0.5 }} />}
                    </TableCell>
                    <TableCell>—</TableCell>
                    <TableCell align="right">
                      <Button size="small" startIcon={<Visibility />} onClick={() => openReview(r)}>Open</Button>
                    </TableCell>
                  </TableRow>
                );
              })}
            </TableBody>
          </Table>
        </Box>
      )}

      <Dialog open={!!reviewOpen} onClose={() => setReviewOpen(null)} maxWidth="md" fullWidth>
        <DialogTitle>
          Review — {modelById[reviewOpen?.model_row_id]?.display_name || reviewOpen?.id}
        </DialogTitle>
        <DialogContent>
          {reviewDetail ? (
            <Box>
              <Typography variant="subtitle2">Overall: {fmtScore(reviewDetail.result?.overall_score)}</Typography>
              <Typography component="pre" sx={{ fontSize: 12, whiteSpace: 'pre-wrap', mt: 1 }}>
                {JSON.stringify(reviewDetail.result?.group_scores || {}, null, 2)}
              </Typography>
              <Typography variant="subtitle2" sx={{ mt: 2 }}>
                Predictions sample ({reviewDetail.predictions?.length || 0})
              </Typography>
              <Typography component="pre" sx={{ fontSize: 11, whiteSpace: 'pre-wrap' }}>
                {JSON.stringify((reviewDetail.predictions || []).slice(0, 10), null, 2)}
              </Typography>
            </Box>
          ) : (
            <CircularProgress size={24} />
          )}
        </DialogContent>
        <DialogActions>
          <Button startIcon={<Close />} color="error" onClick={() => doReview('reject')}>Reject</Button>
          <Button startIcon={<Check />} onClick={() => doReview('approve', false)}>Approve</Button>
          <Button startIcon={<Check />} variant="contained" onClick={() => doReview('publish', true)}>
            Approve & publish
          </Button>
          {reviewOpen?.published && (
            <Button onClick={() => doReview('unpublish')}>Unpublish</Button>
          )}
        </DialogActions>
      </Dialog>
    </Box>
  );
}
