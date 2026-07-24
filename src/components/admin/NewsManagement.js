import React, { useCallback, useEffect, useMemo, useState } from 'react';
import {
  Alert, Box, Button, Chip, Dialog, DialogActions, DialogContent, DialogTitle,
  FormControl, IconButton, InputLabel, Link, MenuItem, Paper, Select,
  Snackbar, Stack, Table, TableBody, TableCell, TableContainer, TableHead,
  TableRow, TextField, Tooltip, Typography, CircularProgress,
} from '@mui/material';
import { Add, Delete, Edit, OpenInNew, Refresh } from '@mui/icons-material';
import ConfirmDialog from '../layout/ConfirmDialog';
import {
  NEWS_STATUSES,
  deleteNewsPost,
  listAllNewsPosts,
  slugifyNewsTitle,
  updateNewsPostStatus,
  upsertNewsPost,
} from '../../lib/newsPostStore';

const STATUS_META = {
  draft: { label: '草稿', color: 'default' },
  published: { label: '已发布', color: 'success' },
  archived: { label: '已归档', color: 'warning' },
};

const EMPTY_FORM = {
  id: null,
  slug: '',
  titleEn: '',
  titleZh: '',
  summaryEn: '',
  summaryZh: '',
  bodyEn: '',
  bodyZh: '',
  coverUrl: '',
  status: 'draft',
};

function formatWhen(iso) {
  if (!iso) return '—';
  try {
    return new Date(iso).toLocaleString('zh-CN');
  } catch {
    return iso;
  }
}

