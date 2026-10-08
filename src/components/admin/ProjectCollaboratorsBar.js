import React, { useCallback, useEffect, useState } from 'react';
import {
  Avatar,
  Box,
  Button,
  Chip,
  Stack,
  TextField,
  Tooltip,
  Typography,
} from '@mui/material';
import { useRegion } from '../../contexts/RegionContext';
import { tf } from '../../contexts/adminI18n';
import {
  PRESENCE_HEARTBEAT_MS,
  addProjectCollaborator,
  avatarColor,
  clearProjectPresence,
  collaboratorErrorText,
  listProjectCollaborators,
  presenceInitials,
  removeProjectCollaborator,
  touchProjectPresence,
  visiblePresence,
} from '../../lib/projectCollaborators';

function personLabel(person) {
  return person.displayName || person.email || person.userId;
}

export default function ProjectCollaboratorsBar({
  projectId,
  ownerUserId = null,
  accessRole = null,
  currentUserId = null,
  previewState = null,
}) {
  const { t } = useRegion();
  const [email, setEmail] = useState('');
  const [collaborators, setCollaborators] = useState(previewState?.collaborators || []);
  const [others, setOthers] = useState(() => visiblePresence(previewState?.presence || [], currentUserId));
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState('');
  const [error, setError] = useState('');

  const isOwner = Boolean(currentUserId) && (
    accessRole === 'owner'
    || (accessRole !== 'collaborator' && (!ownerUserId || ownerUserId === currentUserId))
  );

  const refreshCollaborators = useCallback(async () => {
    if (previewState || !projectId) return;
    try {
      const rows = await listProjectCollaborators(projectId);
      setCollaborators(rows);
    } catch (err) {
      if (/schema cache|could not find the function|project_collaborators/i.test(String(err?.message || ''))) return;
    }
  }, [previewState, projectId]);

  useEffect(() => {
    if (previewState) return undefined;
    if (!projectId || !currentUserId) return undefined;
    let stopped = false;
    refreshCollaborators();
    const beat = () => {
      touchProjectPresence(projectId)
        .then((rows) => {
          if (!stopped) setOthers(visiblePresence(rows, currentUserId));
        })
        .catch(() => {});
    };
    beat();
    const timer = window.setInterval(beat, PRESENCE_HEARTBEAT_MS);
    const leave = () => { clearProjectPresence(projectId); };
    window.addEventListener('pagehide', leave);
    return () => {
      stopped = true;
      window.clearInterval(timer);
      window.removeEventListener('pagehide', leave);
      clearProjectPresence(projectId);
    };
  }, [currentUserId, previewState, projectId, refreshCollaborators]);

  const onAdd = async (event) => {
    event.preventDefault();
    setError('');
    setMessage('');
    setBusy(true);
    try {
      if (previewState) {
        const next = {
          userId: `preview-${email}`,
          email: email.trim(),
          displayName: email.trim(),
        };
        setCollaborators((prev) => [...prev, next]);
        setMessage(tf(t.collaboratorAdded, { email: next.email }));
        setEmail('');
        return;
      }
      const added = await addProjectCollaborator(projectId, email);
      setEmail('');
      setMessage(tf(t.collaboratorAdded, { email: added?.email || email }));
      await refreshCollaborators();
    } catch (err) {
      setError(collaboratorErrorText(err, t));
    } finally {
      setBusy(false);
    }
  };

  const onRemove = async (member) => {
    setError('');
    setMessage('');
    try {
      if (!previewState) await removeProjectCollaborator(projectId, member.userId);
      setCollaborators((prev) => prev.filter((row) => row.userId !== member.userId));
      setMessage(t.collaboratorRemoved);
    } catch (err) {
      setError(collaboratorErrorText(err, t));
    }
  };

  if (!projectId) return null;

  return (
    <Box
      data-testid="project-collaborators"
      sx={{
        display: 'flex',
        flexWrap: 'wrap',
        alignItems: 'center',
        gap: 1.5,
        px: 2,
        py: 1,
        borderBottom: 1,
        borderColor: 'divider',
        bgcolor: 'background.paper',
      }}
    >
      <Stack direction="row" spacing={0.75} alignItems="center" useFlexGap flexWrap="wrap" sx={{ minWidth: 0 }}>
        <Typography variant="caption" color="text.secondary" sx={{ fontWeight: 700, letterSpacing: 0.2 }}>
          {t.presenceTitle}
        </Typography>
        {others.length === 0 ? (
          <Typography variant="caption" color="text.secondary">{t.presenceOnlyYou}</Typography>
        ) : others.map((person) => (
          <Tooltip key={person.userId} title={person.email || personLabel(person)}>
            <Chip
              size="small"
              variant="outlined"
              label={personLabel(person)}
              avatar={(
                <Avatar sx={{ bgcolor: `${avatarColor(person.userId)} !important`, color: '#fff', fontSize: 11 }}>
                  {presenceInitials(person.displayName, person.email)}
                </Avatar>
              )}
            />
          </Tooltip>
        ))}
      </Stack>

      {collaborators.length > 0 && (
        <Stack direction="row" spacing={0.5} alignItems="center" useFlexGap flexWrap="wrap">
          <Typography variant="caption" color="text.secondary" sx={{ fontWeight: 700 }}>{t.collaboratorTitle}</Typography>
          {collaborators.map((member) => (
            <Chip
              key={member.userId}
              size="small"
              label={member.email || personLabel(member)}
              onDelete={isOwner ? () => onRemove(member) : undefined}
              aria-label={member.email || personLabel(member)}
            />
          ))}
        </Stack>
      )}

      {isOwner && (
        <Box
          component="form"
          onSubmit={onAdd}
          sx={{ display: 'flex', gap: 1, alignItems: 'center', flexWrap: 'wrap', ml: { md: 'auto' } }}
        >
          <TextField
            size="small"
            type="email"
            name="collaborator-email"
            label={t.collaboratorEmail}
            value={email}
            onChange={(event) => setEmail(event.target.value)}
            disabled={busy}
            sx={{ minWidth: 220 }}
          />
          <Button type="submit" variant="contained" size="small" disabled={busy || !email.trim()}>
            {t.collaboratorAdd}
          </Button>
        </Box>
      )}

      {message && (
        <Typography variant="caption" color="success.main" role="status">{message}</Typography>
      )}
      {error && (
        <Typography variant="caption" color="error" role="alert">{error}</Typography>
      )}
    </Box>
  );
}
