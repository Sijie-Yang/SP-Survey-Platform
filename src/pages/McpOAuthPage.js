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
import { useL } from '../components/studio/studioUi';
import { approveMcpOAuth } from '../lib/agentApi';

/** What each permission lets the AI tool do, in plain words: [en, zh]. */
const SCOPE_LABELS = {
  'surveys:read': ['Read your studies and their surveys', '查看你的研究和问卷'],
  'surveys:write': ['Create studies, import survey pages and edit drafts', '新建研究、导入问卷页面、修改草稿'],
  'surveys:publish': ['Publish a version for participants; admins can also publish templates', '发布给参与者的正式版本；管理员还可以发布模板'],
  'media:write': ['Upload images into your studies', '往你的研究里上传图片'],
  'results:read': ['Read and download responses for analysis', '查看和下载回答，用来分析'],
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
  const L = useL();
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
        throw new Error(L('The sign-in link is incomplete. Close this window and connect again from your AI tool.', '登录链接不完整。请关掉这个窗口，回到 AI 工具里重新连接。'));
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
        throw new Error(result.error || L('Could not approve.', '没能授权。'));
      }
      try { sessionStorage.removeItem(PENDING_KEY); } catch { /* ignore */ }
      const target = new URL(redirectUri);
      target.searchParams.set('code', result.code);
      if (state) target.searchParams.set('state', state);
      window.location.href = target.toString();
    } catch (err) {
      setError(err.message || L('Authorization failed.', '授权失败。'));
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

  if (!clientId || !redirectUri || !codeChallenge) {
    return (
      <Box sx={{ maxWidth: 560, mx: 'auto', p: 3, mt: 6 }}>
        <Card variant="outlined">
          <CardContent>
            <Typography variant="h5" gutterBottom>{L('Connect an AI tool to SP-Survey', '把 AI 工具连接到 SP-Survey')}</Typography>
            <Alert severity="warning" sx={{ mb: 2 }}>
              {L('The sign-in link is incomplete. Close this window and connect again from your AI tool (Claude, ChatGPT, Codex…).', '登录链接不完整。请关掉这个窗口，回到 AI 工具（Claude、ChatGPT、Codex 等）里重新连接。')}
            </Alert>
            <Button variant="contained" onClick={() => navigate('/admin/integrations')}>
              {L('Open Integrations', '打开集成设置')}
            </Button>
          </CardContent>
        </Card>
      </Box>
    );
  }

  return (
    <Box sx={{ maxWidth: 560, mx: 'auto', p: 3, mt: 6, bgcolor: 'background.default', minHeight: '100vh' }}>
      <Card variant="outlined">
        <CardContent>
          <Typography variant="h5" gutterBottom>{L('Connect an AI tool to SP-Survey', '把 AI 工具连接到 SP-Survey')}</Typography>
          <Typography variant="body2" color="text.secondary" sx={{ mb: 2 }}>
            {L(
              'An AI tool (Claude, ChatGPT, Codex…) asks to work on your studies with your account. Keep every box ticked so it can build, publish and analyse a study end to end.',
              'AI 工具（Claude、ChatGPT、Codex 等）请求用你的账号操作你的研究。全部勾选，它才能从建问卷、发布一直做到分析数据。',
            )}
          </Typography>
          {error && <Alert severity="error" sx={{ mb: 2 }}>{error}</Alert>}
          <Typography variant="subtitle2" sx={{ mb: 1 }}>{L('Permissions', '权限')}</Typography>
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
                    <Typography variant="caption" color="text.secondary">{L(...SCOPE_LABELS[scope])}</Typography>
                  </Box>
                )}
              />
            ))}
          </FormGroup>
          <Alert severity="info" sx={{ my: 2 }}>
            {L(
              'Until a study is published as a version, saved changes are live on its participant link right away. You can disconnect the tool any time in Integrations.',
              '研究在发布正式版本之前，保存的修改会马上出现在参与者链接上。随时可以在「集成设置」里断开这个工具。',
            )}
          </Alert>
          <Stack direction="row" spacing={1} justifyContent="flex-end">
            <Button disabled={busy} onClick={handleDeny}>{L('Deny', '拒绝')}</Button>
            <Button variant="contained" disabled={busy || scopes.size === 0} onClick={handleApprove}>
              {L('Approve', '允许')}
            </Button>
          </Stack>
        </CardContent>
      </Card>
    </Box>
  );
}
