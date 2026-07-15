import React, { useCallback, useEffect, useMemo, useState } from 'react';
import {
  Alert, Box, Button, Chip, Dialog, DialogActions, DialogContent, DialogTitle,
  FormControl, IconButton, InputLabel, Link, MenuItem, Paper, Select,
  Snackbar, Stack, Table, TableBody, TableCell, TableContainer, TableHead,
  TableRow, TextField, Tooltip, Typography, CircularProgress,
} from '@mui/material';
import {
  ContentCopy, Delete, MailOutline, OpenInNew, Refresh, Visibility,
} from '@mui/icons-material';
import ConfirmDialog from '../layout/ConfirmDialog';
import {
  SURVEY_DESIGN_STATUSES,
  deleteSurveyDesignRequest,
  listSurveyDesignRequests,
  updateSurveyDesignRequest,
} from '../../lib/surveyDesignRequestStore';

const STATUS_META = {
  pending: { label: '待处理', color: 'warning' },
  in_progress: { label: '进行中', color: 'info' },
  done: { label: '已完成', color: 'success' },
  declined: { label: '已婉拒', color: 'default' },
};

function statusChip(status) {
  const meta = STATUS_META[status] || { label: status, color: 'default' };
  return <Chip size="small" label={meta.label} color={meta.color} />;
}

function formatWhen(iso) {
  if (!iso) return '—';
  try {
    return new Date(iso).toLocaleString('zh-CN');
  } catch {
    return iso;
  }
}

