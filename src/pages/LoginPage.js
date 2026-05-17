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
import { useAuth } from '../contexts/AuthContext';
import { useNavigate } from 'react-router-dom';

export default function LoginPage() {
  const { login, register } = useAuth();
  const navigate = useNavigate();
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
        navigate('/admin');
      } else {
        await register(email, password);
        setInfo('Registration successful! Please check your email to confirm your account, then log in.');
        setTab(0);
      }
    } catch (err) {
      setError(err.message || 'An error occurred');
    } finally {
      setLoading(false);
    }
  };

  return (
    <Box
      sx={{
        minHeight: '100vh',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        bgcolor: 'grey.100',
        p: 2,
      }}
    >
      <Paper elevation={3} sx={{ width: '100%', maxWidth: 420, p: 4, borderRadius: 2 }}>
        {/* Logo / Title */}
        <Box sx={{ display: 'flex', flexDirection: 'column', alignItems: 'center', mb: 3 }}>
          <Box
            component="img"
            src="/logo-header.png"
            alt="SP-Survey"
            sx={{ height: 48, objectFit: 'contain', mb: 1.5 }}
            onError={(e) => { e.target.style.display = 'none'; }}
          />
          <Typography variant="h6" fontWeight={700}>
            Streetscape Perception Survey
          </Typography>
          <Typography variant="body2" color="text.secondary">
            Admin Platform
          </Typography>
        </Box>

        <Divider sx={{ mb: 3 }} />

        <Tabs value={tab} onChange={(_, v) => { setTab(v); setError(''); setInfo(''); }} sx={{ mb: 3 }}>
          <Tab label="Sign In" />
          <Tab label="Create Account" />
        </Tabs>

        {error && <Alert severity="error" sx={{ mb: 2 }}>{error}</Alert>}
        {info && <Alert severity="success" sx={{ mb: 2 }}>{info}</Alert>}

        <Box component="form" onSubmit={handleSubmit} sx={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
          <TextField
            label="Email"
            type="email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            required
            autoFocus
            autoComplete="email"
          />
          <TextField
            label="Password"
            type="password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            required
            autoComplete={tab === 0 ? 'current-password' : 'new-password'}
            helperText={tab === 1 ? 'Minimum 6 characters' : ''}
          />
          <Button
            type="submit"
            variant="contained"
            size="large"
            disabled={loading}
            startIcon={loading ? <CircularProgress size={20} color="inherit" /> : null}
            sx={{ mt: 1 }}
          >
            {loading
              ? tab === 0 ? 'Signing in...' : 'Creating account...'
              : tab === 0 ? 'Sign In' : 'Create Account'}
          </Button>
        </Box>
      </Paper>
    </Box>
  );
}
