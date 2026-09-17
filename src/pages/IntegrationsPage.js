import React, { useCallback, useEffect, useState } from 'react';
import {
  Alert,
  Box,
  Button,
  Card,
  CardContent,
  Chip,
  Divider,
  IconButton,
  Stack,
  Typography,
} from '@mui/material';
import ArrowBackIcon from '@mui/icons-material/ArrowBack';
import CheckCircleIcon from '@mui/icons-material/CheckCircle';
import ContentCopyIcon from '@mui/icons-material/ContentCopy';
import DeleteOutlineIcon from '@mui/icons-material/DeleteOutline';
import { useNavigate } from 'react-router-dom';
import {
  getCredentialStatus,
  getMcpEndpoint,
  getSameOriginMcpEndpoint,
  listMcpConnections,
  revokeMcpConnection,
} from '../lib/agentApi';
import { useRegion } from '../contexts/RegionContext';
import ModelsSettings from '../components/admin/ModelsSettings';

function SetupStep({ number, title, children }) {
  return (
    <Stack direction="row" spacing={1.5} sx={{ mb: 2.5 }}>
      <Box
        sx={{
          flexShrink: 0,
          width: 28,
          height: 28,
          borderRadius: '50%',
          bgcolor: 'primary.main',
          color: 'primary.contrastText',
          display: 'grid',
          placeItems: 'center',
          fontWeight: 700,
          fontSize: 14,
        }}
      >
        {number}
      </Box>
      <Box sx={{ flex: 1, minWidth: 0 }}>
        <Typography fontWeight={700} sx={{ mb: 0.75 }}>{title}</Typography>
        {children}
      </Box>
    </Stack>
  );
}

function CopyBox({ value, onCopy }) {
  return (
    <Box sx={{ position: 'relative' }}>
      <Box
        component="pre"
        sx={{
          m: 0,
          p: 2,
          pr: 6,
          bgcolor: 'grey.100',
          border: '1px solid',
          borderColor: 'divider',
          borderRadius: 1,
          overflow: 'auto',
          fontSize: 13,
          lineHeight: 1.5,
        }}
      >
        {value}
      </Box>
      <IconButton
        size="small"
        onClick={() => onCopy(value)}
        aria-label="copy"
        sx={{ position: 'absolute', top: 8, right: 8 }}
      >
        <ContentCopyIcon fontSize="small" />
      </IconButton>
    </Box>
  );
}

