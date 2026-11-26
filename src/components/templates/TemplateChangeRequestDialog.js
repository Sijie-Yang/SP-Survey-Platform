import React, { useState } from 'react';
import {
  Alert, Box, Button, Dialog, DialogActions, DialogContent, DialogTitle,
  FormControlLabel, Radio, RadioGroup, Stack, TextField, Typography,
} from '@mui/material';
import { useAuth } from '../../contexts/AuthContext';
import { useRegion } from '../../contexts/RegionContext';
import { submitSiteFeedback } from '../../lib/siteFeedback';

const EMPTY = { role: 'author', change: '', links: '', contactName: '', contactEmail: '', website: '' };

/**
 * The text an admin reads in 平台管理 → 用户建议. Kept as plain text so the
 * existing suggestions table and tab handle it with no new SQL.
 */
export function templateChangeMessage({ template, title, role, change, links }) {
  return [
    '[模板修改请求 / Template change request]',
    `模板 Template: ${title} (${template.id})`,
    `身份 Role: ${role === 'author' ? '作者 Author' : '其他用户 Other user'}`,
    '',
    '想改什么 What to change:',
    String(change || '').trim(),
    ...(String(links || '').trim() ? ['', '原始资料链接 Original materials:', String(links).trim()] : []),
  ].join('\n');
}

/** "Request a change" on a template row: goes to the admin suggestions list. */
export default function TemplateChangeRequestDialog({ template, title, open, onClose }) {
  const { t, language } = useRegion();
  const { user } = useAuth();
  const [form, setForm] = useState(EMPTY);
  const [sending, setSending] = useState(false);
  const [sent, setSent] = useState(false);
  const [error, setError] = useState('');
  const set = (key) => (e) => setForm((f) => ({ ...f, [key]: e.target.value }));
  const ok = form.change.trim().length >= 2;

  const close = () => {
    onClose();
    setTimeout(() => { setSent(false); setError(''); }, 200);
  };

  const submit = async () => {
    if (!ok || sending) return;
    setSending(true);
    setError('');
    try {
      await submitSiteFeedback({
        category: 'other',
        message: templateChangeMessage({ template, title, ...form }),
        contactName: form.contactName,
        contactEmail: form.contactEmail,
        website: form.website,
        language,
        pageUrl: `${window.location.origin}/templates?q=${encodeURIComponent(template.id)}`,
      });
      setForm(EMPTY);
      setSent(true);
    } catch (err) {
      if (err.rateLimited) setError(t.feedbackRateLimited);
      else if (err.missingTable) setError(t.feedbackUnavailable);
      else setError(t.feedbackFailed);
    } finally {
      setSending(false);
    }
  };

  return (
    <Dialog open={open} onClose={close} maxWidth="sm" fullWidth>
      <DialogTitle sx={{ pb: 0.5 }}>{t.tplRequestChange || 'Request a change'}</DialogTitle>
      <DialogContent>
        <Typography variant="body2" color="text.secondary" sx={{ mb: 2 }}>{title}</Typography>
        {sent ? (
          <Alert severity="success">{t.tplRequestSent || 'Thanks. We will look at it and get back to you if you left an email.'}</Alert>
        ) : (
          <Stack spacing={2}>
            <RadioGroup row value={form.role} onChange={set('role')}>
              <FormControlLabel value="author" control={<Radio size="small" />} label={t.tplRoleAuthor || 'I am an author of this paper'} />
              <FormControlLabel value="other" control={<Radio size="small" />} label={t.tplRoleOther || 'Other user'} />
            </RadioGroup>
            <TextField
              label={t.tplRequestWhat || 'What should change?'}
              placeholder={t.tplRequestWhatHint || 'Wrong wording, missing question, better images, add our original survey…'}
              value={form.change}
              onChange={set('change')}
              multiline
              minRows={3}
              required
              inputProps={{ maxLength: 3000 }}
            />
            <TextField
              label={t.tplRequestLinks || 'Links to original materials (optional)'}
              placeholder={t.tplRequestLinksHint || 'Original survey link, data, code or HTML zip (OSF, GitHub, cloud drive)'}
              value={form.links}
              onChange={set('links')}
              multiline
              minRows={2}
              inputProps={{ maxLength: 1500 }}
            />
            <Stack direction={{ xs: 'column', sm: 'row' }} spacing={2}>
              <TextField size="small" fullWidth label={t.feedbackContactName || 'Name'} value={form.contactName} onChange={set('contactName')} inputProps={{ maxLength: 120 }} />
              <TextField size="small" fullWidth type="email" label={t.feedbackContactEmail || 'Email'} value={form.contactEmail} onChange={set('contactEmail')} inputProps={{ maxLength: 200 }} helperText={user ? '' : (t.tplRequestEmailHint || 'So we can reply')} />
            </Stack>
            {/* Honeypot: people never see or fill this. */}
            <Box aria-hidden sx={{ position: 'absolute', left: -10000, width: 1, height: 1, overflow: 'hidden' }}>
              <input tabIndex={-1} autoComplete="off" value={form.website} onChange={set('website')} name="website" />
            </Box>
            {error && <Alert severity="error">{error}</Alert>}
          </Stack>
        )}
      </DialogContent>
      <DialogActions>
        <Button onClick={close}>{t.landClose}</Button>
        {!sent && (
          <Button variant="contained" onClick={submit} disabled={!ok || sending}>
            {t.tplRequestSend || 'Send'}
          </Button>
        )}
      </DialogActions>
    </Dialog>
  );
}
