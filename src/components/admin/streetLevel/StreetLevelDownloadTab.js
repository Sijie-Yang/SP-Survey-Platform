import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  Alert, Box, Button, Chip, CircularProgress, IconButton, LinearProgress, MenuItem, Stack, TextField,
  Tooltip, Typography,
} from '@mui/material';
import { CheckCircle, ContentCopy } from '@mui/icons-material';
import { useStreetLevelText } from '../../../contexts/streetLevelI18n';
import {
  ACTIVE_JOB_STATES, DEFAULT_CAPTURE, FOLDER_MODES, PRESETS, cancelJob, getJob, helperHealth, installCommand,
  mergeMediaEntries, resumeJob, runCommand, sendToken, serveCommand, startJob, summarizeItems,
} from '../../../lib/streetLevel/localHelper';
import { currentAccessToken } from '../../../lib/streetLevel/api';
import { getR2PublicBase, getR2ServerUrl, listImagesFromR2 } from '../../../lib/r2';
import { compareMediaNames, normalizeFolderPath } from '../../../lib/mediaUtils';

const POLL_MS = 1500;
const HEALTH_MS = 4000;
const HEALTH_CONNECTED_MS = 10000;
const LANDED_MS = 5000;
const TOKEN_REFRESH_MS = 5 * 60 * 1000;
const ZOOM_WIDTHS = { 1: 1024, 2: 2048, 3: 4096, 4: 8192, 5: 16384 };

function CopyLine({ text, label }) {
  const [copied, setCopied] = useState(false);
  return (
    <Stack direction="row" spacing={0.5} alignItems="center" sx={{ bgcolor: 'grey.100', borderRadius: 1, px: 1, py: 0.5 }}>
      <Box component="code" data-testid="helper-command" sx={{ flex: 1, fontSize: 12, wordBreak: 'break-all', fontFamily: 'monospace' }}>{text}</Box>
      <Tooltip title={copied ? '✓' : label}>
        <IconButton size="small" aria-label={label} onClick={() => {
          navigator.clipboard?.writeText(text).then(() => { setCopied(true); setTimeout(() => setCopied(false), 1500); }).catch(() => {});
        }}><ContentCopy fontSize="inherit" /></IconButton>
      </Tooltip>
    </Stack>
  );
}

const STATUS_COLOR = { done: 'success', 'no-image': 'default', failed: 'error', running: 'info', pending: 'default' };

