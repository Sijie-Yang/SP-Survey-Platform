import React, { useEffect, useMemo, useState } from 'react';
import { Navigate, useNavigate, useSearchParams } from 'react-router-dom';
import {
  Alert,
  Box,
  Button,
  Card,
  CardContent,
  Checkbox,
  CircularProgress,
  FormControlLabel,
  FormGroup,
  Stack,
  Typography,
} from '@mui/material';
import { useAuth } from '../contexts/AuthContext';
import { approveMcpOAuth } from '../lib/agentApi';

const SCOPE_LABELS = {
  'surveys:read': 'Read your projects and survey configs',
  'surveys:write': 'Create and edit surveys (saves update the live share URL)',
  'surveys:publish': 'Optional version snapshots for rollback (not required for share links)',
  'media:write': 'Upload and manage project media in your storage prefix',
  'results:read': 'List, export, and summarize survey responses for your projects',
};

const PENDING_KEY = 'mcp_oauth_pending_query';

function readOAuthParams(searchParams) {
  let clientId = searchParams.get('client_id') || '';
  let redirectUri = searchParams.get('redirect_uri') || '';
  let state = searchParams.get('state') || '';
  let codeChallenge = searchParams.get('code_challenge') || '';
  let codeChallengeMethod = searchParams.get('code_challenge_method') || 'S256';
  let resource = searchParams.get('resource') || '';
  let scope = searchParams.get('scope') || '';

  // Restore after login redirect (avoids huge / fragile ?next= query strings).
  if (!clientId && typeof sessionStorage !== 'undefined') {
    try {
      const raw = sessionStorage.getItem(PENDING_KEY);
      if (raw) {
        const saved = new URLSearchParams(raw);
        clientId = saved.get('client_id') || '';
        redirectUri = saved.get('redirect_uri') || '';
        state = saved.get('state') || '';
        codeChallenge = saved.get('code_challenge') || '';
        codeChallengeMethod = saved.get('code_challenge_method') || 'S256';
        resource = saved.get('resource') || '';
        scope = saved.get('scope') || '';
      }
    } catch {
      /* ignore */
    }
  }

  return { clientId, redirectUri, state, codeChallenge, codeChallengeMethod, resource, scope };
}

export default function McpOAuthPage() {
  const { isAuthenticated, loading } = useAuth();
  const [params] = useSearchParams();
  const navigate = useNavigate();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);

  const oauth = useMemo(() => readOAuthParams(params), [params]);
  const {
    clientId,
    redirectUri,
    state,
    codeChallenge,
    codeChallengeMethod,
    resource,
  } = oauth;

  const requestedScopes = useMemo(() => {
    const raw = oauth.scope
      || 'surveys:read surveys:write surveys:publish media:write results:read';
    return raw.split(/[+\s]+/).filter(Boolean).filter((s) => s !== 'offline_access');
  }, [oauth.scope]);

  const [scopes, setScopes] = useState(() => new Set(requestedScopes));

  useEffect(() => {
    setScopes(new Set(requestedScopes));
  }, [requestedScopes]);

  if (loading) {
    return (
      <Box sx={{ display: 'flex', justifyContent: 'center', alignItems: 'center', minHeight: '60vh' }}>
        <CircularProgress />
      </Box>
    );
  }

  if (!isAuthenticated) {
    try {
      const q = params.toString();
      if (q) sessionStorage.setItem(PENDING_KEY, q);
    } catch {
      /* ignore */
    }
    return <Navigate to="/login?next=/oauth/mcp" replace />;
  }

  const toggleScope = (scope) => {
    setScopes((prev) => {
      const next = new Set(prev);
      if (next.has(scope)) next.delete(scope);
      else next.add(scope);
      return next;
    });
  };

  const handleApprove = async () => {
    setBusy(true);
    setError(null);
    try {
      if (!clientId || !redirectUri || !codeChallenge) {
        throw new Error('Missing OAuth parameters from Codex. Close this window and run codex mcp login again.');
      }
      const result = await approveMcpOAuth({
        client_id: clientId,
        redirect_uri: redirectUri,
        code_challenge: codeChallenge,
        code_challenge_method: codeChallengeMethod,
        scopes: Array.from(scopes),
        resource: resource || undefined,
        state,
      });
      if (!result.success || !result.code) {
        throw new Error(result.error || 'Failed to approve');
      }
      try { sessionStorage.removeItem(PENDING_KEY); } catch { /* ignore */ }
      const target = new URL(redirectUri);
      target.searchParams.set('code', result.code);
      if (state) target.searchParams.set('state', state);
      window.location.href = target.toString();
    } catch (err) {
      setError(err.message || 'Authorization failed');
      setBusy(false);
    }
  };

  const handleDeny = () => {
    try {
      const target = new URL(redirectUri);
      target.searchParams.set('error', 'access_denied');
      if (state) target.searchParams.set('state', state);
      window.location.href = target.toString();
    } catch {
      navigate('/admin/integrations');
    }
  };

  return (
    <Box sx={{ maxWidth: 560, mx: 'auto', p: 3, mt: 6 }}>
      <Card variant="outlined">
        <CardContent>
          <Typography variant="h5" gutterBottom>Authorize ChatGPT (Codex)</Typography>
          <Typography variant="body2" color="text.secondary" sx={{ mb: 2 }}>
            Allow this client to access your SP-Survey projects?
          </Typography>
          {error && <Alert severity="error" sx={{ mb: 2 }}>{error}</Alert>}
          <Typography variant="subtitle2" sx={{ mb: 1 }}>Permissions</Typography>
          <FormGroup>
            {Object.keys(SCOPE_LABELS).map((scope) => (
              <FormControlLabel
                key={scope}
                control={(
                  <Checkbox
                    checked={scopes.has(scope)}
                    onChange={() => toggleScope(scope)}
                  />
                )}
                label={(
                  <Box>
                    <Typography variant="body2" fontWeight={600}>{scope}</Typography>
                    <Typography variant="caption" color="text.secondary">{SCOPE_LABELS[scope]}</Typography>
                  </Box>
                )}
              />
            ))}
          </FormGroup>
          <Alert severity="info" sx={{ my: 2 }}>
            Codex saves update the live share / preview URL immediately. Homepage listing still uses
            Admin → Publish to Main Page. <code>surveys:publish</code> is only for optional
            version snapshots.
          </Alert>
          <Stack direction="row" spacing={1} justifyContent="flex-end">
            <Button disabled={busy} onClick={handleDeny}>Deny</Button>
            <Button variant="contained" disabled={busy || scopes.size === 0} onClick={handleApprove}>
              Approve
            </Button>
          </Stack>
        </CardContent>
      </Card>
    </Box>
  );
}
