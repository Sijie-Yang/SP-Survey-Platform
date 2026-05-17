import React, { useState, useEffect, useCallback } from 'react';
import {
  Box, Container, Typography, AppBar, Toolbar, Tabs, Tab, Paper,
  Table, TableBody, TableCell, TableContainer, TableHead, TableRow,
  Button, IconButton, Chip, Dialog, DialogTitle, DialogContent,
  DialogActions, TextField, Switch, Alert, Snackbar,
  CircularProgress, Tooltip, Stack, Select, MenuItem, FormControl, InputLabel,
} from '@mui/material';
import {
  Delete, Edit, ArrowBack, Refresh, CloudUpload, Home, Preview,
  EditNote,
} from '@mui/icons-material';
import { useNavigate } from 'react-router-dom';
import {
  listAllTemplates, updateTemplate, deleteTemplate,
  listAllProjects, seedBuiltinTemplates, checkIsAdmin,
} from '../lib/templateManager';
import SurveyPreview from '../components/admin/SurveyPreview';
import SurveyBuilder from '../components/admin/SurveyBuilder';

// ─── Edit Template Dialog ────────────────────────────────────────────────────

function EditTemplateDialog({ template, open, onClose, onSaved }) {
  const [form, setForm] = useState({});
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => {
    if (template) {
      setForm({
        name:        template.name        || '',
        description: template.description || '',
        author:      template.author      || '',
        year:        template.year        || '',
        category:    template.category    || '',
        tags:        (template.tags || []).join(', '),
        paper_url:   template.website     || '',
      });
    }
  }, [template]);

  const handleSave = async () => {
    setSaving(true);
    setError('');
    try {
      await updateTemplate(template.id, {
        name:        form.name,
        description: form.description,
        author:      form.author,
        year:        form.year,
        category:    form.category,
        tags:        form.tags.split(',').map(t => t.trim()).filter(Boolean),
        paper_url:   form.paper_url,
      });
      onSaved();
      onClose();
    } catch (err) {
      setError(err.message);
    } finally {
      setSaving(false);
    }
  };

  if (!template) return null;
  return (
    <Dialog open={open} onClose={onClose} maxWidth="sm" fullWidth>
      <DialogTitle>编辑模板: {template.name}</DialogTitle>
      <DialogContent>
        {error && <Alert severity="error" sx={{ mb: 2 }}>{error}</Alert>}
        <Stack spacing={2} sx={{ mt: 1 }}>
          {[
            { label: '名称', key: 'name' },
            { label: '描述', key: 'description', multiline: true, rows: 3 },
            { label: '作者', key: 'author' },
            { label: '年份', key: 'year' },
            { label: '标签 (逗号分隔)', key: 'tags' },
            { label: '论文链接', key: 'paper_url' },
          ].map(({ label, key, multiline, rows }) => (
            <TextField
              key={key}
              label={label}
              value={form[key] || ''}
              onChange={e => setForm(f => ({ ...f, [key]: e.target.value }))}
              fullWidth
              size="small"
              multiline={multiline}
              rows={rows}
            />
          ))}
          <FormControl fullWidth size="small">
            <InputLabel>分类</InputLabel>
            <Select
              value={form.category || ''}
              onChange={e => setForm(f => ({ ...f, category: e.target.value }))}
              label="分类"
            >
              <MenuItem value="">None</MenuItem>
              <MenuItem value="Academic Research">Academic Research</MenuItem>
              <MenuItem value="Urban Theory">Urban Theory</MenuItem>
              <MenuItem value="AI Template">AI Template</MenuItem>
            </Select>
          </FormControl>
        </Stack>
      </DialogContent>
      <DialogActions>
        <Button onClick={onClose} disabled={saving}>取消</Button>
        <Button onClick={handleSave} variant="contained" disabled={saving}>
          {saving ? <CircularProgress size={18} /> : '保存'}
        </Button>
      </DialogActions>
    </Dialog>
  );
}

// ─── Survey Builder Editor Dialog ───────────────────────────────────────────

