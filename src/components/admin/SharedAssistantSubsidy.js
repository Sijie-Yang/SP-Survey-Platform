import React, { useCallback, useEffect, useMemo, useState } from 'react';
import {
  Alert,
  Autocomplete,
  Box,
  Button,
  Chip,
  CircularProgress,
  FormControlLabel,
  Paper,
  Stack,
  Switch,
  TextField,
  Typography,
} from '@mui/material';
import { getAssistantSubsidy, saveAssistantSubsidy } from '../../lib/adminSubsidyApi';

function toLocalInput(value) {
  if (!value) return '';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return '';
  const pad = (n) => String(n).padStart(2, '0');
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}T${pad(date.getHours())}:${pad(date.getMinutes())}`;
}

function fromLocalInput(value) {
  if (!value) return null;
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? null : date.toISOString();
}

export default function SharedAssistantSubsidy() {
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const [message, setMessage] = useState('');
  const [enabled, setEnabled] = useState(false);
  const [expiresAt, setExpiresAt] = useState('');
  const [selected, setSelected] = useState([]);
  const [available, setAvailable] = useState([]);
  const [settings, setSettings] = useState(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError('');
    try {
      const data = await getAssistantSubsidy();
      const routes = data.availableRoutes || [];
      setAvailable(routes);
      setSettings(data.settings || null);
      setEnabled(Boolean(data.settings?.enabled));
      setExpiresAt(toLocalInput(data.settings?.expires_at));
      const selectedValues = (data.settings?.allowed_routes || []).map((route) => ({
        value: `${route.provider}::${route.model}`,
        provider: route.provider,
        model: route.model,
        label: routes.find((item) => item.provider === route.provider && item.model === route.model)?.label
          || `${route.provider} / ${route.model}`,
      }));
      setSelected(selectedValues);
    } catch (err) {
      setError(err.message || 'Failed to load free-model settings.');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { load(); }, [load]);

  const selectedValues = useMemo(() => selected.map((route) => route.value), [selected]);

  const save = async () => {
    setSaving(true);
    setError('');
    setMessage('');
    try {
      const data = await saveAssistantSubsidy({
        enabled,
        expires_at: fromLocalInput(expiresAt),
        allowed_routes: selected.map((route) => ({ provider: route.provider, model: route.model })),
      });
      setSettings(data.settings || null);
      setEnabled(Boolean(data.settings?.enabled));
      setExpiresAt(toLocalInput(data.settings?.expires_at));
      setMessage(data.settings?.active
        ? 'Free Assistant models are on. Other users can pick them without saving an API key.'
        : 'Free Assistant models are off.');
    } catch (err) {
      setError(err.message || 'Failed to save free-model settings.');
    } finally {
      setSaving(false);
    }
  };

  if (loading) {
    return (
      <Box sx={{ display: 'flex', justifyContent: 'center', py: 6 }}>
        <CircularProgress />
      </Box>
    );
  }

  return (
    <Paper sx={{ p: { xs: 2, sm: 3 } }}>
      <Stack spacing={2.5} maxWidth={720}>
        <Box>
          <Typography variant="h6">免费 Assistant 模型</Typography>
          <Typography variant="body2" color="text.secondary" sx={{ mt: 0.5 }}>
            用你自己已经保存在 Integrations 里的 API key，临时开放给其他用户的 AI Assistant。
            Silicon Samples 不能用这些免费模型。
          </Typography>
        </Box>

        {error ? <Alert severity="error">{error}</Alert> : null}
        {message ? <Alert severity="success">{message}</Alert> : null}
        {settings?.active ? (
          <Alert severity="info">
            当前已开放 {settings.allowed_routes?.length || 0} 个模型
            {settings.expires_at ? `，截止 ${new Date(settings.expires_at).toLocaleString()}` : '，直到你关掉'}。
          </Alert>
        ) : null}

        {!available.length ? (
          <Alert severity="warning">
            先到 Integrations 保存至少一个 provider 的 API key，才能把它设成免费模型。
          </Alert>
        ) : null}

        <FormControlLabel
          control={<Switch checked={enabled} onChange={(event) => setEnabled(event.target.checked)} />}
          label="开放免费 Assistant 模型"
        />

        <Autocomplete
          multiple
          options={available}
          value={selected}
          onChange={(_, value) => setSelected(value)}
          disableCloseOnSelect
          getOptionLabel={(option) => option.label}
          isOptionEqualToValue={(option, value) => option.value === value.value}
          renderTags={(value, getTagProps) => value.map((option, index) => (
            <Chip {...getTagProps({ index })} key={option.value} label={option.label} size="small" />
          ))}
          renderInput={(params) => (
            <TextField
              {...params}
              label="可免费使用的模型"
              placeholder={available.length ? '选择 provider 和模型' : '还没有可用的 key'}
              helperText="可多选。保存后，普通用户即使没填 API 也能在 Assistant 里看到这些模型。"
            />
          )}
        />

        <TextField
          label="自动关闭时间（可选）"
          type="datetime-local"
          value={expiresAt}
          onChange={(event) => setExpiresAt(event.target.value)}
          InputLabelProps={{ shrink: true }}
          helperText="留空表示一直开到你手动关掉。"
        />

        <Alert severity="warning">
          调用会打到你的账号额度。不要把 key 发给用户；他们只能在 Assistant 里选模型，看不到 key。
        </Alert>

        <Stack direction="row" spacing={1}>
          <Button variant="contained" onClick={save} disabled={saving || (enabled && !selectedValues.length)}>
            {saving ? '保存中…' : '保存'}
          </Button>
          <Button onClick={load} disabled={saving}>刷新</Button>
        </Stack>
      </Stack>
    </Paper>
  );
}
