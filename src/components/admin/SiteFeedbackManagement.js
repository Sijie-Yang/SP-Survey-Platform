import React, { useCallback, useEffect, useMemo, useState } from 'react';
import {
  Alert, Box, Button, Chip, CircularProgress, Dialog, DialogActions, DialogContent,
  DialogTitle, IconButton, MenuItem, Paper, Select, Snackbar, Stack, Table, TableBody,
  TableCell, TableContainer, TableHead, TableRow, TextField, Tooltip, Typography,
} from '@mui/material';
import { Delete, FileDownload, Refresh, Visibility } from '@mui/icons-material';
import ConfirmDialog from '../layout/ConfirmDialog';
import {
  FEEDBACK_STATUSES, deleteSiteFeedback, listSiteFeedback, updateSiteFeedback,
} from '../../lib/siteFeedback';

const STATUS_META = {
  new: { label: '新', color: 'warning' },
  read: { label: '已读', color: 'info' },
  planned: { label: '计划做', color: 'secondary' },
  done: { label: '已完成', color: 'success' },
  archived: { label: '归档', color: 'default' },
};

const CATEGORY_LABEL = {
  suggestion: '建议',
  feature: '功能',
  bug: '问题',
  other: '其他',
};

function formatWhen(iso) {
  if (!iso) return '—';
  try {
    return new Date(iso).toLocaleString('zh-CN');
  } catch {
    return iso;
  }
}

function contactSummary(row) {
  return [
    row.contactName,
    row.contactEmail,
    row.contactWechat && `微信 ${row.contactWechat}`,
    row.contactOther,
  ].filter(Boolean).join(' · ');
}