function SurveyBuilderDialog({ template, open, onClose, onSaved }) {
  const [draftConfig, setDraftConfig] = useState(null);
  const [saving, setSaving]           = useState(false);
  const [error, setError]             = useState('');

  useEffect(() => {
    if (template && open) {
      setDraftConfig(JSON.parse(JSON.stringify(template.config || {})));
      setError('');
    }
  }, [template, open]);

  const handleSave = async () => {
    if (!draftConfig) return;
    setSaving(true);
    setError('');
    try {
      await updateTemplate(template.id, { survey_config: draftConfig });
      onSaved();
      onClose();
    } catch (err) {
      setError(err.message);
    } finally {
      setSaving(false);
    }
  };

  if (!template) return null;

  const fakeProject = { id: `tpl-${template.id}`, name: template.name };

  return (
    <Dialog open={open} onClose={onClose} fullScreen>
      <AppBar position="static" color="default" elevation={1}
        sx={{ flexShrink: 0 }}>
        <Toolbar>
          <IconButton edge="start" onClick={onClose} sx={{ mr: 1 }}>
            <ArrowBack />
          </IconButton>
          <Typography variant="h6" sx={{ flex: 1 }}>
            编辑调查内容 — {template.name}
          </Typography>
          {error && (
            <Alert severity="error" sx={{ mr: 2, py: 0 }}>{error}</Alert>
          )}
          <Button onClick={onClose} sx={{ mr: 1 }}>取消</Button>
          <Button variant="contained" onClick={handleSave} disabled={saving}>
            {saving ? <CircularProgress size={18} /> : '保存'}
          </Button>
        </Toolbar>
      </AppBar>
      <Box sx={{ flex: 1, overflow: 'auto' }}>
        {draftConfig && (
          <SurveyBuilder
            key={template.id}
            config={draftConfig}
            onChange={setDraftConfig}
            currentProject={fakeProject}
            onNextStep={null}
          />
        )}
      </Box>
    </Dialog>
  );
}

// ─── Survey Preview Dialog ───────────────────────────────────────────────────

function SurveyPreviewDialog({ template, open, onClose }) {
  if (!template) return null;
  return (
    <Dialog open={open} onClose={onClose} maxWidth="lg" fullWidth
      PaperProps={{ sx: { height: '90vh' } }}>
      <DialogTitle>
        预览模板 — {template.name}
        <Typography variant="caption" color="text.secondary" sx={{ ml: 1 }}>
          (只读)
        </Typography>
      </DialogTitle>
      <DialogContent sx={{ p: 0, overflow: 'auto' }}>
        <SurveyPreview config={template.config} currentProject={null} />
      </DialogContent>
      <DialogActions>
        <Button onClick={onClose}>关闭</Button>
      </DialogActions>
    </Dialog>
  );
}

// ─── Template Management Tab ─────────────────────────────────────────────────

