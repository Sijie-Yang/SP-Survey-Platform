import React, { useEffect, useState } from 'react';
import {
  Alert,
  Box,
  Button,
  FormControlLabel,
  Paper,
  Stack,
  Switch,
  TextField,
  Typography,
} from '@mui/material';
import { ContentCopy, Storage } from '@mui/icons-material';
import { uiPair } from '../../lib/uiLanguages';
import { useRegion } from '../../contexts/RegionContext';
import { saveOwnResponseSupabase } from '../../lib/projectManager';
import {
  DEFAULT_OWN_RESPONSE_TABLE,
  buildOwnResponseTableSql,
  isServiceRoleKey,
  readStoredOwnResponse,
} from '../../lib/ownResponseSupabase';

const SAVE_ERRORS = {
  'empty-url': ['Enter the Supabase project URL.', '请填写 Supabase 项目 URL。'],
  'empty-key': ['Enter the anon public key.', '请填写 anon 公钥。'],
  'https-only': ['The project URL must use https.', '项目 URL 必须使用 https。'],
  'bad-url': ['Enter a valid project URL.', '请填写有效的项目 URL。'],
  'service-role': ['That key is a service_role key. Paste the anon public key instead.', '这是 service_role 密钥。请改为粘贴 anon 公钥。'],
  'bad-table': ['Use a table name of lowercase letters, numbers, and underscores (up to 50 characters).', '表名只能使用小写字母、数字和下划线，最长 50 个字符。'],
  'missing-column': ['Run supabase/own_response_supabase.sql in the platform Supabase SQL editor, then save again.', '请先在平台的 Supabase SQL 编辑器中运行 supabase/own_response_supabase.sql，然后再保存。'],
  'hosted-only': ['This setting is saved on the hosted project.', '此设置保存在托管项目上。'],
};

function saveErrorText(language, code) {
  const pair = SAVE_ERRORS[code];
  if (pair) return uiPair(language, pair[0], pair[1]);
  return code;
}

