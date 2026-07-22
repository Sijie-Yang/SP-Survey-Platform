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
} from '@mui/material';
import { Link as RouterLink, useNavigate, useSearchParams } from 'react-router-dom';
import { useAuth } from '../contexts/AuthContext';
import { useRegion } from '../contexts/RegionContext';
import PublicHeader, { PublicFooter } from '../components/layout/PublicHeader';
import StreetscapeAtmosphere from '../components/StreetscapeAtmosphere';

export default function LoginPage() {
  const { login, register } = useAuth();
  const { t } = useRegion();
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const [tab, setTab] = useState(0); // 0 = login, 1 = register
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [info, setInfo] = useState('');

  const handleSubmit = async (e) => {
    e.preventDefault();
    setError('');
    setInfo('');
    setLoading(true);
    try {
      if (tab === 0) {
        await login(email, password);
        const next = searchParams.get('next');
        if (next && next.startsWith('/')) {
          const q = next.indexOf('?');
          if (q === -1) navigate(next);
          else navigate({ pathname: next.slice(0, q), search: next.slice(q) });
        } else {
          navigate('/admin');
        }
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

          <Tabs value={tab} onChange={(_, v) => { setTab(v); setError(''); setInfo(''); }} sx={{ mb: 3 }}>
            <Tab label={t.loginSignIn} />
            <Tab label={t.loginCreateAccount} />
          </Tabs>

          {error && <Alert severity="error" sx={{ mb: 2 }}>{error}</Alert>}
          {info && <Alert severity="success" sx={{ mb: 2 }}>{info}</Alert>}

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
