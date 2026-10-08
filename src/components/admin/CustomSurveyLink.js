import React, { useEffect, useState } from 'react';
import { Alert, Box, Button, InputAdornment, TextField, Typography } from '@mui/material';
import { useRegion } from '../../contexts/RegionContext';
import { setProjectPublicSlug } from '../../lib/projectManager';
import { normalizePublicSlug, validatePublicSlug } from '../../lib/publicSlug';

const ERROR_KEY = {
  invalid: 'shareCustomLinkInvalid',
  reserved: 'shareCustomLinkReserved',
  taken: 'shareCustomLinkTaken',
  forbidden: 'shareCustomLinkForbidden',
  unavailable: 'shareCustomLinkUnavailable',
  unknown: 'shareCustomLinkFailed',
};

export default function CustomSurveyLink({ projectId, savedSlug = '', onSaved }) {
  const { t } = useRegion();
  const origin = window.location.origin;
  const [draft, setDraft] = useState(savedSlug || '');
  const [errorCode, setErrorCode] = useState('');
  const [notice, setNotice] = useState('');
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    setDraft(savedSlug || '');
    setErrorCode('');
    setNotice('');
  }, [projectId, savedSlug]);

  const errorText = errorCode ? t[ERROR_KEY[errorCode] || ERROR_KEY.unknown] : '';

  const save = async (event) => {
    event.preventDefault();
    if (!projectId || saving) return;
    setSaving(true);
    setErrorCode('');
    setNotice('');
    try {
      const check = validatePublicSlug(draft);
      if (!check.ok) {
        setErrorCode(check.code);
        return;
      }
      const result = await setProjectPublicSlug(projectId, check.slug);
      if (!result.success) {
        setErrorCode(result.code || 'unknown');
        return;
      }
      const next = result.publicSlug || '';
      setDraft(next);
      onSaved?.(next);
      setNotice(next ? t.shareCustomLinkSaved : t.shareCustomLinkCleared);
    } catch {
      setErrorCode('unknown');
    } finally {
      setSaving(false);
    }
  };

  return (
    <Box component="form" onSubmit={save} data-testid="custom-survey-link" sx={{ mb: 2 }}>
      <Typography variant="subtitle2" sx={{ mb: 0.5 }}>{t.shareCustomLink}</Typography>
      <Typography variant="body2" color="text.secondary" sx={{ mb: 1.5 }}>
        {t.shareCustomLinkHint}
      </Typography>
      <Box sx={{ display: 'flex', gap: 1, alignItems: 'flex-start', flexWrap: 'wrap' }}>
        <TextField
          size="small"
          value={draft}
          onChange={(event) => {
            setDraft(normalizePublicSlug(event.target.value));
            setErrorCode('');
            setNotice('');
          }}
          placeholder="campus-study"
          error={!!errorText}
          disabled={saving}
          autoCapitalize="none"
          autoCorrect="off"
          spellCheck={false}
          sx={{ flex: '1 1 240px' }}
          inputProps={{
            'aria-label': t.shareCustomLinkLabel,
            maxLength: 40,
          }}
          InputProps={{
            startAdornment: (
              <InputAdornment position="start">
                <Box component="span" sx={{ fontFamily: 'monospace', fontSize: '0.85rem' }}>{origin}/s/</Box>
              </InputAdornment>
            ),
          }}
        />
        <Button type="submit" variant="contained" size="small" disabled={saving || !projectId}>
          {saving ? t.shareCustomLinkSaving : t.shareCustomLinkSave}
        </Button>
      </Box>
      <Typography variant="caption" color="text.secondary" sx={{ display: 'block', mt: 0.75 }}>
        {t.shareCustomLinkHelp}
      </Typography>
      {errorText && <Alert severity="error" sx={{ mt: 1.5 }}>{errorText}</Alert>}
      {!errorText && notice && <Alert severity="success" sx={{ mt: 1.5 }}>{notice}</Alert>}
    </Box>
  );
}