export default function OwnResponseSupabaseCard({ currentProject, onSaved }) {
  const { language } = useRegion();
  const [enabled, setEnabled] = useState(false);
  const [url, setUrl] = useState('');
  const [anonKey, setAnonKey] = useState('');
  const [table, setTable] = useState(DEFAULT_OWN_RESPONSE_TABLE);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [saving, setSaving] = useState(false);
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    const stored = readStoredOwnResponse(currentProject?.ownResponseSupabase);
    setEnabled(stored.enabled);
    setUrl(stored.url);
    setTable(stored.table || DEFAULT_OWN_RESPONSE_TABLE);
    setCopied(false);
    if (isServiceRoleKey(stored.anonKey)) {
      setAnonKey('');
      setError(saveErrorText(language, 'service-role'));
    } else {
      setAnonKey(stored.anonKey);
      setError('');
    }
  }, [currentProject?.id, currentProject?.ownResponseSupabase, language]);

  const sqlResult = buildOwnResponseTableSql(table);
  const sql = sqlResult.ok ? sqlResult.sql : '';

  const copySql = async () => {
    if (!sql) return;
    try {
      await navigator.clipboard.writeText(sql);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      setError(uiPair(language, 'Could not copy the SQL. Select it and copy manually.', '无法复制 SQL，请手动选择并复制。'));
    }
  };

  const save = async () => {
    if (!currentProject?.id) return;
    setSaving(true);
    setNotice('');
    setError('');
    try {
      const result = await saveOwnResponseSupabase(currentProject.id, {
        enabled, url, anonKey, table,
      });
      if (!result.success) {
        setError(saveErrorText(language, result.error) || result.error);
        return;
      }
      setNotice(uiPair(
        language,
        'Saved. The next submission uses this setting.',
        '已保存。下一次提交会使用此设置。',
      ));
      if (!result.ownResponseSupabase?.enabled) setAnonKey('');
      onSaved?.(result.ownResponseSupabase);
    } finally {
      setSaving(false);
    }
  };

  return (
    <Paper
      variant="outlined"
      data-testid="own-response-supabase"
      sx={{ p: { xs: 2, sm: 3 }, borderRadius: 1.5, mt: 2 }}
    >
      <Stack direction="row" spacing={1} alignItems="center" sx={{ mb: 1 }}>
        <Storage color="primary" fontSize="small" />
        <Typography variant="subtitle1" fontWeight={700}>
          {uiPair(language, 'Response storage', '回答存储')}
        </Typography>
      </Stack>
      <FormControlLabel
        control={(
          <Switch
            checked={enabled}
            onChange={(event) => {
              setEnabled(event.target.checked);
              setNotice('');
              setError('');
            }}
          />
        )}
        label={uiPair(language, 'Store responses in my Supabase', '回答写入我的 Supabase')}
      />
      <Typography variant="body2" color="text.secondary" sx={{ mt: 1 }}>
        {uiPair(
          language,
          'Participants insert each response into your Supabase with the anon public key. SP-Survey does not copy, analyze, or sync those rows. If the insert fails, the participant sees an error and nothing is saved here.',
          '参与者用 anon 公钥把每一份回答写入你的 Supabase。SP-Survey 不复制、不分析、也不同步这些数据。写入失败时，参与者会看到错误，平台也不会保存这份回答。',
        )}
      </Typography>

      {enabled && (
        <Stack spacing={2} sx={{ mt: 2 }}>
          <TextField
            label={uiPair(language, 'Supabase project URL', 'Supabase 项目 URL')}
            value={url}
            onChange={(event) => setUrl(event.target.value)}
            required
            fullWidth
            size="small"
            placeholder="https://xxxx.supabase.co"
            helperText={uiPair(language, 'https only. The project URL, not a service role secret.', '仅限 https。填写项目 URL，不要填写 service role 密钥。')}
            autoComplete="off"
          />
          <TextField
            label={uiPair(language, 'Anon public key', 'anon 公钥')}
            value={anonKey}
            onChange={(event) => setAnonKey(event.target.value)}
            required
            fullWidth
            size="small"
            helperText={uiPair(
              language,
              'Paste the anon public key from Project Settings → API. Do not paste the service_role key.',
              '粘贴 Project Settings → API 中的 anon 公钥。不要粘贴 service_role 密钥。',
            )}
            autoComplete="off"
            spellCheck={false}
          />
          <TextField
            label={uiPair(language, 'Table name', '表名')}
            value={table}
            onChange={(event) => setTable(event.target.value)}
            fullWidth
            size="small"
            helperText={uiPair(
              language,
              `Default ${DEFAULT_OWN_RESPONSE_TABLE}. Create this table with the SQL below.`,
              `默认 ${DEFAULT_OWN_RESPONSE_TABLE}。用下面的 SQL 创建这张表。`,
            )}
            autoComplete="off"
            spellCheck={false}
          />
          <Box>
            <Typography variant="subtitle2" sx={{ mb: 1 }}>
              {uiPair(language, 'SQL for your Supabase SQL editor', '粘贴到你的 Supabase SQL 编辑器')}
            </Typography>
            <Typography variant="body2" color="text.secondary" sx={{ mb: 1 }}>
              {uiPair(
                language,
                'Creates one table with row level security. The anon key can insert a row and cannot select, update, or delete.',
                '创建一张表并开启行级安全。anon 密钥只能插入一行，不能查询、更新或删除。',
              )}
            </Typography>
            {sql ? (
              <Box
                component="pre"
                data-testid="own-response-sql"
                sx={{
                  p: 2,
                  m: 0,
                  bgcolor: 'action.hover',
                  borderRadius: 1,
                  fontFamily: 'monospace',
                  fontSize: '0.8rem',
                  whiteSpace: 'pre-wrap',
                  wordBreak: 'break-word',
                  maxHeight: 280,
                  overflow: 'auto',
                }}
              >
                {sql}
              </Box>
            ) : (
              <Alert severity="warning">{saveErrorText(language, sqlResult.error || 'bad-table')}</Alert>
            )}
            <Button
              sx={{ mt: 1 }}
              size="small"
              variant="outlined"
              startIcon={<ContentCopy />}
              onClick={copySql}
              disabled={!sql}
            >
              {copied
                ? uiPair(language, 'SQL copied', '已复制 SQL')
                : uiPair(language, 'Copy SQL', '复制 SQL')}
            </Button>
          </Box>
        </Stack>
      )}

      {error && <Alert severity="error" sx={{ mt: 2 }}>{error}</Alert>}
      {notice && <Alert severity="success" sx={{ mt: 2 }}>{notice}</Alert>}

      <Box sx={{ mt: 2 }}>
        <Button variant="contained" onClick={save} disabled={!currentProject?.id || saving}>
          {saving
            ? uiPair(language, 'Saving…', '正在保存…')
            : uiPair(language, 'Save response storage', '保存回答存储')}
        </Button>
      </Box>
    </Paper>
  );
}