export default function IntegrationsPage() {
  const { t } = useRegion();
  const navigate = useNavigate();
  const [credential, setCredential] = useState(null);
  const [connections, setConnections] = useState([]);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState(null);
  const mcpEndpoint = getMcpEndpoint();
  const localMcpEndpoint = getSameOriginMcpEndpoint();
  const showLocalMcpHint = localMcpEndpoint !== mcpEndpoint;

  const refresh = useCallback(async () => {
    const [credentialResult, connectionResult] = await Promise.all([
      getCredentialStatus(),
      listMcpConnections(),
    ]);
    if (credentialResult.success !== false) {
      setCredential(credentialResult.openai || { configured: false });
    }
    if (connectionResult.success) {
      setConnections(connectionResult.connections || []);
    }
  }, []);

  useEffect(() => {
    refresh();
  }, [refresh]);

  const copy = async (value) => {
    await navigator.clipboard.writeText(value);
    setMessage({ severity: 'info', text: 'Copied.' });
  };

  const handleRevoke = async (tokenHash) => {
    setBusy(true);
    try {
      await revokeMcpConnection(tokenHash);
      setMessage({ severity: 'success', text: 'MCP access revoked.' });
      await refresh();
    } finally {
      setBusy(false);
    }
  };

  const setupPrompt = `Set up SP-Survey MCP (merge config; don't wipe other settings).

[mcp_servers.sp_survey]
url = "${mcpEndpoint}"
auth = "oauth"
scopes = ["surveys:read", "surveys:write", "surveys:publish", "media:write", "results:read"]

Also set: mcp_oauth_credentials_store = "keyring"

Then run: codex mcp login sp_survey
Open the authorize URL in my system default browser (Safari / Chrome / Edge). Wait while I click Approve on this site.`;

  const claudeCli = `claude mcp add --transport http sp_survey "${mcpEndpoint}" --scope user`;

  const claudeSetupPrompt = `Set up SP-Survey MCP for Claude Code (merge; don't remove other MCP servers).

Run this in the terminal:
${claudeCli}

Then in Claude Code run /mcp → select sp_survey → Authenticate.
Open the authorize URL in my system default browser. Wait while I click Approve on this site.
After that, use the sp_survey tools (start with survey_capabilities).`;

  const cursorMcpJson = `{
  "mcpServers": {
    "sp_survey": {
      "url": "${mcpEndpoint}"
    }
  }
}`;

  const cursorSetupPrompt = `Set up SP-Survey MCP for Cursor (merge into existing mcpServers; don't wipe other servers).

Add to ~/.cursor/mcp.json (global) or .cursor/mcp.json (this project):
${cursorMcpJson}

Then open Cursor Settings → Tools & MCP → Connect / Authenticate on sp_survey.
Open the authorize URL in my system default browser. Wait while I click Approve on this site.
After that, use the sp_survey tools (start with survey_capabilities).`;

  const designPrompt = `Using sp_survey, help me design a survey.

MEDIA RULES (must follow):
- Do NOT generate, synthesize, or invent images/videos and upload them via media_upload.
- Prefer existing media: media_import_from_template (copy from a published template), or ask me to use project Media Dataset / Admin → 预览媒体库 (platform preview media library).
- Leave image*/media*/skillquestion choices empty with imageSelectionMode=huggingface_random so runtime samples from the project pool.
- media_upload is only for real files I explicitly provide; never AI-generated placeholders.`;

  return (
    <Box sx={{ maxWidth: 820, mx: 'auto', p: { xs: 2, md: 4 } }}>
      <Button startIcon={<ArrowBackIcon />} onClick={() => navigate('/admin')} sx={{ mb: 2 }}>
        {t.integBackAdmin}
      </Button>

      <Typography variant="h4" gutterBottom>{t.integTitle}</Typography>
      <Typography color="text.secondary" sx={{ mb: 3 }}>
        {t.integBody}
      </Typography>

      {message && (
        <Alert severity={message.severity} onClose={() => setMessage(null)} sx={{ mb: 2 }}>
          {message.text}
        </Alert>
      )}

      <Stack spacing={3}>
        <Card variant="outlined" sx={{ borderColor: 'primary.main', borderWidth: 2 }}>
          <CardContent>
            <Stack direction="row" spacing={1} alignItems="center" sx={{ mb: 1 }}>
              <Typography variant="h6">{t.integAssistantTitle}</Typography>
              <Chip label={t.integRecommended} color="primary" size="small" />
              {credential?.configured && (
                <Chip icon={<CheckCircleIcon />} label={t.integReady} color="success" size="small" />
              )}
            </Stack>
            <Typography color="text.secondary" sx={{ mb: 2 }}>
              {t.integAssistantFirstBody}
            </Typography>
            <ModelsSettings
              onConfiguredChange={(status) => {
                setCredential(status?.openai || { configured: false });
              }}
            />
            <Button variant="outlined" onClick={() => navigate('/admin')} sx={{ mt: 2 }}>
              {t.openSurveyBuilder}
            </Button>
          </CardContent>
        </Card>

        <Card variant="outlined">
          <CardContent>
            <Stack direction="row" spacing={1} alignItems="center" sx={{ mb: 1 }}>
              <Typography variant="h6">{t.integConnectTitle}</Typography>
              <Chip label={t.integAdvanced} size="small" />
              {connections.length > 0 && (
                <Chip icon={<CheckCircleIcon />} label={t.integConnected} color="success" size="small" />
              )}
            </Stack>
            <Typography color="text.secondary" sx={{ mb: 2 }}>
              {t.integConnectBody}
            </Typography>

            <Typography variant="body2" sx={{ mb: 0.5 }}>
              {t.integMcpEndpoint}
            </Typography>
            <CopyBox value={mcpEndpoint} onCopy={copy} />
            {showLocalMcpHint && (
              <Typography variant="caption" color="text.secondary" sx={{ display: 'block', mt: 1, mb: 2 }}>
                {t.integLocalMcpHint}: {localMcpEndpoint}
              </Typography>
            )}
            {!showLocalMcpHint && <Box sx={{ mb: 3 }} />}

            <SetupStep number={1} title={t.integStep1Title}>
              <Typography variant="body2" color="text.secondary" sx={{ mb: 1.5 }}>
                {t.integStep1Body}
              </Typography>
              <Box
                component="img"
                src="/docs/chatgpt-codex-approve-for-me.png"
                alt='ChatGPT (Codex) permission menu with "Approve for me" selected'
                sx={{
                  display: 'block',
                  width: '100%',
                  maxWidth: 420,
                  height: 'auto',
                  border: '1px solid',
                  borderColor: 'divider',
                  borderRadius: 1,
                }}
              />
            </SetupStep>

            <SetupStep number={2} title={t.integStep2Title}>
              <Typography variant="body2" color="text.secondary" sx={{ mb: 1 }}>
                {t.integStep2Body}
              </Typography>
              <CopyBox value={setupPrompt} onCopy={copy} />
            </SetupStep>

            <SetupStep number={3} title={t.integStep3Title}>
              <Typography variant="body2" color="text.secondary" sx={{ mb: 1 }}>
                {t.integStep3Body}
              </Typography>
              <CopyBox value={designPrompt} onCopy={copy} />
            </SetupStep>

            <Divider sx={{ my: 2 }} />
            <Typography fontWeight={700} sx={{ mb: 1 }}>{t.integAccounts}</Typography>
            {connections.length === 0 ? (
              <Typography variant="body2" color="text.secondary">
                {t.integNoneYet}
              </Typography>
            ) : (
              <Stack spacing={1}>
                {connections.map((connection) => (
                  <Stack
                    key={connection.tokenHash}
                    direction={{ xs: 'column', sm: 'row' }}
                    justifyContent="space-between"
                    alignItems={{ xs: 'flex-start', sm: 'center' }}
                    spacing={1}
                    sx={{ p: 1.5, border: '1px solid', borderColor: 'divider', borderRadius: 1 }}
                  >
                    <Box>
                      <Typography fontWeight={600}>{connection.clientName}</Typography>
                      <Typography variant="caption" color="text.secondary">
                        {t.integLastUsed}{' '}
                        {connection.lastUsedAt
                          ? new Date(connection.lastUsedAt).toLocaleString()
                          : t.integNever}
                      </Typography>
                    </Box>
                    <Button
                      color="error"
                      size="small"
                      startIcon={<DeleteOutlineIcon />}
                      disabled={busy}
                      onClick={() => handleRevoke(connection.tokenHash)}
                    >
                      {t.integDisconnect}
                    </Button>
                  </Stack>
                ))}
              </Stack>
            )}
          </CardContent>
        </Card>

        <Card variant="outlined">
          <CardContent>
            <Typography variant="h6" sx={{ mb: 1 }}>{t.integClaudeTitle}</Typography>
            <Typography color="text.secondary" sx={{ mb: 2 }}>
              {t.integClaudeBody}
            </Typography>

            <SetupStep number={1} title={t.integClaudeStep1Title}>
              <Typography variant="body2" color="text.secondary" sx={{ mb: 1 }}>
                {t.integClaudeStep1Body}
              </Typography>
              <CopyBox value={claudeCli} onCopy={copy} />
              <Typography variant="body2" color="text.secondary" sx={{ mt: 1.5, mb: 1 }}>
                {t.integOrPastePrompt}
              </Typography>
              <CopyBox value={claudeSetupPrompt} onCopy={copy} />
            </SetupStep>

            <SetupStep number={2} title={t.integClaudeStep2Title}>
              <Typography variant="body2" color="text.secondary">
                {t.integClaudeStep2Body}
              </Typography>
            </SetupStep>

            <SetupStep number={3} title={t.integClaudeStep3Title}>
              <Typography variant="body2" color="text.secondary" sx={{ mb: 1 }}>
                {t.integClaudeStep3Body}
              </Typography>
              <CopyBox value={designPrompt} onCopy={copy} />
            </SetupStep>
          </CardContent>
        </Card>

        <Card variant="outlined">
          <CardContent>
            <Typography variant="h6" sx={{ mb: 1 }}>{t.integCursorTitle}</Typography>
            <Typography color="text.secondary" sx={{ mb: 2 }}>
              {t.integCursorBody}
            </Typography>

            <SetupStep number={1} title={t.integCursorStep1Title}>
              <Typography variant="body2" color="text.secondary" sx={{ mb: 1 }}>
                {t.integCursorStep1Body}
              </Typography>
              <CopyBox value={cursorMcpJson} onCopy={copy} />
              <Typography variant="body2" color="text.secondary" sx={{ mt: 1.5, mb: 1 }}>
                {t.integOrPastePrompt}
              </Typography>
              <CopyBox value={cursorSetupPrompt} onCopy={copy} />
            </SetupStep>

            <SetupStep number={2} title={t.integCursorStep2Title}>
              <Typography variant="body2" color="text.secondary">
                {t.integCursorStep2Body}
              </Typography>
            </SetupStep>

            <SetupStep number={3} title={t.integCursorStep3Title}>
              <Typography variant="body2" color="text.secondary" sx={{ mb: 1 }}>
                {t.integCursorStep3Body}
              </Typography>
              <CopyBox value={designPrompt} onCopy={copy} />
            </SetupStep>
          </CardContent>
        </Card>

        <Card variant="outlined">
          <CardContent>
            <Typography variant="body2" color="text.secondary">{t.integAfterSave}</Typography>
          </CardContent>
        </Card>
      </Stack>
    </Box>
  );
}
