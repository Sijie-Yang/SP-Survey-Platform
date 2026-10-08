import React, { useCallback, useEffect, useState } from 'react';
import {
  Box,
  Button,
  IconButton,
  Popover,
  TextField,
  Tooltip,
  Typography,
} from '@mui/material';
import { PersonAdd } from '@mui/icons-material';
import { useRegion } from '../../contexts/RegionContext';
import { tf } from '../../contexts/adminI18n';
import {
  PRESENCE_HEARTBEAT_MS,
  addProjectCollaborator,
  clearProjectPresence,
  collaboratorErrorText,
  listProjectCollaborators,
  presenceColorMap,
  presenceInitials,
  removeProjectCollaborator,
  touchProjectPresence,
  visiblePresence,
} from '../../lib/projectCollaborators';

const circleButtonSx = {
  border: 1,
  borderColor: 'rgba(255, 255, 255, 0.5)',
  borderRadius: '50%',
  width: 32,
  height: 32,
  '&:hover': {
    borderColor: 'rgba(255, 255, 255, 0.8)',
    bgcolor: 'rgba(255, 255, 255, 0.1)',
  },
};

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
  const [anchor, setAnchor] = useState(null);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState('');
  const [error, setError] = useState('');

  const isOwner = Boolean(currentUserId) && (
    accessRole === 'owner'
    || (accessRole !== 'collaborator' && (!ownerUserId || ownerUserId === currentUserId))
  );
  const colors = presenceColorMap(others);

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
  if (!isOwner && others.length === 0) return null;

  return (
    <Box data-testid="project-collaborators" sx={{ display: 'flex', alignItems: 'center', gap: 0.5 }}>
      {others.length > 0 && (
        <Box sx={{ display: 'flex', alignItems: 'center' }}>
          {others.map((person, index) => {
            const label = tf(t.presencePerson, { name: personLabel(person) });
            const color = colors.get(person.userId);
            return (
              <Tooltip key={person.userId} title={label}>
                <IconButton
                  size="small"
                  color="inherit"
                  aria-label={label}
                  data-testid="presence-circle"
                  data-color={color}
                  sx={{
                    ...circleButtonSx,
                    ml: index === 0 ? 0 : '-10px',
                    zIndex: others.length - index,
                    bgcolor: color,
                    color: '#fff',
                    fontSize: 12,
                    fontWeight: 700,
                    borderColor: 'rgba(255,255,255,0.85)',
                    '&:hover': { bgcolor: color, borderColor: '#fff' },
                  }}
                >
                  {presenceInitials(person.displayName, person.email)}
                </IconButton>
              </Tooltip>
            );
          })}
        </Box>
      )}

      {isOwner && (
        <>
          <Tooltip title={t.collaboratorInviteTooltip}>
            <IconButton
              size="small"
              color="inherit"
              aria-label={t.collaboratorInviteTooltip}
              aria-expanded={Boolean(anchor)}
              aria-haspopup="dialog"
              onClick={(event) => setAnchor(event.currentTarget)}
              sx={circleButtonSx}
            >
              <PersonAdd fontSize="small" />
            </IconButton>
          </Tooltip>
          <Popover
            open={Boolean(anchor)}
            anchorEl={anchor}
            onClose={() => setAnchor(null)}
            anchorOrigin={{ vertical: 'bottom', horizontal: 'right' }}
            transformOrigin={{ vertical: 'top', horizontal: 'right' }}
          >
            <Box component="form" onSubmit={onAdd} sx={{ p: 2, width: 320, display: 'flex', flexDirection: 'column', gap: 1.25 }}>
              <Typography variant="subtitle2">{t.collaboratorTitle}</Typography>
              <TextField
                size="small"
                type="email"
                name="collaborator-email"
                label={t.collaboratorEmail}
                value={email}
                onChange={(event) => setEmail(event.target.value)}
                disabled={busy}
                autoFocus
              />
              <Button type="submit" variant="contained" size="small" disabled={busy || !email.trim()}>
                {t.collaboratorAdd}
              </Button>
              {collaborators.map((member) => (
                <Box key={member.userId} sx={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 1 }}>
                  <Typography variant="body2" noWrap>{member.email || personLabel(member)}</Typography>
                  <Button
                    size="small"
                    color="inherit"
                    aria-label={tf(t.collaboratorRemove, { email: member.email || personLabel(member) })}
                    onClick={() => onRemove(member)}
                  >
                    {t.sidebarDelete}
                  </Button>
                </Box>
              ))}
              {message && <Typography variant="caption" color="success.main" role="status">{message}</Typography>}
              {error && <Typography variant="caption" color="error" role="alert">{error}</Typography>}
            </Box>
          </Popover>
        </>
      )}
    </Box>
  );
}