export default function SurveyDesignRequestManagement() {
  const [rows, setRows] = useState([]);
  const [loading, setLoading] = useState(true);
  const [filter, setFilter] = useState('pending');
  const [missingTable, setMissingTable] = useState(false);
  const [loadError, setLoadError] = useState('');
  const [snack, setSnack] = useState({ open: false, msg: '', sev: 'success' });
  const [detail, setDetail] = useState(null);
  const [adminNotes, setAdminNotes] = useState('');
  const [savingNotes, setSavingNotes] = useState(false);
  const [confirmDialog, setConfirmDialog] = useState(null);

  const showSnack = (msg, sev = 'success') => setSnack({ open: true, msg, sev });

  const load = useCallback(async () => {
    setLoading(true);
    setLoadError('');
    setMissingTable(false);
    try {
      const list = await listSurveyDesignRequests();
      setRows(list);
    } catch (err) {
      setRows([]);
      if (err?.missingTable) {
        setMissingTable(true);
      } else {
        setLoadError(err.message || String(err));
      }
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { load(); }, [load]);

  const filtered = useMemo(() => {
    if (filter === 'all') return rows;
    return rows.filter((r) => r.status === filter);
  }, [rows, filter]);

  const counts = useMemo(() => {
    const c = { all: rows.length, pending: 0, in_progress: 0, done: 0, declined: 0 };
    rows.forEach((r) => { if (c[r.status] != null) c[r.status] += 1; });
    return c;
  }, [rows]);

  const openDetail = (row) => {
    setDetail(row);
    setAdminNotes(row.adminNotes || '');
  };

  const handleStatus = async (id, status) => {
    try {
      const updated = await updateSurveyDesignRequest(id, { status });
      setRows((prev) => prev.map((r) => (r.id === id ? { ...r, ...updated } : r)));
      if (detail?.id === id) setDetail((d) => ({ ...d, ...updated }));
      showSnack(`已更新为「${STATUS_META[status]?.label || status}」`);
    } catch (err) {
      showSnack(err.message || String(err), 'error');
    }
  };

  const handleSaveNotes = async () => {
    if (!detail) return;
    setSavingNotes(true);
    try {
      const updated = await updateSurveyDesignRequest(detail.id, { adminNotes });
      setRows((prev) => prev.map((r) => (r.id === detail.id ? { ...r, ...updated } : r)));
      setDetail((d) => ({ ...d, ...updated }));
      showSnack('备注已保存');
    } catch (err) {
      showSnack(err.message || String(err), 'error');
    } finally {
      setSavingNotes(false);
    }
  };

  const handleDelete = (row) => {
    setConfirmDialog({
      title: '删除设计请求',
      message: `永久删除「${row.studyTitle}」（${row.id}）？附件不会自动从 R2 删除。`,
      confirmLabel: '删除',
      confirmColor: 'error',
      onConfirm: async () => {
        setConfirmDialog(null);
        try {
          await deleteSurveyDesignRequest(row.id);
          setRows((prev) => prev.filter((r) => r.id !== row.id));
          if (detail?.id === row.id) setDetail(null);
          showSnack('已删除');
        } catch (err) {
          showSnack(err.message || String(err), 'error');
        }
      },
    });
  };

  const copyText = async (text, label = '已复制') => {
    try {
      await navigator.clipboard.writeText(text);
      showSnack(label);
    } catch {
      showSnack('复制失败', 'error');
    }
  };

  return (
    <Box>
      <Stack direction="row" spacing={2} sx={{ mb: 2 }} alignItems="center" flexWrap="wrap" useFlexGap>
        <Typography variant="h6">Survey Design 请求</Typography>
        <FormControl size="small" sx={{ minWidth: 160 }}>
          <InputLabel>筛选</InputLabel>
          <Select value={filter} label="筛选" onChange={(e) => setFilter(e.target.value)}>
            <MenuItem value="pending">待处理 ({counts.pending})</MenuItem>
            <MenuItem value="in_progress">进行中 ({counts.in_progress})</MenuItem>
            <MenuItem value="done">已完成 ({counts.done})</MenuItem>
            <MenuItem value="declined">已婉拒 ({counts.declined})</MenuItem>
            <MenuItem value="all">全部 ({counts.all})</MenuItem>
          </Select>
        </FormControl>
        <Box flex={1} />
        <Button startIcon={<Refresh />} onClick={load} disabled={loading}>刷新</Button>
      </Stack>

      {missingTable && (
        <Alert severity="warning" sx={{ mb: 2 }}>
          尚未创建表 <code>survey_design_requests</code>。请在 Supabase SQL Editor 运行
          {' '}
          <code>supabase/survey_design_requests.sql</code>
          ，并确认已执行过 <code>supabase/admin_projects_rls.sql</code>（需要
          {' '}
          <code>is_platform_admin()</code>
          ）。跑完后点刷新即可。
        </Alert>
      )}
      {loadError && !missingTable && (
        <Alert severity="error" sx={{ mb: 2 }}>{loadError}</Alert>
      )}

      {loading ? (
        <CircularProgress />
      ) : (
        <TableContainer component={Paper} variant="outlined">
          <Table size="small">
            <TableHead>
              <TableRow sx={{ '& th': { fontWeight: 700, bgcolor: 'grey.50' } }}>
                <TableCell>研究标题</TableCell>
                <TableCell>联系人</TableCell>
                <TableCell>刺激类型</TableCell>
                <TableCell>附件</TableCell>
                <TableCell>提交时间</TableCell>
                <TableCell align="center">状态</TableCell>
                <TableCell align="center">操作</TableCell>
              </TableRow>
            </TableHead>
            <TableBody>
              {!missingTable && filtered.length === 0 && (
                <TableRow>
                  <TableCell colSpan={7} align="center" sx={{ py: 4, color: 'text.secondary' }}>
                    暂无请求
                  </TableCell>
                </TableRow>
              )}
              {filtered.map((row) => (
                <TableRow key={row.id} hover>
                  <TableCell>
                    <Typography variant="body2" fontWeight={600}>{row.studyTitle}</Typography>
                    <Typography variant="caption" color="text.secondary" sx={{ fontFamily: 'monospace' }}>
                      {row.id}
                    </Typography>
                  </TableCell>
                  <TableCell>
                    <Typography variant="body2">{row.contactName}</Typography>
                    <Typography variant="caption" color="text.secondary" display="block">
                      {row.email}
                    </Typography>
                    {row.affiliation && (
                      <Typography variant="caption" color="text.secondary" display="block">
                        {row.affiliation}
                      </Typography>
                    )}
                  </TableCell>
                  <TableCell>
                    <Stack direction="row" spacing={0.5} flexWrap="wrap" useFlexGap>
                      {(row.stimulusTypes.length ? row.stimulusTypes : ['—']).map((t) => (
                        <Chip key={t} size="small" variant="outlined" label={t} />
                      ))}
                    </Stack>
                  </TableCell>
                  <TableCell>
                    <Typography variant="caption">
                      {row.mediaFiles.length} media · {row.supplementaryFiles.length} files
                    </Typography>
                  </TableCell>
                  <TableCell>
                    <Typography variant="caption">{formatWhen(row.createdAt)}</Typography>
                  </TableCell>
                  <TableCell align="center">{statusChip(row.status)}</TableCell>
                  <TableCell align="center">
                    <Stack direction="row" spacing={0.5} justifyContent="center" flexWrap="wrap" useFlexGap>
                      <Tooltip title="查看详情">
                        <IconButton size="small" color="primary" onClick={() => openDetail(row)}>
                          <Visibility fontSize="small" />
                        </IconButton>
                      </Tooltip>
                      <Tooltip title="发邮件">
                        <IconButton
                          size="small"
                          component="a"
                          href={`mailto:${encodeURIComponent(row.email)}?subject=${encodeURIComponent(`[SP-Survey] Re: ${row.studyTitle}`)}`}
                        >
                          <MailOutline fontSize="small" />
                        </IconButton>
                      </Tooltip>
                      {row.status === 'pending' && (
                        <Button size="small" variant="contained" onClick={() => handleStatus(row.id, 'in_progress')}>
                          接手
                        </Button>
                      )}
                      {row.status === 'in_progress' && (
                        <Button size="small" variant="contained" color="success" onClick={() => handleStatus(row.id, 'done')}>
                          完成
                        </Button>
                      )}
                      <IconButton size="small" color="error" onClick={() => handleDelete(row)}>
                        <Delete fontSize="small" />
                      </IconButton>
                    </Stack>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </TableContainer>
      )}

      <Dialog open={Boolean(detail)} onClose={() => setDetail(null)} maxWidth="md" fullWidth>
        {detail && (
          <>
            <DialogTitle>
              <Stack spacing={0.5}>
                <Typography variant="h6" fontWeight={700}>{detail.studyTitle}</Typography>
                <Stack direction="row" spacing={1} alignItems="center" flexWrap="wrap" useFlexGap>
                  {statusChip(detail.status)}
                  <Typography variant="caption" sx={{ fontFamily: 'monospace' }}>{detail.id}</Typography>
                  <Tooltip title="复制 ID">
                    <IconButton size="small" onClick={() => copyText(detail.id, 'Request ID 已复制')}>
                      <ContentCopy fontSize="inherit" />
                    </IconButton>
                  </Tooltip>
                </Stack>
              </Stack>
            </DialogTitle>
            <DialogContent dividers>
              <Stack spacing={2}>
                <Box>
                  <Typography variant="subtitle2" fontWeight={700}>联系人</Typography>
                  <Typography variant="body2">
                    {detail.contactName}
                    {' · '}
                    <Link href={`mailto:${detail.email}`}>{detail.email}</Link>
                    {detail.affiliation ? ` · ${detail.affiliation}` : ''}
                  </Typography>
                </Box>
                <Box>
                  <Typography variant="subtitle2" fontWeight={700}>Research brief</Typography>
                  <Typography variant="body2" sx={{ whiteSpace: 'pre-wrap' }}>
                    {detail.researchBrief}
                  </Typography>
                </Box>
                {(detail.timeline || detail.relatedUrl || detail.notes) && (
                  <Stack spacing={1}>
                    {detail.timeline && (
                      <Typography variant="body2"><strong>Timeline:</strong> {detail.timeline}</Typography>
                    )}
                    {detail.relatedUrl && (
                      <Typography variant="body2">
                        <strong>Related:</strong>{' '}
                        <Link href={detail.relatedUrl} target="_blank" rel="noopener noreferrer">
                          {detail.relatedUrl}
                          <OpenInNew sx={{ fontSize: 12, ml: 0.5, verticalAlign: 'middle' }} />
                        </Link>
                      </Typography>
                    )}
                    {detail.notes && (
                      <Box>
                        <Typography variant="subtitle2" fontWeight={700}>Notes</Typography>
                        <Typography variant="body2" sx={{ whiteSpace: 'pre-wrap' }}>{detail.notes}</Typography>
                      </Box>
                    )}
                  </Stack>
                )}
                <Stack direction="row" spacing={0.5} flexWrap="wrap" useFlexGap>
                  {(detail.stimulusTypes.length ? detail.stimulusTypes : []).map((t) => (
                    <Chip key={t} size="small" label={t} />
                  ))}
                </Stack>
                {(detail.mediaFiles.length > 0 || detail.supplementaryFiles.length > 0) && (
                  <Box>
                    <Typography variant="subtitle2" fontWeight={700} sx={{ mb: 0.5 }}>附件</Typography>
                    <Stack spacing={0.5}>
                      {detail.mediaFiles.map((f) => (
                        <Link key={f.key || f.url} href={f.url} target="_blank" rel="noopener noreferrer" variant="body2">
                          [{f.type || 'media'}] {f.name || f.url}
                        </Link>
                      ))}
                      {detail.supplementaryFiles.map((f) => (
                        <Link key={f.key || f.url} href={f.url} target="_blank" rel="noopener noreferrer" variant="body2">
                          [file] {f.name || f.url}
                        </Link>
                      ))}
                    </Stack>
                  </Box>
                )}
                <TextField
                  label="管理员备注（内部）"
                  fullWidth
                  multiline
                  minRows={2}
                  value={adminNotes}
                  onChange={(e) => setAdminNotes(e.target.value)}
                />
                <Typography variant="caption" color="text.secondary">
                  提交于 {formatWhen(detail.createdAt)}
                  {detail.reviewedAt ? ` · 最近处理 ${formatWhen(detail.reviewedAt)}` : ''}
                </Typography>
              </Stack>
            </DialogContent>
            <DialogActions sx={{ px: 3, py: 2, flexWrap: 'wrap', gap: 1 }}>
              <FormControl size="small" sx={{ minWidth: 140 }}>
                <InputLabel>状态</InputLabel>
                <Select
                  label="状态"
                  value={detail.status}
                  onChange={(e) => handleStatus(detail.id, e.target.value)}
                >
                  {SURVEY_DESIGN_STATUSES.map((s) => (
                    <MenuItem key={s} value={s}>{STATUS_META[s]?.label || s}</MenuItem>
                  ))}
                </Select>
              </FormControl>
              <Button onClick={handleSaveNotes} disabled={savingNotes} variant="outlined">
                {savingNotes ? '保存中…' : '保存备注'}
              </Button>
              <Box flex={1} />
              <Button color="error" onClick={() => handleDelete(detail)}>删除</Button>
              <Button onClick={() => setDetail(null)}>关闭</Button>
            </DialogActions>
          </>
        )}
      </Dialog>

      <Snackbar open={snack.open} autoHideDuration={3000} onClose={() => setSnack((x) => ({ ...x, open: false }))}>
        <Alert severity={snack.sev}>{snack.msg}</Alert>
      </Snackbar>

      <ConfirmDialog
        open={Boolean(confirmDialog)}
        title={confirmDialog?.title}
        message={confirmDialog?.message}
        confirmLabel={confirmDialog?.confirmLabel}
        confirmColor={confirmDialog?.confirmColor || 'error'}
        onConfirm={() => confirmDialog?.onConfirm?.()}
        onCancel={() => setConfirmDialog(null)}
      />
    </Box>
  );
}
