import React, { useState } from 'react';
import {
  Box,
  Paper,
  Typography,
  TextField,
  Button,
  Alert,
  CircularProgress,
  Tabs,
  Tab,
  Divider,
  Link,
} from '@mui/material';
import { Link as RouterLink, Navigate, useNavigate, useSearchParams } from 'react-router-dom';
import { safeInAppPath } from '../lib/researcherEntry';
import { useAuth } from '../contexts/AuthContext';
import { useRegion } from '../contexts/RegionContext';
import PublicHeader, { PublicFooter } from '../components/layout/PublicHeader';
import StreetscapeAtmosphere from '../components/StreetscapeAtmosphere';

// Supabase reports a dead reset link in the URL hash (#error=…&error_description=…).
function resetLinkError() {
  const hash = new URLSearchParams(window.location.hash.replace(/^#/, ''));
  return hash.get('error') ? (hash.get('error_description') || hash.get('error')) : '';
}

export default function LoginPage() {
  const {
    login, register, isAuthenticated, loading: authLoading,
    sendPasswordReset, resendConfirmation, setNewPassword,
  } = useAuth();
  const { t } = useRegion();
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const [tab, setTab] = useState(0); // 0 = login, 1 = register
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [info, setInfo] = useState('');
  const resetLink = searchParams.get('reset') === '1';
  // 'form' = sign in / register, 'forgot' = ask for a reset e-mail.
  const [mode, setMode] = useState(() => (resetLink && resetLinkError() ? 'forgot' : 'form'));
  const [linkError] = useState(() => (resetLink ? resetLinkError() : ''));
  const [newPassword, setNewPasswordValue] = useState('');

  const run = async (action) => {
    setError('');
    setInfo('');
    setLoading(true);
    try {
      await action();
    } catch (err) {
      setError(err.message || t.loginErrorGeneric);
    } finally {
      setLoading(false);
    }
  };

  const handleForgot = (e) => {
    e.preventDefault();
    run(async () => {
      await sendPasswordReset(email);
      setInfo(t.loginResetSent);
    });
  };

  const handleResend = () => {
    if (!email) {
      setError(t.loginEnterEmailFirst);
      setInfo('');
      return;
    }
    run(async () => {
      await resendConfirmation(email);
      setInfo(t.loginResendSent);
    });
  };

  const handleNewPassword = (e) => {
    e.preventDefault();
    run(async () => {
      await setNewPassword(newPassword);
      navigate(safeInAppPath(searchParams.get('next')), { replace: true });
    });
  };

  const handleSubmit = async (e) => {
    e.preventDefault();
    setError('');
    setInfo('');
    setLoading(true);
    try {
      if (tab === 0) {
        await login(email, password);
        navigate(safeInAppPath(searchParams.get('next')));
      } else {
        await register(email, password);
        setInfo(t.loginRegisterSuccess);
        setTab(0);
      }
    } catch (err) {
      setError(err.message || t.loginErrorGeneric);
    } finally {
      setLoading(false);
    }
  };

  if (authLoading) {
    return (
      <Box sx={{ minHeight: '100vh', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
        <CircularProgress />
      </Box>
    );
  }

  // A reset link signs the person in first; they choose a new password here.
  const settingNewPassword = resetLink && isAuthenticated && !linkError;
  if (isAuthenticated && !settingNewPassword) {
    return <Navigate to={safeInAppPath(searchParams.get('next'))} replace />;
  }

  return (
    <Box
      sx={{
        minHeight: '100vh',
        display: 'flex',
        flexDirection: 'column',
        bgcolor: 'background.default',
      }}
    >
      <PublicHeader />

      <Box
        sx={{
          flex: 1,
          position: 'relative',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          p: { xs: 2, sm: 3 },
          minHeight: { xs: 520, md: 560 },
        }}
      >
        <StreetscapeAtmosphere
          overlay="linear-gradient(120deg, rgba(8,14,12,0.42) 0%, rgba(8,14,12,0.28) 45%, rgba(8,14,12,0.5) 100%)"
        />
        <Paper
          elevation={0}
          sx={{
            position: 'relative',
            zIndex: 1,
            width: '100%',
            maxWidth: 420,
            p: { xs: 3, sm: 4 },
            borderRadius: 2.5,
            border: '1px solid',
            borderColor: 'rgba(255,255,255,0.35)',
            bgcolor: 'rgba(255,255,255,0.92)',
            backdropFilter: 'blur(12px)',
            boxShadow: '0 18px 50px rgba(0,0,0,0.28)',
          }}
        >
          <Box sx={{ display: 'flex', flexDirection: 'column', alignItems: 'center', mb: 3 }}>
            <Typography variant="h6" fontWeight={700}>
              {t.loginBrand}
            </Typography>
            <Typography variant="body2" color="text.secondary" textAlign="center">
              {t.loginSubtitle}
            </Typography>
          </Box>

          <Divider sx={{ mb: 3 }} />

          {error && <Alert severity="error" sx={{ mb: 2 }}>{error}</Alert>}
          {info && <Alert severity="success" sx={{ mb: 2 }}>{info}</Alert>}

          {settingNewPassword ? (
            <Box component="form" onSubmit={handleNewPassword} sx={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
              <Typography variant="subtitle1" fontWeight={700}>{t.loginNewPasswordTitle}</Typography>
              <TextField
                label={t.loginNewPassword}
                type="password"
                value={newPassword}
                onChange={(e) => setNewPasswordValue(e.target.value)}
                required
                autoFocus
                autoComplete="new-password"
                helperText={t.loginPasswordHelp}
                inputProps={{ minLength: 6 }}
              />
              <Button type="submit" variant="contained" size="large" disabled={loading}
                startIcon={loading ? <CircularProgress size={20} color="inherit" /> : null}>
                {t.loginSaveNewPassword}
              </Button>
            </Box>
          ) : mode === 'forgot' ? (
            <Box component="form" onSubmit={handleForgot} sx={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
              <Typography variant="subtitle1" fontWeight={700}>{t.loginForgotTitle}</Typography>
              {linkError && !error && !info && <Alert severity="warning">{t.loginResetLinkInvalid}</Alert>}
              <Typography variant="body2" color="text.secondary">{t.loginForgotHelp}</Typography>
              <TextField
                label={t.loginEmail}
                type="email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                required
                autoFocus
                autoComplete="email"
              />
              <Button type="submit" variant="contained" size="large" disabled={loading}
                startIcon={loading ? <CircularProgress size={20} color="inherit" /> : null}>
                {t.loginSendResetLink}
              </Button>
              <Button variant="text" size="small" onClick={() => { setMode('form'); setError(''); setInfo(''); }}>
                {t.loginBackToSignIn}
              </Button>
            </Box>
          ) : (
            <>
              <Tabs value={tab} onChange={(_, v) => { setTab(v); setError(''); setInfo(''); }} sx={{ mb: 3 }}>
                <Tab label={t.loginSignIn} />
                <Tab label={t.loginCreateAccount} />
              </Tabs>

              <Box component="form" onSubmit={handleSubmit} sx={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
                <TextField
                  label={t.loginEmail}
                  type="email"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  required
                  autoFocus
                  autoComplete="email"
                />
                <TextField
                  label={t.loginPassword}
                  type="password"
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  required
                  autoComplete={tab === 0 ? 'current-password' : 'new-password'}
                  helperText={tab === 1 ? t.loginPasswordHelp : ''}
                />
                <Button
                  type="submit"
                  variant="contained"
                  color="primary"
                  size="large"
                  disabled={loading}
                  startIcon={loading ? <CircularProgress size={20} color="inherit" /> : null}
                  sx={{ mt: 1 }}
                >
                  {loading
                    ? (tab === 0 ? t.loginSigningIn : t.loginCreating)
                    : (tab === 0 ? t.loginSignIn : t.loginCreateAccount)}
                </Button>
              </Box>

              <Box sx={{ mt: 2, display: 'flex', justifyContent: 'space-between', gap: 1, flexWrap: 'wrap' }}>
                <Link component="button" type="button" variant="body2"
                  onClick={() => { setMode('forgot'); setError(''); setInfo(''); }}>
                  {t.loginForgot}
                </Link>
                <Link component="button" type="button" variant="body2" onClick={handleResend} disabled={loading}>
                  {t.loginResend}
                </Link>
              </Box>
            </>
          )}

          <Button
            component={RouterLink}
            to="/"
            variant="text"
            size="small"
            sx={{ mt: 2, alignSelf: 'center', display: 'block', mx: 'auto' }}
          >
            {t.loginBackHome}
          </Button>
        </Paper>
      </Box>

      <PublicFooter />
    </Box>
  );
}