function TemplateManagement() {
  const [templates, setTemplates]         = useState([]);
  const [loading, setLoading]             = useState(false);
  const [editTarget, setEditTarget]       = useState(null);
  const [editOpen, setEditOpen]           = useState(false);
  const [configTarget, setConfigTarget]   = useState(null);
  const [configOpen, setConfigOpen]       = useState(false);
  const [previewTarget, setPreviewTarget] = useState(null);
  const [previewOpen, setPreviewOpen]     = useState(false);
  const [snack, setSnack]                 = useState({ open: false, msg: '', sev: 'success' });
  const [seeding, setSeeding]             = useState(false);
  const [seedLog, setSeedLog]             = useState('');

  const showSnack = (msg, sev = 'success') => setSnack({ open: true, msg, sev });

  const load = useCallback(async () => {
    setLoading(true);
    const data = await listAllTemplates();
    setTemplates(data);
    setLoading(false);
  }, []);

  useEffect(() => { load(); }, [load]);

  const handleApprove = async (id, value) => {
    try {
      await updateTemplate(id, { is_approved: value });
      showSnack(value ? '已批准' : '已撤销批准');
      load();
    } catch (err) {
      showSnack(err.message, 'error');
    }
  };

  const handleLanding = async (id, value) => {
    try {
      await updateTemplate(id, { show_on_landing: value });
      showSnack(value ? '已设为首页展示' : '已取消首页展示');
      load();
    } catch (err) {
      showSnack(err.message, 'error');
    }
  };

  const handleDelete = async (id, name) => {
    if (!window.confirm(`确认删除模板 "${name}" 吗？此操作不可恢复。`)) return;
    try {
      await deleteTemplate(id);
      showSnack('已删除');
      load();
    } catch (err) {
      showSnack(err.message, 'error');
    }
  };

  const handleSeed = async () => {
    setSeeding(true);
    setSeedLog('');
    try {
      const result = await seedBuiltinTemplates(({ imported, total, current }) => {
        setSeedLog(`进度: ${imported}/${total} — ${current}`);
      });
      showSnack(`导入完成: ${result.imported} 条, 跳过 ${result.skipped} 条`);
      if (result.errors.length) {
        setSeedLog('错误: ' + result.errors.join('; '));
      } else {
        setSeedLog('');
      }
      load();
    } catch (err) {
      showSnack(err.message, 'error');
    } finally {
      setSeeding(false);
    }
  };

  return (
    <Box>
      <Stack direction="row" spacing={2} sx={{ mb: 2 }} alignItems="center">
        <Typography variant="h6">模板管理</Typography>
        <Box flex={1} />
        <Tooltip title="导入本地内置模板到 Supabase">
          <Button
            variant="outlined"
            startIcon={seeding ? <CircularProgress size={16} /> : <CloudUpload />}
            onClick={handleSeed}
            disabled={seeding}
          >
            导入内置模板
          </Button>
        </Tooltip>
        <Button startIcon={<Refresh />} onClick={load} disabled={loading}>
          刷新
        </Button>
      </Stack>

      {seedLog && (
        <Alert severity="info" sx={{ mb: 2 }} onClose={() => setSeedLog('')}>
          {seedLog}
        </Alert>
      )}

      {loading ? (
        <Box sx={{ display: 'flex', justifyContent: 'center', py: 6 }}>
          <CircularProgress />
        </Box>
      ) : (
        <TableContainer component={Paper} variant="outlined">
          <Table size="small">
            <TableHead>
              <TableRow sx={{ '& th': { fontWeight: 700, bgcolor: 'grey.50' } }}>
                <TableCell>名称</TableCell>
                <TableCell>提交者</TableCell>
                <TableCell>分类</TableCell>
                <TableCell align="center">已批准</TableCell>
                <TableCell align="center">首页展示</TableCell>
                <TableCell>提交时间</TableCell>
                <TableCell align="center">操作</TableCell>
              </TableRow>
            </TableHead>
            <TableBody>
              {templates.length === 0 && (
                <TableRow>
                  <TableCell colSpan={7} align="center" sx={{ py: 4, color: 'text.secondary' }}>
                    暂无模板数据
                  </TableCell>
                </TableRow>
              )}
              {templates.map(t => (
                <TableRow key={t.id} hover>
                  <TableCell>
                    <Typography variant="body2" fontWeight={600}>{t.name}</Typography>
                    <Typography variant="caption" color="text.secondary">{t.id}</Typography>
                  </TableCell>
                  <TableCell>
                    <Typography variant="body2">{t.submitter_email || '—'}</Typography>
                  </TableCell>
                  <TableCell>
                    <Chip label={t.category} size="small" variant="outlined" />
                  </TableCell>
                  <TableCell align="center">
                    <Switch
                      size="small"
                      checked={!!t.is_approved}
                      onChange={e => handleApprove(t.id, e.target.checked)}
                      color="success"
                    />
                  </TableCell>
                  <TableCell align="center">
                    <Switch
                      size="small"
                      checked={!!t.show_on_landing}
                      onChange={e => handleLanding(t.id, e.target.checked)}
                      color="primary"
                      disabled={!t.is_approved}
                    />
                  </TableCell>
                  <TableCell>
                    <Typography variant="caption">
                      {t.createdAt ? new Date(t.createdAt).toLocaleDateString('zh-CN') : '—'}
                    </Typography>
                  </TableCell>
                  <TableCell align="center">
                    <Stack direction="row" spacing={0.5} justifyContent="center">
                      <Tooltip title="预览调查">
                        <IconButton size="small" color="primary"
                          onClick={() => { setPreviewTarget(t); setPreviewOpen(true); }}>
                          <Preview fontSize="small" />
                        </IconButton>
                      </Tooltip>
                      <Tooltip title="编辑调查内容">
                        <IconButton size="small" color="secondary"
                          onClick={() => { setConfigTarget(t); setConfigOpen(true); }}>
                          <EditNote fontSize="small" />
                        </IconButton>
                      </Tooltip>
                      <Tooltip title="编辑元数据">
                        <IconButton size="small" onClick={() => { setEditTarget(t); setEditOpen(true); }}>
                          <Edit fontSize="small" />
                        </IconButton>
                      </Tooltip>
                      <Tooltip title="删除">
                        <IconButton size="small" color="error" onClick={() => handleDelete(t.id, t.name)}>
                          <Delete fontSize="small" />
                        </IconButton>
                      </Tooltip>
                    </Stack>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </TableContainer>
      )}

      <EditTemplateDialog
        template={editTarget}
        open={editOpen}
        onClose={() => setEditOpen(false)}
        onSaved={() => { load(); showSnack('保存成功'); }}
      />

      <SurveyBuilderDialog
        template={configTarget}
        open={configOpen}
        onClose={() => setConfigOpen(false)}
        onSaved={() => { load(); showSnack('调查内容已保存'); }}
      />

      <SurveyPreviewDialog
        template={previewTarget}
        open={previewOpen}
        onClose={() => setPreviewOpen(false)}
      />

      <Snackbar
        open={snack.open}
        autoHideDuration={3000}
        onClose={() => setSnack(s => ({ ...s, open: false }))}
        anchorOrigin={{ vertical: 'bottom', horizontal: 'center' }}
      >
        <Alert severity={snack.sev} onClose={() => setSnack(s => ({ ...s, open: false }))}>
          {snack.msg}
        </Alert>
      </Snackbar>
    </Box>
  );
}

// ─── Project Overview Tab ────────────────────────────────────────────────────

function ProjectOverview() {
  const [projects, setProjects] = useState([]);
  const [loading, setLoading]  = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    const data = await listAllProjects();
    setProjects(data);
    setLoading(false);
  }, []);

  useEffect(() => { load(); }, [load]);

  return (
    <Box>
      <Stack direction="row" spacing={2} sx={{ mb: 2 }} alignItems="center">
        <Typography variant="h6">项目概览</Typography>
        <Box flex={1} />
        <Button startIcon={<Refresh />} onClick={load} disabled={loading}>
          刷新
        </Button>
      </Stack>

      {loading ? (
        <Box sx={{ display: 'flex', justifyContent: 'center', py: 6 }}>
          <CircularProgress />
        </Box>
      ) : (
        <TableContainer component={Paper} variant="outlined">
          <Table size="small">
            <TableHead>
              <TableRow sx={{ '& th': { fontWeight: 700, bgcolor: 'grey.50' } }}>
                <TableCell>项目名称</TableCell>
                <TableCell>描述</TableCell>
                <TableCell>用户 ID</TableCell>
                <TableCell>来源模板</TableCell>
                <TableCell>最后更新</TableCell>
              </TableRow>
            </TableHead>
            <TableBody>
              {projects.length === 0 && (
                <TableRow>
                  <TableCell colSpan={5} align="center" sx={{ py: 4, color: 'text.secondary' }}>
                    暂无项目数据
                  </TableCell>
                </TableRow>
              )}
              {projects.map(p => (
                <TableRow key={p.id} hover>
                  <TableCell>
                    <Typography variant="body2" fontWeight={600}>{p.name || '未命名'}</Typography>
                    <Typography variant="caption" color="text.secondary">{p.id}</Typography>
                  </TableCell>
                  <TableCell>
                    <Typography variant="body2" noWrap sx={{ maxWidth: 200 }}>
                      {p.description || '—'}
                    </Typography>
                  </TableCell>
                  <TableCell>
                    <Typography variant="caption">{p.user_id || '—'}</Typography>
                  </TableCell>
                  <TableCell>
                    <Typography variant="caption">{p.template_id || '—'}</Typography>
                  </TableCell>
                  <TableCell>
                    <Typography variant="caption">
                      {p.updated_at ? new Date(p.updated_at).toLocaleDateString('zh-CN') : '—'}
                    </Typography>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </TableContainer>
      )}
    </Box>
  );
}

// ─── Main AdminDashboard Page ────────────────────────────────────────────────

export default function AdminDashboard() {
  const navigate = useNavigate();
  const [tab, setTab]           = useState(0);
  const [checking, setChecking] = useState(true);
  const [isAdmin, setIsAdmin]   = useState(false);

  useEffect(() => {
    checkIsAdmin().then(ok => {
      setIsAdmin(ok);
      setChecking(false);
    });
  }, []);

  if (checking) {
    return (
      <Box sx={{ display: 'flex', justifyContent: 'center', alignItems: 'center', height: '100vh' }}>
        <CircularProgress />
      </Box>
    );
  }

  if (!isAdmin) {
    return (
      <Container maxWidth="sm" sx={{ mt: 8 }}>
        <Alert severity="error">
          您没有管理员权限，无法访问此页面。
        </Alert>
        <Button sx={{ mt: 2 }} startIcon={<ArrowBack />} onClick={() => navigate('/admin')}>
          返回管理面板
        </Button>
      </Container>
    );
  }

  return (
    <Box sx={{ minHeight: '100vh', bgcolor: 'grey.50' }}>
      <AppBar position="static" color="default" elevation={1}>
        <Toolbar>
          <IconButton edge="start" onClick={() => navigate('/admin')} sx={{ mr: 1 }}>
            <ArrowBack />
          </IconButton>
          <Typography variant="h6" fontWeight={700} sx={{ flex: 1 }}>
            管理后台
          </Typography>
          <IconButton onClick={() => navigate('/')} title="返回首页">
            <Home />
          </IconButton>
        </Toolbar>
        <Tabs
          value={tab}
          onChange={(_, v) => setTab(v)}
          sx={{ borderTop: 1, borderColor: 'divider', bgcolor: 'white' }}
        >
          <Tab label="模板管理" />
          <Tab label="项目概览" />
        </Tabs>
      </AppBar>

      <Container maxWidth="xl" sx={{ py: 3 }}>
        {tab === 0 && <TemplateManagement />}
        {tab === 1 && <ProjectOverview />}
      </Container>
    </Box>
  );
}