export default function StreetLevelDownloadTab({
  points, selectedIds, currentProject, projectRef, projectPrefix, onProjectUpdate, commitStreetLevel,
  initialCapture, lastJob,
}) {
  const tx = useStreetLevelText();
  const [helper, setHelper] = useState({ checking: true, running: false });
  const [capture, setCapture] = useState({ ...DEFAULT_CAPTURE, ...(initialCapture || {}) });
  const [scope, setScope] = useState('all');
  const [job, setJob] = useState(null);
  const [jobId, setJobId] = useState(lastJob?.jobId || null);
  const [error, setError] = useState(null);
  const [interrupted, setInterrupted] = useState(false);
  const [landed, setLanded] = useState(null);
  const seenRef = useRef(0);
  const tokenSentAt = useRef(0);
  const countsKey = useRef('');

  const apiBase = getR2ServerUrl() || window.location.origin;
  const origin = window.location.origin;
  const projectId = currentProject?.id;
  const folder = normalizeFolderPath(capture.folder || 'street-level') || 'street-level';
  const scopePoints = scope === 'selected' ? points.filter((p) => selectedIds.includes(p.id)) : points;
  const items = useMemo(() => {
    const raw = job?.items || lastJob?.items || {};
    if (job || !interrupted) return raw;
    return Object.fromEntries(Object.entries(raw).map(([id, it]) => [id, it.status === 'running' ? { ...it, status: 'pending' } : it]));
  }, [job, lastJob?.items, interrupted]);
  const counts = summarizeItems(points, items);
  const active = job && ACTIVE_JOB_STATES.has(job.state);
  const needsAuth = job?.state === 'needs-auth';

  const checkHelper = useCallback(async () => {
    const h = await helperHealth();
    setHelper({ checking: false, ...h });
    return h;
  }, []);

  useEffect(() => {
    let timer;
    let alive = true;
    const loop = async () => {
      const h = await checkHelper();
      if (alive) timer = setTimeout(loop, h.running ? HEALTH_CONNECTED_MS : HEALTH_MS);
    };
    loop();
    return () => { alive = false; clearTimeout(timer); };
  }, [checkHelper]);

  const registerEntries = useCallback((snapshot) => {
    const cur = projectRef.current;
    if (!cur) return;
    const cfg = cur.imageDatasetConfig || {};
    const entries = snapshot.entries || [];
    const lastItems = Object.fromEntries(Object.entries(snapshot.items || {}).map(([id, it]) => [id, {
      status: it.status, keys: it.keys || [], error: it.error || null, panoId: it.pano_id || null,
    }]));
    const nextKey = `${snapshot.state}|${JSON.stringify(snapshot.counts)}`;
    if (!entries.length && nextKey === countsKey.current) return;
    countsKey.current = nextKey;
    const mediaFolders = [...new Set([...(cfg.mediaFolders || []), ...(snapshot.folders || [])].filter(Boolean))]
      .sort(compareMediaNames);
    const next = {
      ...cur,
      ...(entries.length ? {
        preloadedImages: mergeMediaEntries(cur.preloadedImages || [], entries),
        preloadedSource: 'r2',
      } : {}),
      imageDatasetConfig: {
        ...cfg,
        mediaFolders,
        mediaFolderTags: { ...(cfg.mediaFolderTags || {}), ...(snapshot.tags || {}) },
        streetLevel: {
          ...(cfg.streetLevel || {}),
          lastJob: { jobId: snapshot.jobId, state: snapshot.state, counts: snapshot.counts, items: lastItems, updatedAt: snapshot.updatedAt },
        },
      },
    };
    projectRef.current = next;
    onProjectUpdate(next);
  }, [onProjectUpdate, projectRef]);

  useEffect(() => {
    if (!jobId || !helper.running) return undefined;
    let alive = true;
    let timer;
    const poll = async () => {
      try {
        const snap = await getJob(jobId, seenRef.current);
        if (!alive) return;
        seenRef.current = snap.entryCount;
        setJob(snap);
        setError(snap.error && snap.state !== 'needs-auth' ? snap.error : null);
        registerEntries(snap);
        const now = Date.now();
        if ((snap.state === 'needs-auth' || (ACTIVE_JOB_STATES.has(snap.state) && now - tokenSentAt.current > TOKEN_REFRESH_MS))) {
          const token = await currentAccessToken();
          if (token && now - tokenSentAt.current > 20000) {
            tokenSentAt.current = now;
            await sendToken(jobId, token);
          }
        }
        if (ACTIVE_JOB_STATES.has(snap.state) || snap.state === 'needs-auth') timer = setTimeout(poll, POLL_MS);
      } catch (err) {
        if (!alive) return;
        if (err.status === 404) { setJob(null); setInterrupted(true); return; }
        const h = await checkHelper();
        if (h.running) timer = setTimeout(poll, POLL_MS * 2);
      }
    };
    poll();
    return () => { alive = false; clearTimeout(timer); };
  }, [jobId, helper.running, registerEntries, checkHelper]);

  const refreshLanded = useCallback(async () => {
    if (!projectPrefix) return;
    const res = await listImagesFromR2(`${projectPrefix}${folder}/`);
    if (res.success) setLanded(new Set((res.images || []).map((i) => i.key)));
  }, [projectPrefix, folder]);

  useEffect(() => {
    refreshLanded();
    if (!active) return undefined;
    const t = setInterval(refreshLanded, LANDED_MS);
    return () => clearInterval(t);
  }, [active, refreshLanded]);

  const start = async (resume) => {
    setError(null);
    if (!projectId || !projectPrefix) { setError(tx('Open a project first.')); return; }
    if (!scopePoints.length) { setError(tx('Add points first.')); return; }
    const options = { ...capture, folder };
    commitStreetLevel({ capture: options });
    try {
      const token = await currentAccessToken();
      tokenSentAt.current = Date.now();
      if (resume && jobId && job && !ACTIVE_JOB_STATES.has(job.state)) {
        await resumeJob(jobId, token);
        setJob({ ...job, state: 'queued' });
        return;
      }
      const res = await startJob({
        apiBase,
        projectId,
        mediaPrefix: projectPrefix,
        publicBase: getR2PublicBase(),
        token,
        points: scopePoints,
        options,
      });
      seenRef.current = 0;
      setJob(null);
      setInterrupted(false);
      setJobId(res.jobId);
    } catch (err) {
      setError(tx('The local helper rejected the job: {e}', { e: err.message }));
      checkHelper();
    }
  };

  const rows = useMemo(() => {
    const list = points.filter((p) => items[p.id]);
    const order = { running: 0, failed: 1, pending: 2, done: 3, 'no-image': 4 };
    return list.sort((a, b) => (order[items[a.id].status] ?? 5) - (order[items[b.id].status] ?? 5)).slice(0, 300);
  }, [points, items]);
  const landedCount = landed
    ? new Set(Object.values(items).flatMap((it) => it.keys || []).filter((k) => landed.has(k))).size
    : null;
  const runState = job?.state || (interrupted ? 'interrupted' : lastJob?.state);
  const hasResumable = Boolean(counts.failed || counts.pending || ['partial', 'cancelled', 'needs-auth', 'failed', 'interrupted'].includes(runState));

  const set = (key, value) => setCapture((c) => ({ ...c, [key]: value }));

  return (
    <Stack spacing={1.5}>
      <Alert severity="warning" variant="outlined" sx={{ py: 0.25 }}>
        {tx('terms-warning')}
      </Alert>

      {helper.checking && <Typography variant="body2"><CircularProgress size={14} sx={{ mr: 1 }} />{tx('Looking for the local helper…')}</Typography>}
      {!helper.checking && !helper.running && (
        <Alert severity="info" sx={{ '& .MuiAlert-message': { width: '100%' } }} data-testid="helper-missing">
          <Typography variant="subtitle2">{tx('The local helper is not running on this computer.')}</Typography>
          <Typography variant="body2" sx={{ mt: 0.5 }}>{tx('Install once (Python 3.9+):')}</Typography>
          <CopyLine text={installCommand()} label={tx('Copy')} />
          <Typography variant="body2" sx={{ mt: 0.75 }}>{tx('Then start it and keep the terminal open:')}</Typography>
          <CopyLine text={serveCommand(origin)} label={tx('Copy')} />
          <Typography variant="caption" color="text.secondary" sx={{ display: 'block', mt: 0.5 }}>
            {tx('This panel detects it automatically. It listens on 127.0.0.1 only.')}
          </Typography>
        </Alert>
      )}
      {helper.running && (
        <Alert severity="success" icon={<CheckCircle fontSize="inherit" />} sx={{ py: 0.25 }}>
          {tx('Local helper connected (sp-streetlevel {v}, streetlevel {s}).', { v: helper.version, s: helper.streetlevel })}
        </Alert>
      )}

      <Stack direction="row" spacing={1}>
        <TextField select size="small" label={tx('Capture preset')} value={capture.preset} sx={{ flex: 1.6 }}
          onChange={(e) => set('preset', e.target.value)}>
          {PRESETS.map((p) => <MenuItem key={p} value={p}>{tx(`preset:${p}`)}</MenuItem>)}
        </TextField>
        {capture.preset === 'headings' && (
          <TextField size="small" type="number" label={tx('Headings (N)')} value={capture.headingCount} sx={{ flex: 0.7 }}
            inputProps={{ min: 1, max: 12 }} onChange={(e) => set('headingCount', Math.max(1, Math.min(12, Number(e.target.value) || 4)))} />
        )}
        <TextField select size="small" label={tx('Panorama resolution')} value={capture.zoom} sx={{ flex: 1 }}
          onChange={(e) => set('zoom', Number(e.target.value))}>
          {[1, 2, 3, 4].map((z) => <MenuItem key={z} value={z}>{tx('zoom {z} (~{w} px)', { z, w: ZOOM_WIDTHS[z] })}</MenuItem>)}
        </TextField>
      </Stack>
      <Stack direction="row" spacing={1}>
        <TextField size="small" type="number" label={tx('Default pitch')} value={capture.pitch} sx={{ flex: 1 }}
          onChange={(e) => set('pitch', Math.max(-90, Math.min(90, Number(e.target.value) || 0)))} />
        <TextField size="small" type="number" label={tx('Default FOV')} value={capture.fov} sx={{ flex: 1 }}
          onChange={(e) => set('fov', Math.max(10, Math.min(120, Number(e.target.value) || 90)))} />
        <TextField size="small" type="number" label={tx('View width (px)')} value={capture.width} sx={{ flex: 1 }}
          onChange={(e) => set('width', Math.max(256, Math.min(2048, Number(e.target.value) || 1024)))} />
        <TextField size="small" type="number" label={tx('Search radius (m)')} value={capture.radius} sx={{ flex: 1 }}
          onChange={(e) => set('radius', Math.max(5, Math.min(200, Number(e.target.value) || 50)))} />
      </Stack>
      <Typography variant="caption" color="text.secondary">{tx('preset-help')}</Typography>
      <Stack direction="row" spacing={1}>
        <TextField size="small" label={tx('Target folder')} value={capture.folder} sx={{ flex: 1 }}
          onChange={(e) => set('folder', e.target.value)} />
        <TextField select size="small" label={tx('Folder role')} value={capture.folderMode} sx={{ flex: 1.2 }}
          onChange={(e) => set('folderMode', e.target.value)}>
          {FOLDER_MODES.map((m) => <MenuItem key={m} value={m}>{tx(`folder:${m}`)}</MenuItem>)}
        </TextField>
        <TextField select size="small" label={tx('Points')} value={scope} sx={{ flex: 1 }}
          onChange={(e) => setScope(e.target.value)}>
          <MenuItem value="all">{tx('All ({n})', { n: points.length })}</MenuItem>
          <MenuItem value="selected" disabled={!selectedIds.length}>{tx('Selected ({n})', { n: selectedIds.length })}</MenuItem>
        </TextField>
        <TextField size="small" type="number" label={tx('Seconds between requests')} value={capture.minInterval} sx={{ flex: 0.9 }}
          inputProps={{ min: 0.5, step: 0.5 }}
          onChange={(e) => set('minInterval', Math.max(0.5, Math.min(60, Number(e.target.value) || 1.5)))} />
      </Stack>

      <Stack direction="row" spacing={1}>
        <Button variant="contained" disabled={!helper.running || active || !scopePoints.length} onClick={() => start(false)}>
          {tx('Download {n} point(s)', { n: scopePoints.length })}
        </Button>
        <Button variant="outlined" disabled={!helper.running || active || !hasResumable} onClick={() => start(true)}>
          {tx('Resume / retry failed')}
        </Button>
        {active && <Button color="warning" onClick={() => cancelJob(jobId).catch(() => {})}>{tx('Cancel')}</Button>}
      </Stack>
      {error && <Alert severity="error">{error}</Alert>}
      {needsAuth && <Alert severity="warning">{tx('Sign-in expired; sending a fresh session to the helper…')}</Alert>}

      {counts.total > 0 && (
        <Box>
          <LinearProgress variant={active && !counts.done ? 'indeterminate' : 'determinate'}
            value={counts.total ? ((counts.done + counts.noImage + counts.failed) / counts.total) * 100 : 0}
            sx={{ height: 8, borderRadius: 4, mb: 0.75 }} />
          <Typography variant="body2" data-testid="download-summary">
            {tx('{done} done ({files} file(s)), {none} without Street View coverage, {failed} failed, {pending} pending — of {total}.', {
              done: counts.done, files: counts.files, none: counts.noImage, failed: counts.failed,
              pending: counts.pending + counts.running, total: counts.total,
            })}
          </Typography>
          {landedCount != null && (
            <Typography variant="caption" color="text.secondary" data-testid="landed-summary">
              {tx('{n} of these files are in the media library folder “{f}”.', { n: landedCount, f: folder })}
            </Typography>
          )}
          {runState && (
            <Typography variant="caption" color="text.secondary" sx={{ display: 'block' }}>
              {tx('Run: {s}', { s: tx(`status:${runState}`) })}
            </Typography>
          )}
        </Box>
      )}

      {rows.length > 0 && (
        <Box sx={{ maxHeight: 260, overflow: 'auto', border: '1px solid', borderColor: 'divider', borderRadius: 1 }}>
          <Box component="table" data-testid="download-points" sx={{ width: '100%', borderCollapse: 'collapse', fontSize: 12, '& td, & th': { borderBottom: '1px solid', borderColor: 'divider', p: 0.5, textAlign: 'left' } }}>
            <thead><tr><th>#</th><th>{tx('Status')}</th><th>{tx('Pano id')}</th><th>{tx('Files')}</th><th>{tx('Error')}</th></tr></thead>
            <tbody>
              {rows.map((p) => {
                const it = items[p.id];
                const idx = points.indexOf(p);
                const inLib = landed ? (it.keys || []).filter((k) => landed.has(k)).length : null;
                return (
                  <tr key={p.id}>
                    <td>{idx + 1}</td>
                    <td><Chip size="small" color={STATUS_COLOR[it.status] || 'default'} label={tx(`item:${it.status}`)} /></td>
                    <td style={{ maxWidth: 140, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{it.pano_id || it.panoId || '—'}</td>
                    <td>{(it.keys || []).length}{inLib != null && (it.keys || []).length ? ` (${inLib} ✓)` : ''}</td>
                    <td style={{ color: '#c62828' }}>{it.error || ''}</td>
                  </tr>
                );
              })}
            </tbody>
          </Box>
        </Box>
      )}

      <Box>
        <Typography variant="subtitle2">{tx('Fallback: one command, no browser')}</Typography>
        <Typography variant="caption" color="text.secondary" sx={{ display: 'block', mb: 0.5 }}>
          {tx('Downloads this project’s saved point list with the options above; signs in through your browser the first time.')}
        </Typography>
        <CopyLine text={runCommand({ projectId: projectId || '<project-id>', apiBase, capture: { ...capture, folder } })} label={tx('Copy')} />
      </Box>
    </Stack>
  );
}
