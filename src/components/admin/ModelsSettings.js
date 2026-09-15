import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  Alert,
  Box,
  Button,
  Checkbox,
  Chip,
  Collapse,
  Dialog,
  DialogActions,
  DialogContent,
  DialogTitle,
  FormControl,
  FormControlLabel,
  IconButton,
  InputLabel,
  Link,
  MenuItem,
  Select,
  Stack,
  TextField,
  Typography,
} from '@mui/material';
import AddIcon from '@mui/icons-material/Add';
import CheckCircleIcon from '@mui/icons-material/CheckCircle';
import DeleteOutlineIcon from '@mui/icons-material/DeleteOutline';
import ExpandMoreIcon from '@mui/icons-material/ExpandMore';
import {
  deleteProviderCredential,
  fetchProviderModels,
  getCredentialStatus,
  saveAiSettings,
  storeProviderCredential,
} from '../../lib/agentApi';
import { useRegion } from '../../contexts/RegionContext';
import { tf } from '../../contexts/adminI18n';

const PROVIDER_ID_RE = /^[a-z][a-z0-9_-]{0,47}$/;
const PROTOCOLS = ['openai-completions', 'openai-responses', 'anthropic-messages'];
const EFFORTS = ['off', 'low', 'medium', 'high', 'max'];

function emptyModel() {
  return {
    id: '',
    name: '',
    label: '',
    contextWindow: 128000,
    maxTokens: 8192,
    input: ['text'],
    vision: false,
    reasoningEfforts: false,
    defaultEffort: '',
  };
}

function emptyCustom() {
  return {
    provider: '',
    displayName: '',
    baseUrl: '',
    protocol: 'openai-completions',
    apiKey: '',
    models: [emptyModel()],
  };
}

function discoveryError(t, result) {
  const code = result?.code;
  if (code === 'MISSING_CREDENTIAL') return t.modelsDiscovery401;
  if (code === 'DISCOVERY_UNSUPPORTED') return t.modelsDiscoveryUnsupported;
  if (code === 'RESPONSE_TOO_LARGE') return t.modelsDiscoveryTooLarge;
  if (code === 'MALFORMED_JSON') return t.modelsDiscoveryMalformed;
  return result?.error || t.modelsDiscoveryNetwork;
}

function statusChip(t, provider) {
  if (provider.authUnsupported) {
    return { color: 'warning', label: t.modelsAuthUnsupported };
  }
  if (provider.configured) {
    return { color: 'success', label: t.modelsCredentialConfigured, icon: <CheckCircleIcon /> };
  }
  return { color: 'default', label: t.modelsCredentialMissing };
}

function routeOptions(directory, { visionOnly = false, configuredOnly = true } = {}) {
  const options = [];
  (directory || []).forEach((provider) => {
    if (configuredOnly && !provider.configured) return;
    if (provider.authUnsupported) return;
    (provider.models || []).forEach((model) => {
      if (!model.id) return;
      const vision = !!(model.vision || (model.input || []).includes('image'));
      if (visionOnly && !vision) return;
      options.push({
        value: `${provider.id}::${model.id}`,
        provider: provider.id,
        model: model.id,
        label: `${provider.displayName} / ${model.label || model.name || model.id}`,
        vision,
        reasoningEfforts: model.reasoningEfforts || false,
        defaultEffort: model.defaultEffort || '',
      });
    });
  });
  return options;
}

function groupDirectory(directory) {
  const groups = {
    recommended: [],
    configured: [],
    catalog: [],
    unsupported: [],
    custom: [],
  };
  (directory || []).forEach((provider) => {
    if (provider.authUnsupported) groups.unsupported.push(provider);
    else if (provider.custom || provider.group === 'custom') groups.custom.push(provider);
    else if (provider.recommended) groups.recommended.push(provider);
    else if (provider.configured) groups.configured.push(provider);
    else groups.catalog.push(provider);
  });
  return groups;
}