function csvCell(value) {
  const s = String(value ?? '');
  return /[",\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

export function feedbackToCsv(rows) {
  const header = ['created_at', 'status', 'category', 'message', 'account_email', 'contact_name',
    'contact_email', 'contact_wechat', 'contact_other', 'admin_note', 'page_url', 'language'];
  const lines = rows.map((r) => [r.createdAt, r.status, r.category, r.message, r.userEmail, r.contactName,
    r.contactEmail, r.contactWechat, r.contactOther, r.adminNote, r.pageUrl, r.language].map(csvCell).join(','));
  return [header.join(','), ...lines].join('\n');
}

export default function SiteFeedbackManagement() {
  const [rows, setRows] = useState([]);
  const [loading, setLoading] = useState(true);
  const [filter, setFilter] = useState('open');
  const [missingTable, setMissingTable] = useState(false);
  const [loadError, setLoadError] = useState('');
  const [snack, setSnack] = useState({ open: false, msg: '', sev: 'success' });
  const [detail, setDetail] = useState(null);
  const [adminNote, setAdminNote] = useState('');
  const [savingNote, setSavingNote] = useState(false);
  const [confirmDialog, setConfirmDialog] = useState(null);

  const showSnack = (msg, sev = 'success') => setSnack({ open: true, msg, sev });

  const load = useCallback(async () => {
    setLoading(true);
    setLoadError('');
    setMissingTable(false);
    try {
      setRows(await listSiteFeedback());
    } catch (err) {
      setRows([]);
      if (err?.missingTable) setMissingTable(true);
      else setLoadError(err.message || String(err));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { load(); }, [load]);

  const counts = useMemo(() => {
    const c = { all: rows.length, open: 0 };
    FEEDBACK_STATUSES.forEach((s) => { c[s] = 0; });
    rows.forEach((r) => {
      if (c[r.status] != null) c[r.status] += 1;
      if (r.status !== 'done' && r.status !== 'archived') c.open += 1;
    });
    return c;
  }, [rows]);

  const filtered = useMemo(() => {
    if (filter === 'all') return rows;
    if (filter === 'open') return rows.filter((r) => r.status !== 'done' && r.status !== 'archived');
    return rows.filter((r) => r.status === filter);
  }, [rows, filter]);

  const applyUpdate = (id, updated) => {
    setRows((prev) => prev.map((r) => (r.id === id ? { ...r, ...updated } : r)));
    setDetail((d) => (d?.id === id ? { ...d, ...updated } : d));
  };

  const handleStatus = async (id, status, { quiet = false } = {}) => {
    try {
      applyUpdate(id, await updateSiteFeedback(id, { status }));
      if (!quiet) showSnack(`已标记为「${STATUS_META[status]?.label || status}」`);
    } catch (err) {
      showSnack(err.message || String(err), 'error');
    }
  };

  const openDetail = (row) => {
    setDetail(row);
    setAdminNote(row.adminNote || '');
    // Opening a new item counts as reading it.
    if (row.status === 'new') handleStatus(row.id, 'read', { quiet: true });
  };

  const handleSaveNote = async () => {
    if (!detail) return;
    setSavingNote(true);
    try {
      applyUpdate(detail.id, await updateSiteFeedback(detail.id, { adminNote }));
      showSnack('备注已保存');
    } catch (err) {
      showSnack(err.message || String(err), 'error');
    } finally {
      setSavingNote(false);
    }
  };

  const handleDelete = (row) => {
    setConfirmDialog({
      title: '删除建议',
      message: '永久删除这条建议？删除后无法恢复。',
      confirmLabel: '删除',
      confirmColor: 'error',
      onConfirm: async () => {
        setConfirmDialog(null);
        try {
          await deleteSiteFeedback(row.id);
          setRows((prev) => prev.filter((r) => r.id !== row.id));
          if (detail?.id === row.id) setDetail(null);
          showSnack('已删除');
        } catch (err) {
          showSnack(err.message || String(err), 'error');
        }
      },
    });
  };

  const handleExport = () => {
    const blob = new Blob([`﻿${feedbackToCsv(filtered)}`], { type: 'text/csv;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `sp-survey-feedback-${new Date().toISOString().slice(0, 10)}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  };

  const filterOptions = [
    ['open', '未处理'],
    ['all', '全部'],
    ...FEEDBACK_STATUSES.map((s) => [s, STATUS_META[s].label]),
  ];

  return (
    <Box>
      <Stack direction={{ xs: 'column', sm: 'row' }} spacing={1.5} alignItems={{ sm: 'center' }} sx={{ mb: 2 }}>
        <Box sx={{ flex: 1 }}>
          <Typography variant="h6" fontWeight={700}>用户建议</Typography>
          <Typography variant="body2" color="text.secondary">
            首页右下角「提建议」收到的内容。登录用户会显示账号邮箱，未登录显示为匿名。
          </Typography>
        </Box>
        <Stack direction="row" spacing={1} alignItems="center">
          <Select size="small" value={filter} onChange={(e) => setFilter(e.target.value)} sx={{ minWidth: 140 }}>
            {filterOptions.map(([value, label]) => (
              <MenuItem key={value} value={value}>{`${label}（${counts[value] ?? 0}）`}</MenuItem>
            ))}
          </Select>
          <Button size="small" startIcon={<FileDownload />} onClick={handleExport} disabled={!filtered.length}>导出 CSV</Button>
          <Tooltip title="刷新">
            <IconButton onClick={load} size="small"><Refresh /></IconButton>
          </Tooltip>
        </Stack>
      </Stack>

      {missingTable && (
        <Alert severity="warning" sx={{ mb: 2 }}>
          还没有建议表。请在 Supabase SQL Editor 运行 <code>supabase/site_feedback.sql</code>，然后刷新。
        </Alert>
      )}
      {loadError && <Alert severity="error" sx={{ mb: 2 }}>{loadError}</Alert>}

      {loading ? (
        <Box sx={{ textAlign: 'center', py: 6 }}><CircularProgress /></Box>
      ) : !missingTable && filtered.length === 0 ? (
        <Paper variant="outlined" sx={{ p: 4, textAlign: 'center' }}>
          <Typography color="text.secondary">暂无建议</Typography>
        </Paper>
      ) : !missingTable && (
        <TableContainer component={Paper} variant="outlined">
          <Table size="small">
            <TableHead>
              <TableRow>
                <TableCell sx={{ whiteSpace: 'nowrap' }}>时间</TableCell>
                <TableCell>类型</TableCell>
                <TableCell>内容</TableCell>
                <TableCell>提交者</TableCell>
                <TableCell>联系方式</TableCell>
                <TableCell>状态</TableCell>
                <TableCell align="right">操作</TableCell>
              </TableRow>
            </TableHead>
            <TableBody>
              {filtered.map((row) => (
                <TableRow key={row.id} hover sx={row.status === 'new' ? { bgcolor: 'action.hover' } : undefined}>
                  <TableCell sx={{ whiteSpace: 'nowrap' }}>{formatWhen(row.createdAt)}</TableCell>
                  <TableCell><Chip size="small" variant="outlined" label={CATEGORY_LABEL[row.category] || row.category} /></TableCell>
                  <TableCell sx={{ maxWidth: 420 }}>
                    <Typography
                      variant="body2"
                      onClick={() => openDetail(row)}
                      sx={{ cursor: 'pointer', fontWeight: row.status === 'new' ? 700 : 400, display: '-webkit-box', WebkitLineClamp: 2, WebkitBoxOrient: 'vertical', overflow: 'hidden', whiteSpace: 'pre-wrap' }}
                    >
                      {row.message}
                    </Typography>
                  </TableCell>
                  <TableCell sx={{ whiteSpace: 'nowrap' }}>
                    {row.userEmail || <Typography variant="body2" color="text.secondary" component="span">匿名</Typography>}
                  </TableCell>
                  <TableCell sx={{ maxWidth: 220 }}>
                    <Typography variant="body2" sx={{ wordBreak: 'break-all' }}>{contactSummary(row) || '—'}</Typography>
                  </TableCell>
                  <TableCell>
                    <Select
                      size="small"
                      variant="standard"
                      value={row.status}
                      onChange={(e) => handleStatus(row.id, e.target.value)}
                      renderValue={(v) => <Chip size="small" label={STATUS_META[v]?.label || v} color={STATUS_META[v]?.color || 'default'} />}
                      disableUnderline
                    >
                      {FEEDBACK_STATUSES.map((s) => <MenuItem key={s} value={s}>{STATUS_META[s].label}</MenuItem>)}
                    </Select>
                  </TableCell>
                  <TableCell align="right" sx={{ whiteSpace: 'nowrap' }}>
                    <Tooltip title="查看"><IconButton size="small" onClick={() => openDetail(row)}><Visibility fontSize="small" /></IconButton></Tooltip>
                    <Tooltip title="删除"><IconButton size="small" color="error" onClick={() => handleDelete(row)}><Delete fontSize="small" /></IconButton></Tooltip>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </TableContainer>
      )}

      <Dialog open={Boolean(detail)} onClose={() => setDetail(null)} maxWidth="sm" fullWidth>
        {detail && (
          <>
            <DialogTitle>
              {CATEGORY_LABEL[detail.category] || detail.category} · {formatWhen(detail.createdAt)}
            </DialogTitle>
            <DialogContent dividers>
              <Typography sx={{ whiteSpace: 'pre-wrap', wordBreak: 'break-word', mb: 2 }}>{detail.message}</Typography>
              <Stack spacing={0.5} sx={{ mb: 2 }}>
                <Typography variant="body2"><b>提交者：</b>{detail.userEmail || '匿名'}</Typography>
                {detail.contactName && <Typography variant="body2"><b>称呼：</b>{detail.contactName}</Typography>}
                {detail.contactEmail && <Typography variant="body2"><b>邮箱：</b>{detail.contactEmail}</Typography>}
                {detail.contactWechat && <Typography variant="body2"><b>微信：</b>{detail.contactWechat}</Typography>}
                {detail.contactOther && <Typography variant="body2"><b>其他：</b>{detail.contactOther}</Typography>}
                {detail.pageUrl && <Typography variant="body2" sx={{ wordBreak: 'break-all' }}><b>页面：</b>{detail.pageUrl}</Typography>}
                {detail.language && <Typography variant="body2"><b>界面语言：</b>{detail.language}</Typography>}
                {detail.userAgent && <Typography variant="caption" color="text.secondary" sx={{ wordBreak: 'break-all' }}>{detail.userAgent}</Typography>}
              </Stack>
              <Stack direction="row" spacing={1} alignItems="center" sx={{ mb: 2 }}>
                <Typography variant="body2"><b>状态：</b></Typography>
                <Select size="small" value={detail.status} onChange={(e) => handleStatus(detail.id, e.target.value)}>
                  {FEEDBACK_STATUSES.map((s) => <MenuItem key={s} value={s}>{STATUS_META[s].label}</MenuItem>)}
                </Select>
              </Stack>
              <TextField
                label="内部备注（只有管理员能看到）"
                multiline
                minRows={2}
                fullWidth
                value={adminNote}
                onChange={(e) => setAdminNote(e.target.value)}
                inputProps={{ maxLength: 4000 }}
              />
            </DialogContent>
            <DialogActions>
              <Button color="error" onClick={() => handleDelete(detail)}>删除</Button>
              <Box sx={{ flex: 1 }} />
              <Button onClick={handleSaveNote} disabled={savingNote || adminNote === (detail.adminNote || '')}>保存备注</Button>
              <Button variant="contained" onClick={() => setDetail(null)}>关闭</Button>
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