export default function NewsManagement() {
  const [rows, setRows] = useState([]);
  const [loading, setLoading] = useState(true);
  const [filter, setFilter] = useState('all');
  const [missingTable, setMissingTable] = useState(false);
  const [loadError, setLoadError] = useState('');
  const [snack, setSnack] = useState({ open: false, msg: '', sev: 'success' });
  const [formOpen, setFormOpen] = useState(false);
  const [form, setForm] = useState(EMPTY_FORM);
  const [saving, setSaving] = useState(false);
  const [confirmDialog, setConfirmDialog] = useState(null);

  const showSnack = (msg, sev = 'success') => setSnack({ open: true, msg, sev });

  const load = useCallback(async () => {
    setLoading(true);
    setLoadError('');
    setMissingTable(false);
    try {
      const list = await listAllNewsPosts();
      setRows(list);
    } catch (err) {
      setRows([]);
      if (err?.missingTable) setMissingTable(true);
      else setLoadError(err.message || String(err));
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
    const c = { all: rows.length, draft: 0, published: 0, archived: 0 };
    rows.forEach((r) => { if (c[r.status] != null) c[r.status] += 1; });
    return c;
  }, [rows]);

  const openCreate = () => {
    setForm({ ...EMPTY_FORM });
    setFormOpen(true);
  };

  const openEdit = (row) => {
    setForm({
      id: row.id,
      slug: row.slug || '',
      titleEn: row.titleEn || '',
      titleZh: row.titleZh || '',
      summaryEn: row.summaryEn || '',
      summaryZh: row.summaryZh || '',
      bodyEn: row.bodyEn || '',
      bodyZh: row.bodyZh || '',
      coverUrl: row.coverUrl || '',
      status: row.status || 'draft',
    });
    setFormOpen(true);
  };

  const setField = (key, value) => setForm((prev) => ({ ...prev, [key]: value }));

  const handleSave = async () => {
    setSaving(true);
    try {
      const prev = form.id ? rows.find((r) => r.id === form.id) : null;
      const saved = await upsertNewsPost({
        ...form,
        clearPublishedAt: form.status !== 'published',
        forcePublishedAt: form.status === 'published' && prev?.status !== 'published',
        publishedAt: form.status === 'published' ? (prev?.publishedAt || undefined) : undefined,
      });
      setRows((prev) => {
        const others = prev.filter((r) => r.id !== saved.id);
        return [saved, ...others].sort(
          (a, b) => new Date(b.updatedAt || 0) - new Date(a.updatedAt || 0),
        );
      });
      setFormOpen(false);
      showSnack(form.id ? '已保存' : '已创建');
    } catch (err) {
      showSnack(err.message || String(err), 'error');
    } finally {
      setSaving(false);
    }
  };

  const handleStatus = async (id, status) => {
    try {
      const updated = await updateNewsPostStatus(id, status);
      setRows((prev) => prev.map((r) => (r.id === id ? { ...r, ...updated } : r)));
      showSnack(`已更新为「${STATUS_META[status]?.label || status}」`);
    } catch (err) {
      showSnack(err.message || String(err), 'error');
    }
  };

  const handleDelete = (row) => {
    setConfirmDialog({
      title: '删除新闻',
      message: `永久删除「${row.titleEn}」？此操作不可撤销。`,
      confirmLabel: '删除',
      confirmColor: 'error',
      onConfirm: async () => {
        setConfirmDialog(null);
        try {
          await deleteNewsPost(row.id);
          setRows((prev) => prev.filter((r) => r.id !== row.id));
          showSnack('已删除');
        } catch (err) {
          showSnack(err.message || String(err), 'error');
        }
      },
    });
  };

  return (
    <Box>
      <Stack direction="row" spacing={2} sx={{ mb: 2 }} alignItems="center" flexWrap="wrap" useFlexGap>
        <Typography variant="h6">News</Typography>
        <FormControl size="small" sx={{ minWidth: 160 }}>
          <InputLabel>筛选</InputLabel>
          <Select value={filter} label="筛选" onChange={(e) => setFilter(e.target.value)}>
            <MenuItem value="all">全部 ({counts.all})</MenuItem>
            {NEWS_STATUSES.map((s) => (
              <MenuItem key={s} value={s}>
                {STATUS_META[s].label} ({counts[s]})
              </MenuItem>
            ))}
          </Select>
        </FormControl>
        <Box flex={1} />
        <Button startIcon={<Refresh />} onClick={load} disabled={loading}>刷新</Button>
        <Button variant="contained" startIcon={<Add />} onClick={openCreate} disabled={missingTable}>
          新建
        </Button>
      </Stack>

      {missingTable && (
        <Alert severity="warning" sx={{ mb: 2 }}>
          尚未创建表 <code>news_posts</code>。请在 Supabase SQL Editor 运行
          {' '}
          <code>supabase/news_posts.sql</code>
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
                <TableCell>标题</TableCell>
                <TableCell>Slug</TableCell>
                <TableCell>发布时间</TableCell>
                <TableCell align="center">状态</TableCell>
                <TableCell align="center">操作</TableCell>
              </TableRow>
            </TableHead>
            <TableBody>
              {!missingTable && filtered.length === 0 && (
                <TableRow>
                  <TableCell colSpan={5} align="center" sx={{ py: 4, color: 'text.secondary' }}>
                    暂无新闻
                  </TableCell>
                </TableRow>
              )}
              {filtered.map((row) => {
                const meta = STATUS_META[row.status] || STATUS_META.draft;
                return (
                  <TableRow key={row.id} hover>
                    <TableCell sx={{ maxWidth: 320 }}>
                      <Typography variant="body2" fontWeight={600} noWrap title={row.titleEn}>
                        {row.titleEn}
                      </Typography>
                      {row.titleZh && (
                        <Typography variant="caption" color="text.secondary" noWrap display="block">
                          {row.titleZh}
                        </Typography>
                      )}
                    </TableCell>
                    <TableCell>
                      <Typography variant="caption" sx={{ fontFamily: 'monospace' }}>
                        {row.slug}
                      </Typography>
                    </TableCell>
                    <TableCell>{formatWhen(row.publishedAt || row.createdAt)}</TableCell>
                    <TableCell align="center">
                      <Chip size="small" label={meta.label} color={meta.color} />
                    </TableCell>
                    <TableCell align="center">
                      <Stack direction="row" spacing={0.5} justifyContent="center">
                        <Tooltip title="编辑">
                          <IconButton size="small" onClick={() => openEdit(row)}>
                            <Edit fontSize="small" />
                          </IconButton>
                        </Tooltip>
                        {row.status === 'published' && (
                          <Tooltip title="前台查看">
                            <IconButton
                              size="small"
                              component={Link}
                              href={`/news/${encodeURIComponent(row.slug)}`}
                              target="_blank"
                              rel="noopener noreferrer"
                            >
                              <OpenInNew fontSize="small" />
                            </IconButton>
                          </Tooltip>
                        )}
                        {row.status !== 'published' && (
                          <Button size="small" onClick={() => handleStatus(row.id, 'published')}>
                            发布
                          </Button>
                        )}
                        {row.status === 'published' && (
                          <Button size="small" onClick={() => handleStatus(row.id, 'archived')}>
                            归档
                          </Button>
                        )}
                        <Tooltip title="删除">
                          <IconButton size="small" color="error" onClick={() => handleDelete(row)}>
                            <Delete fontSize="small" />
                          </IconButton>
                        </Tooltip>
                      </Stack>
                    </TableCell>
                  </TableRow>
                );
              })}
            </TableBody>
          </Table>
        </TableContainer>
      )}

      <Dialog open={formOpen} onClose={() => !saving && setFormOpen(false)} fullWidth maxWidth="md">
        <DialogTitle>{form.id ? '编辑新闻' : '新建新闻'}</DialogTitle>
        <DialogContent dividers>
          <Stack spacing={2} sx={{ pt: 1 }}>
            <TextField
              label="标题（英文）"
              required
              fullWidth
              value={form.titleEn}
              onChange={(e) => {
                const titleEn = e.target.value;
                setForm((prev) => ({
                  ...prev,
                  titleEn,
                  slug: prev.id ? prev.slug : slugifyNewsTitle(titleEn),
                }));
              }}
            />
            <TextField
              label="标题（中文）"
              fullWidth
              value={form.titleZh}
              onChange={(e) => setField('titleZh', e.target.value)}
            />
            <TextField
              label="Slug（URL）"
              fullWidth
              helperText="前台路径：/news/<slug>"
              value={form.slug}
              onChange={(e) => setField('slug', e.target.value)}
              InputProps={{ sx: { fontFamily: 'monospace' } }}
            />
            <FormControl fullWidth size="small">
              <InputLabel>状态</InputLabel>
              <Select
                label="状态"
                value={form.status}
                onChange={(e) => setField('status', e.target.value)}
              >
                {NEWS_STATUSES.map((s) => (
                  <MenuItem key={s} value={s}>{STATUS_META[s].label}</MenuItem>
                ))}
              </Select>
            </FormControl>
            <TextField
              label="摘要（英文）"
              fullWidth
              multiline
              minRows={2}
              value={form.summaryEn}
              onChange={(e) => setField('summaryEn', e.target.value)}
            />
            <TextField
              label="摘要（中文）"
              fullWidth
              multiline
              minRows={2}
              value={form.summaryZh}
              onChange={(e) => setField('summaryZh', e.target.value)}
            />
            <TextField
              label="正文（英文）"
              fullWidth
              multiline
              minRows={6}
              value={form.bodyEn}
              onChange={(e) => setField('bodyEn', e.target.value)}
              helperText="纯文本，换行会保留显示"
            />
            <TextField
              label="正文（中文）"
              fullWidth
              multiline
              minRows={6}
              value={form.bodyZh}
              onChange={(e) => setField('bodyZh', e.target.value)}
            />
            <TextField
              label="封面图 URL（可选）"
              fullWidth
              value={form.coverUrl}
              onChange={(e) => setField('coverUrl', e.target.value)}
              placeholder="https://…"
            />
          </Stack>
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setFormOpen(false)} disabled={saving}>取消</Button>
          <Button variant="contained" onClick={handleSave} disabled={saving || !form.titleEn.trim()}>
            {saving ? '保存中…' : '保存'}
          </Button>
        </DialogActions>
      </Dialog>

      <ConfirmDialog
        open={!!confirmDialog}
        title={confirmDialog?.title}
        message={confirmDialog?.message}
        confirmLabel={confirmDialog?.confirmLabel}
        confirmColor={confirmDialog?.confirmColor}
        onConfirm={confirmDialog?.onConfirm}
        onCancel={() => setConfirmDialog(null)}
      />

      <Snackbar
        open={snack.open}
        autoHideDuration={3000}
        onClose={() => setSnack((s) => ({ ...s, open: false }))}
        message={snack.msg}
      />
    </Box>
  );
}