function ProviderEditor({ t, provider, requiredKey, onClose, onSaved }) {
  const [apiKey, setApiKey] = useState('');
  const [baseUrl, setBaseUrl] = useState(provider.baseUrl || provider.defaultBaseUrl || '');
  const [displayName, setDisplayName] = useState(provider.displayName || '');
  const [protocol, setProtocol] = useState(provider.protocol || 'openai-completions');
  const [models, setModels] = useState(provider.models?.length ? provider.models.map((model) => ({
    ...emptyModel(),
    ...model,
    name: model.name || model.label || model.id,
    input: model.input || (model.vision ? ['text', 'image'] : ['text']),
  })) : [emptyModel()]);
  const [customized, setCustomized] = useState(!provider.catalog);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [fetchOpen, setFetchOpen] = useState(false);
  const [fetched, setFetched] = useState([]);
  const [picked, setPicked] = useState([]);
  const [retryMax, setRetryMax] = useState(provider.retryPolicy?.maxRetries ?? 5);

  const updateModel = (index, patch) => {
    const next = [...models];
    next[index] = { ...next[index], ...patch };
    setModels(next);
  };

  const payloadModels = () => models.filter((model) => String(model.id || '').trim()).map((model) => ({
    id: String(model.id).trim(),
    name: (model.name || model.label || model.id).trim(),
    label: (model.label || model.name || model.id).trim(),
    contextWindow: Number(model.contextWindow || 128000),
    maxTokens: Number(model.maxTokens || 8192),
    input: model.input?.includes('image') || model.vision ? ['text', 'image'] : ['text'],
    vision: !!(model.vision || model.input?.includes('image')),
    reasoningEfforts: model.reasoningEfforts || false,
    defaultEffort: model.defaultEffort || null,
    compat: model.compat || {},
  }));

  const apply = async () => {
    setBusy(true);
    setError('');
    try {
      if (requiredKey && !apiKey.trim()) {
        setError(t.modelsKeyRequired);
        return;
      }
      if (!provider.catalog) {
        if (!baseUrl.trim()) {
          setError(t.modelsCustomNeedsBaseUrl);
          return;
        }
        if (!payloadModels().length) {
          setError(t.modelsCustomNeedsModels);
          return;
        }
      }
      const stored = await storeProviderCredential({
        apiKey: apiKey.trim() || undefined,
        provider: provider.id,
        baseUrl: baseUrl.trim() || undefined,
        displayName: displayName.trim() || undefined,
        protocol,
        models: payloadModels(),
        retryPolicy: { maxRetries: Number(retryMax) || 5 },
        custom: !provider.catalog,
      });
      if (!stored.success) {
        setError(stored.error || t.modelsLoadFailed);
        return;
      }
      setApiKey('');
      onSaved();
      onClose(true);
    } finally {
      setBusy(false);
    }
  };

  const fetchModels = async () => {
    if (!baseUrl.trim() && !provider.catalog) {
      setError(t.modelsFetchNeedsBaseUrl);
      return;
    }
    setBusy(true);
    setError('');
    try {
      const result = await fetchProviderModels({
        provider: provider.id,
        baseUrl: baseUrl.trim() || undefined,
        apiKey: apiKey.trim() || undefined,
        protocol,
      });
      if (!result.success) {
        setError(discoveryError(t, result));
        return;
      }
      const list = result.models || [];
      if (!list.length) {
        setError(t.modelsFetchEmpty);
        return;
      }
      setFetched(list);
      setPicked(list.map((model) => model.id));
      setFetchOpen(true);
    } finally {
      setBusy(false);
    }
  };

  const adoptFetched = () => {
    const selected = fetched.filter((model) => picked.includes(model.id)).map((model) => ({
      ...emptyModel(),
      ...model,
      name: model.name || model.label || model.id,
    }));
    setModels(selected.length ? selected : models);
    setFetchOpen(false);
  };

  return (
    <Box sx={{ p: 2, border: '1px solid', borderColor: 'divider', borderRadius: 1, bgcolor: 'grey.50' }}>
      <Typography fontWeight={700} sx={{ mb: 0.25 }}>{provider.displayName}</Typography>
      <Typography variant="caption" color="text.secondary" sx={{ display: 'block', mb: 1.5 }}>
        {provider.id} · {provider.protocol || 'openai-completions'}
      </Typography>
      <TextField
        fullWidth
        type="password"
        size="small"
        label={t.modelsKeyInput}
        value={apiKey}
        onChange={(event) => setApiKey(event.target.value)}
        placeholder={provider.configured ? t.modelsKeyStored : t.modelsKeyPlaceholder}
        autoFocus
        sx={{ mb: 1.5 }}
      />
      <Button size="small" onClick={() => setCustomized((cur) => !cur)} endIcon={<ExpandMoreIcon />}>
        {t.modelsCustomized}
      </Button>
      <Collapse in={customized}>
        <Stack spacing={1.5} sx={{ mt: 1.5 }}>
          <TextField
            size="small"
            label={t.modelsCustomDisplayName}
            value={displayName}
            onChange={(event) => setDisplayName(event.target.value)}
          />
          <FormControl size="small">
            <InputLabel>{t.modelsCustomApi}</InputLabel>
            <Select
              label={t.modelsCustomApi}
              value={protocol}
              onChange={(event) => setProtocol(event.target.value)}
            >
              {PROTOCOLS.map((id) => (
                <MenuItem key={id} value={id}>{id}</MenuItem>
              ))}
            </Select>
          </FormControl>
          <TextField
            size="small"
            label={t.modelsBaseUrl}
            value={baseUrl}
            onChange={(event) => setBaseUrl(event.target.value)}
            placeholder={provider.catalog ? t.modelsBaseUrlDefault : t.modelsCustomBaseUrlPlaceholder}
          />
          <TextField
            size="small"
            type="number"
            label={t.modelsRetry}
            value={retryMax}
            onChange={(event) => setRetryMax(event.target.value)}
          />
          <Stack direction="row" spacing={1} alignItems="center">
            <Typography variant="subtitle2">{t.modelsModels}</Typography>
            <Button size="small" onClick={fetchModels} disabled={busy}>
              {busy ? t.modelsFetching : t.modelsFetchModels}
            </Button>
          </Stack>
          {models.map((model, index) => (
            <Box key={`${model.id}-${index}`} sx={{ p: 1.25, border: '1px dashed', borderColor: 'divider', borderRadius: 1 }}>
              <Stack direction={{ xs: 'column', sm: 'row' }} spacing={1} sx={{ mb: 1 }}>
                <TextField
                  size="small"
                  label={t.modelsModelId}
                  value={model.id}
                  onChange={(event) => updateModel(index, { id: event.target.value })}
                  sx={{ flex: 1 }}
                />
                <TextField
                  size="small"
                  label={t.modelsModelName}
                  value={model.name || model.label || ''}
                  placeholder={t.modelsModelNamePlaceholder}
                  onChange={(event) => updateModel(index, { name: event.target.value, label: event.target.value })}
                  sx={{ flex: 1 }}
                />
                <Button color="error" onClick={() => setModels(models.filter((_, i) => i !== index))}>
                  {t.modelsRemoveModel}
                </Button>
              </Stack>
              <Stack direction={{ xs: 'column', sm: 'row' }} spacing={1} sx={{ mb: 1 }}>
                <TextField
                  size="small"
                  type="number"
                  label={t.modelsContextWindow}
                  value={model.contextWindow || ''}
                  onChange={(event) => updateModel(index, { contextWindow: event.target.value })}
                />
                <TextField
                  size="small"
                  type="number"
                  label={t.modelsMaxOutput}
                  value={model.maxTokens || ''}
                  onChange={(event) => updateModel(index, { maxTokens: event.target.value })}
                />
                <FormControl size="small" sx={{ minWidth: 140 }}>
                  <InputLabel>{t.modelsDefaultEffort}</InputLabel>
                  <Select
                    label={t.modelsDefaultEffort}
                    value={model.defaultEffort || ''}
                    onChange={(event) => updateModel(index, { defaultEffort: event.target.value })}
                  >
                    <MenuItem value="">{t.modelsReasoningOff}</MenuItem>
                    {EFFORTS.map((effort) => (
                      <MenuItem key={effort} value={effort}>{effort}</MenuItem>
                    ))}
                  </Select>
                </FormControl>
              </Stack>
              <Stack direction="row" spacing={2}>
                <FormControlLabel
                  control={(
                    <Checkbox
                      checked={(model.input || []).includes('text') || true}
                      disabled
                    />
                  )}
                  label={t.modelsInputText}
                />
                <FormControlLabel
                  control={(
                    <Checkbox
                      checked={!!(model.vision || (model.input || []).includes('image'))}
                      onChange={(event) => updateModel(index, {
                        vision: event.target.checked,
                        input: event.target.checked ? ['text', 'image'] : ['text'],
                      })}
                    />
                  )}
                  label={t.modelsInputImage}
                />
                <FormControlLabel
                  control={(
                    <Checkbox
                      checked={Boolean(model.reasoningEfforts)}
                      onChange={(event) => updateModel(index, {
                        reasoningEfforts: event.target.checked
                          ? { off: 'off', low: 'low', high: 'high', max: 'max' }
                          : false,
                      })}
                    />
                  )}
                  label={t.modelsReasoning}
                />
              </Stack>
            </Box>
          ))}
          <Button size="small" startIcon={<AddIcon />} onClick={() => setModels([...models, emptyModel()])}>
            {t.modelsAddModel}
          </Button>
        </Stack>
      </Collapse>
      {error && <Alert severity="error" sx={{ mt: 1.5 }}>{error}</Alert>}
      <Stack direction="row" spacing={1} justifyContent="flex-end" sx={{ mt: 2 }}>
        <Button onClick={() => onClose(false)} disabled={busy}>{t.modelsCancel}</Button>
        <Button variant="contained" onClick={apply} disabled={busy}>
          {busy ? t.modelsApplying : t.modelsApply}
        </Button>
      </Stack>

      <Dialog open={fetchOpen} onClose={() => setFetchOpen(false)} maxWidth="sm" fullWidth>
        <DialogTitle>{t.modelsFetchTitle}</DialogTitle>
        <DialogContent>
          <Typography variant="body2" color="text.secondary" sx={{ mb: 1.5 }}>
            {t.modelsFetchDescription}
          </Typography>
          <Stack direction="row" spacing={1} sx={{ mb: 1 }}>
            <Button size="small" onClick={() => setPicked(fetched.map((model) => model.id))}>{t.modelsFetchSelectAll}</Button>
            <Button size="small" onClick={() => setPicked([])}>{t.modelsFetchDeselectAll}</Button>
          </Stack>
          {fetched.map((model) => (
            <Stack key={model.id} direction="row" alignItems="center">
              <Checkbox
                checked={picked.includes(model.id)}
                onChange={(event) => {
                  setPicked((cur) => (event.target.checked ? [...cur, model.id] : cur.filter((id) => id !== model.id)));
                }}
              />
              <Typography variant="body2">{model.label || model.name || model.id}</Typography>
            </Stack>
          ))}
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setFetchOpen(false)}>{t.modelsCancel}</Button>
          <Button variant="contained" onClick={adoptFetched}>{t.modelsFetchAdopt}</Button>
        </DialogActions>
      </Dialog>
    </Box>
  );
}

