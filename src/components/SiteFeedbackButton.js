import React, { useState } from 'react';
import {
  Alert, Box, Button, Dialog, DialogActions, DialogContent, DialogTitle,
  Fab, MenuItem, Stack, TextField, Typography,
} from '@mui/material';
import { RateReview } from '@mui/icons-material';
import { useAuth } from '../contexts/AuthContext';
import { useRegion } from '../contexts/RegionContext';
import { tf } from '../contexts/adminI18n';
import { FEEDBACK_CATEGORIES, FEEDBACK_MESSAGE_MAX, submitSiteFeedback } from '../lib/siteFeedback';

const EMPTY_FORM = {
  category: 'suggestion',
  message: '',
  contactName: '',
  contactEmail: '',
  contactWechat: '',
  contactOther: '',
  website: '',
};

const CATEGORY_KEYS = {
  suggestion: 'feedbackCatSuggestion',
  feature: 'feedbackCatFeature',
  bug: 'feedbackCatBug',
  other: 'feedbackCatOther',
};

/** Floating "Suggestions" button plus its dialog; anyone can send, sign-in optional. */
export default function SiteFeedbackButton() {
  const { t, language } = useRegion();
  const { user } = useAuth();
  const [open, setOpen] = useState(false);
  const [form, setForm] = useState(EMPTY_FORM);
  const [sending, setSending] = useState(false);
  const [sent, setSent] = useState(false);
  const [error, setError] = useState('');

  const set = (key) => (e) => setForm((f) => ({ ...f, [key]: e.target.value }));
  const messageOk = form.message.trim().length >= 2;

  const handleOpen = () => {
    setSent(false);
    setError('');
    setOpen(true);
  };

  const handleSubmit = async () => {
    if (!messageOk || sending) return;
    setSending(true);
    setError('');
    try {
      await submitSiteFeedback({ ...form, language });
      setForm(EMPTY_FORM);
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
    <>
      <Fab
        variant="extended"
        color="primary"
        onClick={handleOpen}
        aria-label={t.feedbackButton}
        sx={{
          position: 'fixed',
          right: { xs: 16, sm: 24 },
          bottom: { xs: 16, sm: 24 },
          zIndex: (theme) => theme.zIndex.speedDial,
          fontWeight: 700,
          textTransform: 'none',
          boxShadow: '0 8px 24px rgba(0,0,0,0.22)',
        }}
      >
        <RateReview sx={{ mr: 1 }} />
        {t.feedbackButton}
      </Fab>

      <Dialog open={open} onClose={() => !sending && setOpen(false)} maxWidth="sm" fullWidth>
        <DialogTitle sx={{ pb: 0.5 }}>{t.feedbackTitle}</DialogTitle>
        <DialogContent>
          {sent ? (
            <Alert severity="success" sx={{ mt: 1 }}>{t.feedbackThanks}</Alert>
          ) : (
            <Stack spacing={2} sx={{ mt: 0.5 }}>
              <Typography variant="body2" color="text.secondary">
                {user?.email ? tf(t.feedbackSignedInAs, { email: user.email }) : t.feedbackAnonymousHint}
              </Typography>
              <TextField
                select
                size="small"
                label={t.feedbackCategory}
                value={form.category}
                onChange={set('category')}
                sx={{ maxWidth: 240 }}
              >
                {FEEDBACK_CATEGORIES.map((c) => (
                  <MenuItem key={c} value={c}>{t[CATEGORY_KEYS[c]]}</MenuItem>
                ))}
              </TextField>
              <TextField
                autoFocus
                multiline
                minRows={4}
                maxRows={12}
                required
                label={t.feedbackMessage}
                placeholder={t.feedbackMessagePlaceholder}
                value={form.message}
                onChange={set('message')}
                inputProps={{ maxLength: FEEDBACK_MESSAGE_MAX }}
                helperText={`${form.message.length} / ${FEEDBACK_MESSAGE_MAX}`}
              />
              <Typography variant="subtitle2" sx={{ pt: 0.5 }}>{t.feedbackContactTitle}</Typography>
              <Box sx={{ display: 'grid', gridTemplateColumns: { xs: '1fr', sm: '1fr 1fr' }, gap: 1.5 }}>
                <TextField size="small" label={t.feedbackContactName} value={form.contactName} onChange={set('contactName')} inputProps={{ maxLength: 100 }} />
                <TextField size="small" type="email" label={t.feedbackContactEmail} value={form.contactEmail} onChange={set('contactEmail')} inputProps={{ maxLength: 200 }} />
                <TextField size="small" label={t.feedbackContactWechat} value={form.contactWechat} onChange={set('contactWechat')} inputProps={{ maxLength: 100 }} />
                <TextField size="small" label={t.feedbackContactOther} placeholder={t.feedbackContactOtherPlaceholder} value={form.contactOther} onChange={set('contactOther')} inputProps={{ maxLength: 200 }} />
              </Box>
              {/* Honeypot: hidden from people, filled in by naive bots. */}
              <Box aria-hidden="true" sx={{ position: 'absolute', left: -10000, width: 1, height: 1, overflow: 'hidden' }}>
                <input tabIndex={-1} autoComplete="off" name="website" value={form.website} onChange={set('website')} />
              </Box>
              {error && <Alert severity="error">{error}</Alert>}
            </Stack>
          )}
        </DialogContent>
        <DialogActions>
          {sent ? (
            <>
              <Button onClick={() => setSent(false)}>{t.feedbackSendAnother}</Button>
              <Button variant="contained" onClick={() => setOpen(false)}>{t.landClose}</Button>
            </>
          ) : (
            <>
              <Button onClick={() => setOpen(false)} disabled={sending}>{t.landClose}</Button>
              <Button variant="contained" onClick={handleSubmit} disabled={!messageOk || sending}>
                {sending ? t.feedbackSending : t.feedbackSubmit}
              </Button>
            </>
          )}
        </DialogActions>
      </Dialog>
    </>
  );
}