export default function ModelsSettings({ onConfiguredChange }) {
  const { t } = useRegion();
  const [directory, setDirectory] = useState([]);
  const [settings, setSettings] = useState({});
  const [editing, setEditing] = useState(null);
  const [addOpen, setAddOpen] = useState(false);
  const [addProvider, setAddProvider] = useState('');
  const [customOpen, setCustomOpen] = useState(false);
  const [custom, setCustom] = useState(emptyCustom());
  const [message, setMessage] = useState(null);
  const [busy, setBusy] = useState(false);
  const [addedIds, setAddedIds] = useState([]);

  const onConfiguredChangeRef = useRef(onConfiguredChange);
  onConfiguredChangeRef.current = onConfiguredChange;

  const refresh = useCallback(async () => {
    const status = await getCredentialStatus();
    if (status.success !== false) {
      setDirectory(status.directory || []);
      setSettings(status.settings || {});
      onConfiguredChangeRef.current?.(status);
    } else {
      setMessage({ severity: 'error', text: status.error || t.modelsLoadFailed });
    }
  }, [t.modelsLoadFailed]);

  useEffect(() => { refresh(); }, [refresh]);

  const visible = useMemo(() => {
    const configured = new Set((directory || []).filter((item) => item.configured || item.custom).map((item) => item.id));
    return (directory || []).filter((item) => (
      item.recommended
      || item.configured
      || item.custom
      || item.authUnsupported
      || addedIds.includes(item.id)
      || configured.has(item.id)
    ));
  }, [directory, addedIds]);
  const unusedCatalog = (directory || []).filter((item) => (
    item.catalog && !item.authUnsupported && !visible.some((shown) => shown.id === item.id)
  ));
  const groups = groupDirectory(visible);
  const configuredRoutes = routeOptions(directory, { configuredOnly: true });
  const visionRoutes = routeOptions(directory, { configuredOnly: true, visionOnly: true });
  const assistantValue = settings.assistant_provider && settings.assistant_model
    ? `${settings.assistant_provider}::${settings.assistant_model}`
    : '';
  const siliconValue = settings.silicon_provider && settings.silicon_model
    ? `${settings.silicon_provider}::${settings.silicon_model}`
    : '';

  const persistRoute = async (kind, value) => {
    const hit = (kind === 'silicon' ? visionRoutes : configuredRoutes).find((route) => route.value === value);
    if (!hit) return;
    const patch = kind === 'assistant'
      ? {
        default_provider: hit.provider,
        assistant_provider: hit.provider,
        assistant_model: hit.model,
        assistant_reasoning_effort: hit.defaultEffort || null,
        expectedRevision: settings.settings_revision,
      }
      : {
        silicon_provider: hit.provider,
        silicon_model: hit.model,
        silicon_reasoning_effort: hit.defaultEffort || null,
        expectedRevision: settings.settings_revision,
      };
    const saved = await saveAiSettings(patch);
    if (saved.code === 'SETTINGS_CONFLICT') {
      setMessage({ severity: 'error', text: t.modelsSettingsConflict });
      refresh();
      return;
    }
    if (saved.success !== false) refresh();
    else setMessage({ severity: 'error', text: saved.error || t.modelsLoadFailed });
  };

  const addCatalogProvider = () => {
    if (!addProvider) return;
    setAddedIds((cur) => (cur.includes(addProvider) ? cur : [...cur, addProvider]));
    setAddOpen(false);
    setEditing(addProvider);
  };

  const createCustom = async () => {
    if (!PROVIDER_ID_RE.test(custom.provider)) {
      setMessage({ severity: 'error', text: t.modelsCustomRouteInvalid });
      return;
    }
    if ((directory || []).some((item) => item.id === custom.provider)) {
      setMessage({ severity: 'error', text: t.modelsCustomRouteTaken });
      return;
    }
    if (!custom.baseUrl.trim()) {
      setMessage({ severity: 'error', text: t.modelsCustomNeedsBaseUrl });
      return;
    }
    const models = custom.models.filter((model) => model.id.trim());
    if (!models.length) {
      setMessage({ severity: 'error', text: t.modelsCustomNeedsModels });
      return;
    }
    if (!custom.apiKey.trim()) {
      setMessage({ severity: 'error', text: t.modelsKeyRequired });
      return;
    }
    setBusy(true);
    try {
      const storedResult = await storeProviderCredential({
        apiKey: custom.apiKey.trim(),
        provider: custom.provider,
        baseUrl: custom.baseUrl.trim(),
        displayName: custom.displayName.trim() || custom.provider,
        protocol: custom.protocol,
        models,
        custom: true,
      });
      if (!storedResult.success) {
        setMessage({ severity: 'error', text: storedResult.error || t.modelsLoadFailed });
        return;
      }
      setCustomOpen(false);
      setCustom(emptyCustom());
      setMessage({ severity: 'success', text: tf(t.modelsSavedProvider, { provider: custom.displayName || custom.provider }) });
      await refresh();
    } finally {
      setBusy(false);
    }
  };

  const removeProvider = async (id) => {
    if (!window.confirm(tf(t.modelsDeleteDescriptionWithCredential, { provider: id }))) return;
    setBusy(true);
    try {
      await deleteProviderCredential(id);
      setAddedIds((cur) => cur.filter((item) => item !== id));
      if (editing === id) setEditing(null);
      await refresh();
    } finally {
      setBusy(false);
    }
  };

  const renderGroup = (title, items) => {
    if (!items.length) return null;
    return (
      <Box sx={{ mb: 2 }}>
        <Typography variant="overline" color="text.secondary">{title}</Typography>
        <Stack spacing={1.25} sx={{ mt: 0.5 }}>
          {items.map((provider) => {
            const chip = statusChip(t, provider);
            return (
              <Box
                key={provider.id}
                sx={{ border: '1px solid', borderColor: provider.recommended ? 'primary.main' : 'divider', borderRadius: 1, p: 1.5 }}
              >
                <Stack direction={{ xs: 'column', sm: 'row' }} spacing={1} alignItems={{ sm: 'center' }} justifyContent="space-between">
                  <Box>
                    <Stack direction="row" spacing={1} alignItems="center" flexWrap="wrap">
                      <Typography fontWeight={700}>{provider.displayName}</Typography>
                      {provider.recommended && <Chip size="small" color="primary" label={t.integRecommended} />}
                      {provider.custom && <Chip size="small" label={t.modelsCustomTag} />}
                    </Stack>
                    <Typography variant="caption" color="text.secondary">{provider.id}</Typography>
                    {provider.authUnsupported && (
                      <Typography variant="body2" color="warning.main" sx={{ mt: 0.5 }}>
                        {provider.authHint || t.modelsAuthUnsupported}
                      </Typography>
                    )}
                  </Box>
                  <Stack direction="row" spacing={1} alignItems="center">
                    <Chip size="small" icon={chip.icon} color={chip.color} label={chip.label} />
                    {!provider.authUnsupported && (
                      <Button size="small" onClick={() => setEditing(editing === provider.id ? null : provider.id)}>
                        {t.modelsEdit}
                      </Button>
                    )}
                    {provider.id !== 'deepseek' && !provider.authUnsupported && (
                      <IconButton size="small" color="error" onClick={() => removeProvider(provider.id)} disabled={busy}>
                        <DeleteOutlineIcon fontSize="small" />
                      </IconButton>
                    )}
                  </Stack>
                </Stack>
                {editing === provider.id && !provider.authUnsupported && (
                  <Box sx={{ mt: 1.5 }}>
                    <ProviderEditor
                      t={t}
                      provider={provider}
                      requiredKey={!provider.configured}
                      onClose={(changed) => {
                        setEditing(null);
                        if (changed) {
                          setMessage({ severity: 'success', text: tf(t.modelsSavedProvider, { provider: provider.displayName }) });
                        }
                      }}
                      onSaved={refresh}
                    />
                  </Box>
                )}
              </Box>
            );
          })}
        </Stack>
      </Box>
    );
  };

  return (
    <Box>
      <Typography variant="h6" sx={{ mb: 0.5 }}>{t.modelsTitle}</Typography>
      <Typography color="text.secondary" sx={{ mb: 2 }}>{t.modelsIntro}</Typography>

      {message && (
        <Alert severity={message.severity} onClose={() => setMessage(null)} sx={{ mb: 2 }}>
          {message.text}
        </Alert>
      )}

      <Stack direction={{ xs: 'column', sm: 'row' }} spacing={1.5} sx={{ mb: 2.5 }}>
        <FormControl size="small" fullWidth>
          <InputLabel id="assistant-model-label" shrink>{t.integAssistantModel}</InputLabel>
          <Select
            labelId="assistant-model-label"
            label={t.integAssistantModel}
            notched
            displayEmpty
            value={configuredRoutes.some((route) => route.value === assistantValue) ? assistantValue : ''}
            onChange={(event) => persistRoute('assistant', event.target.value)}
            renderValue={(value) => {
              const hit = configuredRoutes.find((route) => route.value === value);
              return hit?.label || (configuredRoutes.length ? t.modelsSelectModel : t.modelsOnboardingTitle);
            }}
          >
            <MenuItem value="" disabled>{configuredRoutes.length ? t.modelsSelectModel : t.modelsOnboardingTitle}</MenuItem>
            {configuredRoutes.map((route) => (
              <MenuItem key={route.value} value={route.value}>{route.label}</MenuItem>
            ))}
          </Select>
        </FormControl>
        <FormControl size="small" fullWidth>
          <InputLabel id="silicon-model-label" shrink>{t.integSiliconModel}</InputLabel>
          <Select
            labelId="silicon-model-label"
            label={t.integSiliconModel}
            notched
            displayEmpty
            value={visionRoutes.some((route) => route.value === siliconValue) ? siliconValue : ''}
            onChange={(event) => persistRoute('silicon', event.target.value)}
            renderValue={(value) => {
              const hit = visionRoutes.find((route) => route.value === value);
              return hit?.label || t.modelsSelectVision;
            }}
          >
            <MenuItem value="" disabled>{t.modelsSelectVision}</MenuItem>
            {visionRoutes.map((route) => (
              <MenuItem key={route.value} value={route.value}>{route.label}</MenuItem>
            ))}
          </Select>
        </FormControl>
      </Stack>

      {renderGroup(t.modelsGroupRecommended, groups.recommended)}
      {renderGroup(t.modelsGroupConfigured, groups.configured)}
      {renderGroup(t.modelsGroupCatalog, groups.catalog)}
      {renderGroup(t.modelsGroupCustom, groups.custom)}
      {renderGroup(t.modelsGroupUnsupported, groups.unsupported)}

      <Stack direction={{ xs: 'column', sm: 'row' }} spacing={1} sx={{ mt: 2 }}>
        <Button variant="outlined" startIcon={<AddIcon />} onClick={() => setAddOpen(true)} disabled={!unusedCatalog.length}>
          {t.modelsAdd}
        </Button>
        <Button variant="outlined" startIcon={<AddIcon />} onClick={() => setCustomOpen(true)}>
          {t.modelsCustomAdd}
        </Button>
      </Stack>
      <Typography variant="body2" sx={{ mt: 1.5 }}>
        {t.integGetKey}{' '}
        <Link href="https://platform.deepseek.com/api_keys" target="_blank" rel="noopener noreferrer">DeepSeek</Link>
        {' / '}
        <Link href="https://openrouter.ai/keys" target="_blank" rel="noopener noreferrer">OpenRouter</Link>
        {' / '}
        <Link href="https://platform.openai.com/api-keys" target="_blank" rel="noopener noreferrer">OpenAI</Link>
      </Typography>

      <Dialog open={addOpen} onClose={() => setAddOpen(false)}>
        <DialogTitle>{t.modelsAdd}</DialogTitle>
        <DialogContent sx={{ pt: 1, minWidth: 320 }}>
          <FormControl fullWidth size="small" sx={{ mt: 1 }}>
            <InputLabel>{t.modelsProvider}</InputLabel>
            <Select
              label={t.modelsProvider}
              value={unusedCatalog.some((item) => item.id === addProvider) ? addProvider : (unusedCatalog[0]?.id || '')}
              onChange={(event) => setAddProvider(event.target.value)}
            >
              {unusedCatalog.map((item) => (
                <MenuItem key={item.id} value={item.id}>{item.displayName}</MenuItem>
              ))}
            </Select>
          </FormControl>
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setAddOpen(false)}>{t.modelsCancel}</Button>
          <Button variant="contained" onClick={addCatalogProvider} disabled={!unusedCatalog.length}>{t.modelsAdd}</Button>
        </DialogActions>
      </Dialog>

      <Dialog open={customOpen} onClose={() => setCustomOpen(false)} maxWidth="sm" fullWidth>
        <DialogTitle>{t.modelsCustomTitle}</DialogTitle>
        <DialogContent>
          <Stack spacing={1.5} sx={{ mt: 1 }}>
            <TextField
              size="small"
              label={t.modelsCustomRoute}
              value={custom.provider}
              onChange={(event) => setCustom({ ...custom, provider: event.target.value.trim() })}
              helperText={t.modelsCustomRouteHint}
            />
            <TextField
              size="small"
              label={t.modelsCustomDisplayName}
              value={custom.displayName}
              onChange={(event) => setCustom({ ...custom, displayName: event.target.value })}
            />
            <TextField
              size="small"
              label={t.modelsBaseUrl}
              value={custom.baseUrl}
              onChange={(event) => setCustom({ ...custom, baseUrl: event.target.value })}
              placeholder={t.modelsCustomBaseUrlPlaceholder}
            />
            <FormControl size="small">
              <InputLabel>{t.modelsCustomApi}</InputLabel>
              <Select
                label={t.modelsCustomApi}
                value={custom.protocol}
                onChange={(event) => setCustom({ ...custom, protocol: event.target.value })}
              >
                {PROTOCOLS.map((id) => (
                  <MenuItem key={id} value={id}>{id}</MenuItem>
                ))}
              </Select>
            </FormControl>
            <TextField
              size="small"
              type="password"
              label={t.modelsKeyInput}
              value={custom.apiKey}
              onChange={(event) => setCustom({ ...custom, apiKey: event.target.value })}
              placeholder={t.modelsKeyPlaceholder}
            />
            {custom.models.map((model, index) => (
              <Stack key={index} direction="row" spacing={1}>
                <TextField
                  size="small"
                  label={t.modelsModelId}
                  value={model.id}
                  onChange={(event) => {
                    const next = [...custom.models];
                    next[index] = { ...model, id: event.target.value };
                    setCustom({ ...custom, models: next });
                  }}
                  sx={{ flex: 1 }}
                />
                <TextField
                  size="small"
                  label={t.modelsModelName}
                  value={model.name || model.label || ''}
                  onChange={(event) => {
                    const next = [...custom.models];
                    next[index] = { ...model, name: event.target.value, label: event.target.value };
                    setCustom({ ...custom, models: next });
                  }}
                  sx={{ flex: 1 }}
                />
              </Stack>
            ))}
            <Button size="small" onClick={() => setCustom({ ...custom, models: [...custom.models, emptyModel()] })}>
              {t.modelsAddModel}
            </Button>
          </Stack>
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setCustomOpen(false)}>{t.modelsCancel}</Button>
          <Button variant="contained" onClick={createCustom} disabled={busy}>
            {busy ? t.modelsCreating : t.modelsCreate}
          </Button>
        </DialogActions>
      </Dialog>
    </Box>
  );
}
