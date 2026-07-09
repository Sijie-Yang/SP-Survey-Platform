import React, { useState, useEffect, useCallback, useRef } from 'react';
import {
  Box, Container, Typography, AppBar, Toolbar, Tabs, Tab, Paper,
  Table, TableBody, TableCell, TableContainer, TableHead, TableRow,
  Button, IconButton, Chip, Dialog, DialogTitle, DialogContent,
  DialogActions, TextField, Switch, Alert, Snackbar,
  CircularProgress, Tooltip, Stack, Select, MenuItem, FormControl, InputLabel,
  LinearProgress,
} from '@mui/material';
import {
  Delete, Edit, ArrowBack, Refresh, CloudUpload, Home, Preview,
  EditNote, PhotoLibrary, DeleteForever, Videocam, Audiotrack, PermMedia,
} from '@mui/icons-material';
import { useNavigate } from 'react-router-dom';
import {
  listAllTemplates, updateTemplate, deleteTemplate,
  listAllProjects, updateProjectAdmin, deleteProjectAdmin,
  seedBuiltinTemplates, checkIsAdmin,
} from '../lib/templateManager';
import { inferMediaType, normalizeMediaEntry, MEDIA_ACCEPT } from '../lib/mediaUtils';
import { SKILL_PREVIEW_PREFIX, listSkillPreviewMedia } from '../lib/skillPreviewMedia';
import {
  listSubmittedSkills, updateSkill, deleteSkill, getSkillStatus,
} from '../lib/skillManager';
import {
  isR2Configured, uploadImageToR2, listImagesFromR2, deleteImagesFromR2,
} from '../lib/r2';
import SurveyPreview from '../components/admin/SurveyPreview';
import SurveyBuilder from '../components/admin/SurveyBuilder';

// R2 prefix used for template image folders. Stays in sync with how the
// admin dialog uploads / lists / deletes objects so a template always knows
// where its images live.
const templateImagePrefix = (templateId) => `templates/${templateId}/`;
const projectImagePrefix = (project) => `${project.user_id}/${project.id}/`;

// ─── Edit Template Dialog ────────────────────────────────────────────────────

function EditTemplateDialog({ template, open, onClose, onSaved }) {
  const [form, setForm] = useState({});
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => {
    if (template) {
      setForm({
        name:                template.name              || '',
        description:         template.description       || '',
        author:              template.author            || '',
        year:                template.year              || '',
        category:            template.category          || '',
        tags:                (template.tags || []).join(', '),
        paper_url:           template.website           || '',
        huggingface_dataset: template.huggingfaceDataset || '',
      });
    }
  }, [template]);

  const handleSave = async () => {
    setSaving(true);
    setError('');
    try {
      await updateTemplate(template.id, {
        name:                form.name,
        description:         form.description,
        author:              form.author,
        year:                form.year,
        category:            form.category,
        tags:                form.tags.split(',').map(t => t.trim()).filter(Boolean),
        paper_url:           form.paper_url,
        huggingface_dataset: form.huggingface_dataset.trim() || null,
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
            { label: 'HuggingFace Dataset', key: 'huggingface_dataset',
              placeholder: 'username/dataset-name',
              helperText: '可选，留空表示不绑定。例如 sijiey/Thermal-Affordance-Dataset',
            },
          ].map(({ label, key, multiline, rows, placeholder, helperText }) => (
            <TextField
              key={key}
              label={label}
              value={form[key] || ''}
              onChange={e => setForm(f => ({ ...f, [key]: e.target.value }))}
              fullWidth
              size="small"
              multiline={multiline}
              rows={rows}
              placeholder={placeholder}
              helperText={helperText}
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

  // Surface the template's image folder to SurveyBuilder/SurveyPreview as if
  // it were a regular project so admins can iterate against real images.
  const fakeProject = {
    id: `tpl-${template.id}`,
    name: template.name,
    preloadedImages: Array.isArray(template.preloadedImages) ? template.preloadedImages : [],
  };

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
  // SurveyPreview already knows how to randomly draw from preloadedImages on
  // currentProject. We synthesise a minimal project-shaped object so the
  // template's own image folder is used in preview, just like a real project.
  const previewProject = {
    id: `tpl-${template.id}`,
    name: template.name,
    preloadedImages: Array.isArray(template.preloadedImages) ? template.preloadedImages : [],
  };
  return (
    <Dialog open={open} onClose={onClose} maxWidth="lg" fullWidth
      PaperProps={{ sx: { height: '90vh' } }}>
      <DialogTitle>
        预览模板 — {template.name}
        <Typography variant="caption" color="text.secondary" sx={{ ml: 1 }}>
          (只读 · 使用模板图片 {previewProject.preloadedImages.length} 张)
        </Typography>
      </DialogTitle>
      <DialogContent sx={{ p: 0, overflow: 'auto' }}>
        <SurveyPreview config={template.config} currentProject={previewProject} />
      </DialogContent>
      <DialogActions>
        <Button onClick={onClose}>关闭</Button>
      </DialogActions>
    </Dialog>
  );
}

// ─── Template Images Dialog ─────────────────────────────────────────────────

// Mirrors the client-side compressor in ImageDataset.js but kept local so
// AdminDashboard has no implicit cross-component dependency.
function compressImage(file, maxBytes = 300 * 1024, quality = 0.85) {
  return new Promise((resolve) => {
    if (file.size <= maxBytes) { resolve(file); return; }
    const img = new Image();
    const url = URL.createObjectURL(file);
    img.onload = () => {
      URL.revokeObjectURL(url);
      const canvas = document.createElement('canvas');
      let { width, height } = img;
      const maxDim = 1920;
      if (width > maxDim || height > maxDim) {
        const scale = Math.min(maxDim / width, maxDim / height);
        width = Math.round(width * scale);
        height = Math.round(height * scale);
      }
      canvas.width = width;
      canvas.height = height;
      canvas.getContext('2d').drawImage(img, 0, 0, width, height);
      const tryQuality = (q) => {
        canvas.toBlob((blob) => {
          if (!blob) { resolve(file); return; }
          if (blob.size <= maxBytes || q <= 0.3) {
            resolve(new File([blob], file.name.replace(/\.[^.]+$/, '.jpg'), { type: 'image/jpeg' }));
          } else {
            tryQuality(Math.max(q - 0.1, 0.3));
          }
        }, 'image/jpeg', q);
      };
      tryQuality(quality);
    };
    img.onerror = () => resolve(file);
    img.src = url;
  });
}

function TemplateImagesDialog({ template, open, onClose, onSaved }) {
  const [images, setImages]       = useState([]);
  const [loading, setLoading]     = useState(false);
  const [syncing, setSyncing]     = useState(false);
  const [uploading, setUploading] = useState({ active: false, progress: 0, total: 0 });
  const [error, setError]         = useState('');
  const [info, setInfo]           = useState('');
  const fileInputRef = useRef(null);
  // Keep onSaved in a ref so refresh() can call it without becoming a new
  // function on every parent render (which would re-trigger the effect).
  const onSavedRef = useRef(onSaved);
  useEffect(() => { onSavedRef.current = onSaved; }, [onSaved]);

  const refresh = useCallback(async () => {
    if (!template) return;
    setSyncing(true);
    setError('');
    const result = await listImagesFromR2(templateImagePrefix(template.id));
    setSyncing(false);
    if (!result.success) { setError(result.error || 'Failed to list images'); return; }
    const mapped = result.images.map((img) => normalizeMediaEntry({
      url: img.url, name: img.name, type: img.type || inferMediaType(img.name),
    }));
    setImages(mapped);
    // Persist the canonical list back to Supabase so listTemplates() and the
    // preview pipeline always see the same picture set the admin sees.
    if (mapped.length !== (template.preloadedImages?.length || 0)) {
      try {
        await updateTemplate(template.id, {
          preloaded_images: mapped.map(({ url, name, type }) => ({ url, name, type: type || 'image' })),
          preloaded_at:     new Date().toISOString(),
          preloaded_source: 'r2',
        });
        if (onSavedRef.current) onSavedRef.current({ silent: true });
      } catch (err) {
        console.warn('Could not sync template image list:', err);
      }
    }
  }, [template]);

  useEffect(() => {
    if (open && template) {
      setError(''); setInfo('');
      refresh();
    }
  }, [open, template, refresh]);

  const handleUpload = async (fileList) => {
    if (!template) return;
    if (!isR2Configured()) { setError('Cloudflare R2 is not configured.'); return; }
    const files = Array.from(fileList || []);
    if (!files.length) return;

    setUploading({ active: true, progress: 0, total: files.length });
    setError(''); setInfo('');

    const uploaded = [...images];
    let okCount = 0, failCount = 0;

    for (let i = 0; i < files.length; i++) {
      try {
        const compressed = await compressImage(files[i]);
        const safeName = files[i].name.replace(/[^a-zA-Z0-9._-]/g, '_');
        const key = `${templateImagePrefix(template.id)}${safeName}`;
        const result = await uploadImageToR2(compressed, key);
        if (result.success) {
          // Replace any previous entry with the same name so re-uploads dedupe
          const filtered = uploaded.filter((img) => img.name !== safeName);
          filtered.push({ url: result.url, name: safeName, key });
          uploaded.splice(0, uploaded.length, ...filtered);
          okCount++;
        } else {
          failCount++;
          if (!error) setError(`Upload failed: ${result.error}`);
        }
      } catch (e) {
        failCount++;
        if (!error) setError(e.message);
      }
      setUploading((s) => ({ ...s, progress: i + 1 }));
    }

    setUploading({ active: false, progress: files.length, total: files.length });
    setImages(uploaded);

    try {
      await updateTemplate(template.id, {
        preloaded_images: uploaded.map(({ url, name }) => ({ url, name })),
        preloaded_at:     new Date().toISOString(),
        preloaded_source: 'r2',
      });
      setInfo(failCount > 0
        ? `Uploaded ${okCount}, ${failCount} failed.`
        : `Uploaded ${okCount} image(s).`);
      if (onSavedRef.current) onSavedRef.current();
    } catch (err) {
      setError('Saved to R2 but failed to update template record: ' + err.message);
    }
  };

  const handleClear = async () => {
    if (!template) return;
    if (!window.confirm(`确认清空模板 "${template.name}" 的全部图片吗？此操作不可恢复。`)) return;
    setLoading(true); setError(''); setInfo('');
    try {
      const listed = await listImagesFromR2(templateImagePrefix(template.id));
      if (listed.success && listed.images.length > 0) {
        await deleteImagesFromR2(listed.images.map((img) => img.key));
      }
      await updateTemplate(template.id, {
        preloaded_images: [],
        preloaded_at:     null,
        preloaded_source: null,
      });
      setImages([]);
      setInfo('已清空模板图片。');
      if (onSavedRef.current) onSavedRef.current();
    } catch (err) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  };

  if (!template) return null;

  return (
    <Dialog open={open} onClose={onClose} maxWidth="md" fullWidth
      PaperProps={{ sx: { minHeight: '70vh' } }}>
      <DialogTitle>
        模板图片 — {template.name}
        <Typography variant="caption" color="text.secondary" sx={{ ml: 1 }}>
          (R2: {templateImagePrefix(template.id)})
        </Typography>
      </DialogTitle>
      <DialogContent dividers>
        {!isR2Configured() && (
          <Alert severity="warning" sx={{ mb: 2 }}>
            Cloudflare R2 未配置，无法上传或浏览图片。
          </Alert>
        )}
        {error && <Alert severity="error" sx={{ mb: 2 }} onClose={() => setError('')}>{error}</Alert>}
        {info  && <Alert severity="success" sx={{ mb: 2 }} onClose={() => setInfo('')}>{info}</Alert>}

        <Stack direction="row" spacing={2} alignItems="center" sx={{ mb: 2 }}>
          <Chip
            label={syncing ? '同步中…' : `${images.length} 张图片`}
            color={images.length > 0 ? 'success' : 'default'}
            variant="outlined"
            icon={syncing ? <CircularProgress size={14} /> : undefined}
          />
          <Box flex={1} />
          <input
            ref={fileInputRef}
            type="file"
            accept="image/*"
            multiple
            style={{ display: 'none' }}
            onChange={(e) => { handleUpload(e.target.files); e.target.value = ''; }}
          />
          <Button
            startIcon={<CloudUpload />}
            variant="contained"
            size="small"
            disabled={!isR2Configured() || uploading.active}
            onClick={() => fileInputRef.current?.click()}
          >
            上传图片
          </Button>
          <Button
            startIcon={<Refresh />}
            size="small"
            disabled={syncing || uploading.active}
            onClick={refresh}
          >
            刷新
          </Button>
          <Tooltip title="清空模板图片">
            <span>
              <Button
                startIcon={<DeleteForever />}
                size="small"
                color="error"
                disabled={images.length === 0 || loading || uploading.active}
                onClick={handleClear}
              >
                清空
              </Button>
            </span>
          </Tooltip>
        </Stack>

        {uploading.active && (
          <Box sx={{ mb: 2 }}>
            <Box sx={{ display: 'flex', justifyContent: 'space-between', mb: 0.5 }}>
              <Typography variant="body2">Uploading…</Typography>
              <Typography variant="body2" color="text.secondary">
                {uploading.progress} / {uploading.total}
              </Typography>
            </Box>
            <LinearProgress
              variant="determinate"
              value={uploading.total > 0 ? (uploading.progress / uploading.total) * 100 : 0}
              sx={{ height: 8, borderRadius: 4 }}
            />
          </Box>
        )}

        {images.length === 0 ? (
          <Box sx={{ py: 6, textAlign: 'center', color: 'text.secondary' }}>
            <PhotoLibrary sx={{ fontSize: 48, opacity: 0.4 }} />
            <Typography variant="body2" sx={{ mt: 1 }}>
              当前模板还没有图片。上传后将存放在 <code>{templateImagePrefix(template.id)}</code>，
              并会在模板预览以及基于此模板新建的项目中自动使用。
            </Typography>
          </Box>
        ) : (
          <Box sx={{ display: 'flex', flexWrap: 'wrap', gap: 1 }}>
            {images.map((img) => (
              <Box key={img.key || img.name}
                sx={{ width: 110, position: 'relative' }}>
                <Box sx={{ width: 110, height: 110, borderRadius: 1, overflow: 'hidden',
                  border: '1px solid', borderColor: 'divider', bgcolor: 'grey.100' }}>
                  <img
                    src={img.url}
                    alt={img.name}
                    style={{ width: '100%', height: '100%', objectFit: 'cover' }}
                    onError={(e) => {
                      e.target.style.display = 'none';
                      e.target.parentElement.innerHTML =
                        '<div style="display:flex;align-items:center;justify-content:center;height:100%;font-size:10px;color:#999;">Failed</div>';
                    }}
                  />
                </Box>
                <Typography variant="caption" sx={{
                  display: 'block', mt: 0.5,
                  whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis',
                }}>
                  {img.name}
                </Typography>
              </Box>
            ))}
          </Box>
        )}
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
  const [imagesTarget, setImagesTarget]   = useState(null);
  const [imagesOpen, setImagesOpen]       = useState(false);
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
      // Best-effort cleanup of R2 image folder before removing the row.
      // We don't block deletion on this failing — orphans are easy to spot
      // and the user explicitly opted into a destructive action.
      if (isR2Configured()) {
        try {
          const listed = await listImagesFromR2(templateImagePrefix(id));
          if (listed.success && listed.images.length > 0) {
            await deleteImagesFromR2(listed.images.map((img) => img.key));
          }
        } catch (cleanupErr) {
          console.warn('Template image cleanup failed:', cleanupErr);
        }
      }
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
                <TableCell align="center">图片</TableCell>
                <TableCell>提交时间</TableCell>
                <TableCell align="center">操作</TableCell>
              </TableRow>
            </TableHead>
            <TableBody>
              {templates.length === 0 && (
                <TableRow>
                  <TableCell colSpan={8} align="center" sx={{ py: 4, color: 'text.secondary' }}>
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
                  <TableCell align="center">
                    <Chip
                      size="small"
                      variant="outlined"
                      color={(t.preloadedImages?.length || 0) > 0 ? 'success' : 'default'}
                      label={`${t.preloadedImages?.length || 0} 张`}
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
                      <Tooltip title="管理图片">
                        <IconButton size="small" color="info"
                          onClick={() => { setImagesTarget(t); setImagesOpen(true); }}>
                          <PhotoLibrary fontSize="small" />
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

      <TemplateImagesDialog
        template={imagesTarget}
        open={imagesOpen}
        onClose={() => setImagesOpen(false)}
        onSaved={(opts) => { load(); if (!opts?.silent) showSnack('模板图片已更新'); }}
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

// ─── Edit Project Dialog ─────────────────────────────────────────────────────

function EditProjectDialog({ project, open, onClose, onSaved }) {
  const [form, setForm] = useState({});
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => {
    if (project) {
      setForm({
        name:        project.name        || '',
        description: project.description || '',
      });
    }
  }, [project]);

  const handleSave = async () => {
    setSaving(true);
    setError('');
    try {
      await updateProjectAdmin(project.id, {
        name:        form.name,
        description: form.description,
      });
      onSaved();
      onClose();
    } catch (err) {
      setError(err.message);
    } finally {
      setSaving(false);
    }
  };

  if (!project) return null;
  return (
    <Dialog open={open} onClose={onClose} maxWidth="sm" fullWidth>
      <DialogTitle>编辑项目: {project.name}</DialogTitle>
      <DialogContent>
        {error && <Alert severity="error" sx={{ mb: 2 }}>{error}</Alert>}
        <Stack spacing={2} sx={{ mt: 1 }}>
          <TextField
            label="项目名称"
            value={form.name || ''}
            onChange={e => setForm(f => ({ ...f, name: e.target.value }))}
            fullWidth
            size="small"
          />
          <TextField
            label="描述"
            value={form.description || ''}
            onChange={e => setForm(f => ({ ...f, description: e.target.value }))}
            fullWidth
            size="small"
            multiline
            rows={3}
          />
          <TextField
            label="来源模板"
            value={project.template_id || '—'}
            fullWidth
            size="small"
            disabled
            helperText="模板来源为只读信息"
          />
          <TextField
            label="用户 ID"
            value={project.user_id || '—'}
            fullWidth
            size="small"
            disabled
          />
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

// ─── Project Survey Builder Dialog ───────────────────────────────────────────

function ProjectSurveyBuilderDialog({ project, open, onClose, onSaved }) {
  const [draftConfig, setDraftConfig] = useState(null);
  const [saving, setSaving]           = useState(false);
  const [error, setError]             = useState('');

  useEffect(() => {
    if (project && open) {
      setDraftConfig(JSON.parse(JSON.stringify(project.config || {})));
      setError('');
    }
  }, [project, open]);

  const handleSave = async () => {
    if (!draftConfig) return;
    setSaving(true);
    setError('');
    try {
      await updateProjectAdmin(project.id, { survey_config: draftConfig });
      onSaved();
      onClose();
    } catch (err) {
      setError(err.message);
    } finally {
      setSaving(false);
    }
  };

  if (!project) return null;

  const previewProject = {
    id: project.id,
    name: project.name,
    preloadedImages: Array.isArray(project.preloadedImages) ? project.preloadedImages : [],
  };

  return (
    <Dialog open={open} onClose={onClose} fullScreen>
      <AppBar position="static" color="default" elevation={1} sx={{ flexShrink: 0 }}>
        <Toolbar>
          <IconButton edge="start" onClick={onClose} sx={{ mr: 1 }}>
            <ArrowBack />
          </IconButton>
          <Typography variant="h6" sx={{ flex: 1 }}>
            编辑调查内容 — {project.name}
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
            key={project.id}
            config={draftConfig}
            onChange={setDraftConfig}
            currentProject={previewProject}
            onNextStep={null}
          />
        )}
      </Box>
    </Dialog>
  );
}

// ─── Project Survey Preview Dialog ─────────────────────────────────────────────

function ProjectPreviewDialog({ project, open, onClose }) {
  if (!project) return null;
  const previewProject = {
    id: project.id,
    name: project.name,
    preloadedImages: Array.isArray(project.preloadedImages) ? project.preloadedImages : [],
  };
  return (
    <Dialog open={open} onClose={onClose} maxWidth="lg" fullWidth
      PaperProps={{ sx: { height: '90vh' } }}>
      <DialogTitle>
        预览项目 — {project.name}
        <Typography variant="caption" color="text.secondary" sx={{ ml: 1 }}>
          (只读 · 使用项目图片 {previewProject.preloadedImages.length} 张)
        </Typography>
      </DialogTitle>
      <DialogContent sx={{ p: 0, overflow: 'auto' }}>
        <SurveyPreview config={project.config} currentProject={previewProject} />
      </DialogContent>
      <DialogActions>
        <Button onClick={onClose}>关闭</Button>
      </DialogActions>
    </Dialog>
  );
}

// ─── Project Images Dialog ───────────────────────────────────────────────────

function ProjectImagesDialog({ project, open, onClose, onSaved }) {
  const [images, setImages]       = useState([]);
  const [loading, setLoading]     = useState(false);
  const [syncing, setSyncing]     = useState(false);
  const [uploading, setUploading] = useState({ active: false, progress: 0, total: 0 });
  const [error, setError]         = useState('');
  const [info, setInfo]           = useState('');
  const fileInputRef = useRef(null);
  const onSavedRef = useRef(onSaved);
  useEffect(() => { onSavedRef.current = onSaved; }, [onSaved]);

  const refresh = useCallback(async () => {
    if (!project) return;
    if (!project.user_id) {
      setError('项目缺少 user_id，无法定位 R2 图片路径。');
      return;
    }
    setSyncing(true);
    setError('');
    const result = await listImagesFromR2(projectImagePrefix(project));
    setSyncing(false);
    if (!result.success) { setError(result.error || 'Failed to list images'); return; }
    const mapped = result.images.map((img) => normalizeMediaEntry({
      url: img.url, name: img.name, type: img.type || inferMediaType(img.name),
    }));
    setImages(mapped);
    if (mapped.length !== (project.preloadedImages?.length || 0)) {
      try {
        await updateProjectAdmin(project.id, {
          preloaded_images: mapped.map(({ url, name, type }) => ({ url, name, type: type || 'image' })),
          preloaded_at:     new Date().toISOString(),
          preloaded_source: 'r2',
        });
        if (onSavedRef.current) onSavedRef.current({ silent: true });
      } catch (err) {
        console.warn('Could not sync project image list:', err);
      }
    }
  }, [project]);

  useEffect(() => {
    if (open && project) {
      setError(''); setInfo('');
      refresh();
    }
  }, [open, project, refresh]);

  const handleUpload = async (fileList) => {
    if (!project) return;
    if (!project.user_id) { setError('项目缺少 user_id，无法上传图片。'); return; }
    if (!isR2Configured()) { setError('Cloudflare R2 is not configured.'); return; }
    const files = Array.from(fileList || []);
    if (!files.length) return;

    setUploading({ active: true, progress: 0, total: files.length });
    setError(''); setInfo('');

    const uploaded = [...images];
    let okCount = 0, failCount = 0;

    for (let i = 0; i < files.length; i++) {
      try {
        const compressed = await compressImage(files[i]);
        const safeName = files[i].name.replace(/[^a-zA-Z0-9._-]/g, '_');
        const key = `${projectImagePrefix(project)}${safeName}`;
        const result = await uploadImageToR2(compressed, key);
        if (result.success) {
          const filtered = uploaded.filter((img) => img.name !== safeName);
          filtered.push({ url: result.url, name: safeName, key });
          uploaded.splice(0, uploaded.length, ...filtered);
          okCount++;
        } else {
          failCount++;
          if (!error) setError(`Upload failed: ${result.error}`);
        }
      } catch (e) {
        failCount++;
        if (!error) setError(e.message);
      }
      setUploading((s) => ({ ...s, progress: i + 1 }));
    }

    setUploading({ active: false, progress: files.length, total: files.length });
    setImages(uploaded);

    try {
      await updateProjectAdmin(project.id, {
        preloaded_images: uploaded.map(({ url, name }) => ({ url, name })),
        preloaded_at:     new Date().toISOString(),
        preloaded_source: 'r2',
      });
      setInfo(failCount > 0
        ? `Uploaded ${okCount}, ${failCount} failed.`
        : `Uploaded ${okCount} image(s).`);
      if (onSavedRef.current) onSavedRef.current();
    } catch (err) {
      setError('Saved to R2 but failed to update project record: ' + err.message);
    }
  };

  const handleClear = async () => {
    if (!project) return;
    if (!window.confirm(`确认清空项目 "${project.name}" 的全部图片吗？此操作不可恢复。`)) return;
    setLoading(true); setError(''); setInfo('');
    try {
      const listed = await listImagesFromR2(projectImagePrefix(project));
      if (listed.success && listed.images.length > 0) {
        await deleteImagesFromR2(listed.images.map((img) => img.key));
      }
      await updateProjectAdmin(project.id, {
        preloaded_images: [],
        preloaded_at:     null,
        preloaded_source: null,
      });
      setImages([]);
      setInfo('已清空项目图片。');
      if (onSavedRef.current) onSavedRef.current();
    } catch (err) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  };

  if (!project) return null;

  return (
    <Dialog open={open} onClose={onClose} maxWidth="md" fullWidth
      PaperProps={{ sx: { minHeight: '70vh' } }}>
      <DialogTitle>
        项目图片 — {project.name}
        <Typography variant="caption" color="text.secondary" sx={{ ml: 1 }}>
          (R2: {projectImagePrefix(project)})
        </Typography>
      </DialogTitle>
      <DialogContent dividers>
        {!project.user_id && (
          <Alert severity="warning" sx={{ mb: 2 }}>
            该项目没有 user_id，无法管理 R2 图片。
          </Alert>
        )}
        {!isR2Configured() && (
          <Alert severity="warning" sx={{ mb: 2 }}>
            Cloudflare R2 未配置，无法上传或浏览图片。
          </Alert>
        )}
        {error && <Alert severity="error" sx={{ mb: 2 }} onClose={() => setError('')}>{error}</Alert>}
        {info  && <Alert severity="success" sx={{ mb: 2 }} onClose={() => setInfo('')}>{info}</Alert>}

        <Stack direction="row" spacing={2} alignItems="center" sx={{ mb: 2 }}>
          <Chip
            label={syncing ? '同步中…' : `${images.length} 张图片`}
            color={images.length > 0 ? 'success' : 'default'}
            variant="outlined"
            icon={syncing ? <CircularProgress size={14} /> : undefined}
          />
          <Box flex={1} />
          <input
            ref={fileInputRef}
            type="file"
            accept="image/*"
            multiple
            style={{ display: 'none' }}
            onChange={(e) => { handleUpload(e.target.files); e.target.value = ''; }}
          />
          <Button
            startIcon={<CloudUpload />}
            variant="contained"
            size="small"
            disabled={!isR2Configured() || !project.user_id || uploading.active}
            onClick={() => fileInputRef.current?.click()}
          >
            上传图片
          </Button>
          <Button
            startIcon={<Refresh />}
            size="small"
            disabled={syncing || uploading.active}
            onClick={refresh}
          >
            刷新
          </Button>
          <Tooltip title="清空项目图片">
            <span>
              <Button
                startIcon={<DeleteForever />}
                size="small"
                color="error"
                disabled={images.length === 0 || loading || uploading.active}
                onClick={handleClear}
              >
                清空
              </Button>
            </span>
          </Tooltip>
        </Stack>

        {uploading.active && (
          <Box sx={{ mb: 2 }}>
            <Box sx={{ display: 'flex', justifyContent: 'space-between', mb: 0.5 }}>
              <Typography variant="body2">Uploading…</Typography>
              <Typography variant="body2" color="text.secondary">
                {uploading.progress} / {uploading.total}
              </Typography>
            </Box>
            <LinearProgress
              variant="determinate"
              value={uploading.total > 0 ? (uploading.progress / uploading.total) * 100 : 0}
              sx={{ height: 8, borderRadius: 4 }}
            />
          </Box>
        )}

        {images.length === 0 ? (
          <Box sx={{ py: 6, textAlign: 'center', color: 'text.secondary' }}>
            <PhotoLibrary sx={{ fontSize: 48, opacity: 0.4 }} />
            <Typography variant="body2" sx={{ mt: 1 }}>
              当前项目还没有图片。上传后将存放在 <code>{projectImagePrefix(project)}</code>，
              并会在项目预览以及调查中自动使用。
            </Typography>
          </Box>
        ) : (
          <Box sx={{ display: 'flex', flexWrap: 'wrap', gap: 1 }}>
            {images.map((img) => (
              <Box key={img.key || img.name} sx={{ width: 110, position: 'relative' }}>
                <Box sx={{ width: 110, height: 110, borderRadius: 1, overflow: 'hidden',
                  border: '1px solid', borderColor: 'divider', bgcolor: 'grey.100' }}>
                  <img
                    src={img.url}
                    alt={img.name}
                    style={{ width: '100%', height: '100%', objectFit: 'cover' }}
                    onError={(e) => {
                      e.target.style.display = 'none';
                      e.target.parentElement.innerHTML =
                        '<div style="display:flex;align-items:center;justify-content:center;height:100%;font-size:10px;color:#999;">Failed</div>';
                    }}
                  />
                </Box>
                <Typography variant="caption" sx={{
                  display: 'block', mt: 0.5,
                  whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis',
                }}>
                  {img.name}
                </Typography>
              </Box>
            ))}
          </Box>
        )}
      </DialogContent>
      <DialogActions>
        <Button onClick={onClose}>关闭</Button>
      </DialogActions>
    </Dialog>
  );
}

// ─── Project Overview Tab ────────────────────────────────────────────────────

function ProjectOverview() {
  const [projects, setProjects]           = useState([]);
  const [loading, setLoading]             = useState(false);
  const [editTarget, setEditTarget]       = useState(null);
  const [editOpen, setEditOpen]           = useState(false);
  const [configTarget, setConfigTarget]   = useState(null);
  const [configOpen, setConfigOpen]       = useState(false);
  const [previewTarget, setPreviewTarget] = useState(null);
  const [previewOpen, setPreviewOpen]     = useState(false);
  const [imagesTarget, setImagesTarget]   = useState(null);
  const [imagesOpen, setImagesOpen]       = useState(false);
  const [snack, setSnack]                 = useState({ open: false, msg: '', sev: 'success' });

  const showSnack = (msg, sev = 'success') => setSnack({ open: true, msg, sev });

  const load = useCallback(async () => {
    setLoading(true);
    const data = await listAllProjects();
    setProjects(data);
    setLoading(false);
  }, []);

  useEffect(() => { load(); }, [load]);

  const handleDelete = async (project) => {
    if (!window.confirm(`确认删除项目 "${project.name}" 吗？此操作不可恢复。`)) return;
    try {
      if (isR2Configured() && project.user_id) {
        try {
          const listed = await listImagesFromR2(projectImagePrefix(project));
          if (listed.success && listed.images.length > 0) {
            await deleteImagesFromR2(listed.images.map((img) => img.key));
          }
        } catch (cleanupErr) {
          console.warn('Project image cleanup failed:', cleanupErr);
        }
      }
      await deleteProjectAdmin(project.id);
      showSnack('已删除');
      load();
    } catch (err) {
      showSnack(err.message, 'error');
    }
  };

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
                <TableCell align="center">图片</TableCell>
                <TableCell>最后更新</TableCell>
                <TableCell align="center">操作</TableCell>
              </TableRow>
            </TableHead>
            <TableBody>
              {projects.length === 0 && (
                <TableRow>
                  <TableCell colSpan={7} align="center" sx={{ py: 4, color: 'text.secondary' }}>
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
                  <TableCell align="center">
                    <Chip
                      size="small"
                      variant="outlined"
                      color={(p.preloadedImages?.length || 0) > 0 ? 'success' : 'default'}
                      label={`${p.preloadedImages?.length || 0} 张`}
                    />
                  </TableCell>
                  <TableCell>
                    <Typography variant="caption">
                      {p.updated_at ? new Date(p.updated_at).toLocaleDateString('zh-CN') : '—'}
                    </Typography>
                  </TableCell>
                  <TableCell align="center">
                    <Stack direction="row" spacing={0.5} justifyContent="center">
                      <Tooltip title="预览调查">
                        <IconButton size="small" color="primary"
                          onClick={() => { setPreviewTarget(p); setPreviewOpen(true); }}>
                          <Preview fontSize="small" />
                        </IconButton>
                      </Tooltip>
                      <Tooltip title="管理图片">
                        <IconButton size="small" color="info"
                          onClick={() => { setImagesTarget(p); setImagesOpen(true); }}>
                          <PhotoLibrary fontSize="small" />
                        </IconButton>
                      </Tooltip>
                      <Tooltip title="编辑调查内容">
                        <IconButton size="small" color="secondary"
                          onClick={() => { setConfigTarget(p); setConfigOpen(true); }}>
                          <EditNote fontSize="small" />
                        </IconButton>
                      </Tooltip>
                      <Tooltip title="编辑元数据">
                        <IconButton size="small" onClick={() => { setEditTarget(p); setEditOpen(true); }}>
                          <Edit fontSize="small" />
                        </IconButton>
                      </Tooltip>
                      <Tooltip title="删除">
                        <IconButton size="small" color="error" onClick={() => handleDelete(p)}>
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

      <EditProjectDialog
        project={editTarget}
        open={editOpen}
        onClose={() => setEditOpen(false)}
        onSaved={() => { load(); showSnack('保存成功'); }}
      />

      <ProjectSurveyBuilderDialog
        project={configTarget}
        open={configOpen}
        onClose={() => setConfigOpen(false)}
        onSaved={() => { load(); showSnack('调查内容已保存'); }}
      />

      <ProjectPreviewDialog
        project={previewTarget}
        open={previewOpen}
        onClose={() => setPreviewOpen(false)}
      />

      <ProjectImagesDialog
        project={imagesTarget}
        open={imagesOpen}
        onClose={() => setImagesOpen(false)}
        onSaved={(opts) => { load(); if (!opts?.silent) showSnack('项目图片已更新'); }}
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

// ─── Skill Preview Media Library Dialog ──────────────────────────────────────

// Shared R2 folder (skill-preview/) whose media is used by every user's
// Skill 库 preset previews. Images are compressed on upload; video/audio
// are uploaded as-is.
function SkillPreviewMediaDialog({ open, onClose }) {
  const [media, setMedia]         = useState([]);
  const [syncing, setSyncing]     = useState(false);
  const [uploading, setUploading] = useState({ active: false, progress: 0, total: 0 });
  const [error, setError]         = useState('');
  const [info, setInfo]           = useState('');
  const fileInputRef = useRef(null);

  const refresh = useCallback(async () => {
    setSyncing(true);
    setError('');
    const list = await listSkillPreviewMedia();
    setMedia(list);
    setSyncing(false);
  }, []);

  useEffect(() => {
    if (open) { setError(''); setInfo(''); refresh(); }
  }, [open, refresh]);

  const handleUpload = async (fileList) => {
    if (!isR2Configured()) { setError('Cloudflare R2 is not configured.'); return; }
    const files = Array.from(fileList || []);
    if (!files.length) return;

    setUploading({ active: true, progress: 0, total: files.length });
    setError(''); setInfo('');
    let okCount = 0, failCount = 0;

    for (let i = 0; i < files.length; i++) {
      try {
        const file = files[i];
        const isImage = (file.type || '').startsWith('image/');
        const payload = isImage ? await compressImage(file) : file;
        const safeName = file.name.replace(/[^a-zA-Z0-9._-]/g, '_');
        const result = await uploadImageToR2(payload, `${SKILL_PREVIEW_PREFIX}${safeName}`);
        if (result.success) okCount++;
        else { failCount++; if (!error) setError(`Upload failed: ${result.error}`); }
      } catch (e) {
        failCount++;
        if (!error) setError(e.message);
      }
      setUploading((s) => ({ ...s, progress: i + 1 }));
    }

    setUploading({ active: false, progress: files.length, total: files.length });
    setInfo(failCount > 0 ? `上传 ${okCount} 个，失败 ${failCount} 个` : `已上传 ${okCount} 个媒体文件`);
    refresh();
  };

  const handleDeleteOne = async (item) => {
    if (!window.confirm(`确认删除「${item.name}」吗？`)) return;
    const result = await deleteImagesFromR2([item.key || `${SKILL_PREVIEW_PREFIX}${item.name}`]);
    if (!result.success) { setError(result.error || 'Delete failed'); return; }
    refresh();
  };

  const handleClear = async () => {
    if (!media.length) return;
    if (!window.confirm(`确认清空全部 ${media.length} 个预览媒体吗？此操作不可恢复。`)) return;
    const result = await deleteImagesFromR2(media.map((m) => m.key || `${SKILL_PREVIEW_PREFIX}${m.name}`));
    if (!result.success) { setError(result.error || 'Delete failed'); return; }
    setInfo('已清空预览媒体库。');
    refresh();
  };

  const counts = media.reduce((acc, m) => {
    acc[m.type] = (acc[m.type] || 0) + 1;
    return acc;
  }, {});

  return (
    <Dialog open={open} onClose={onClose} maxWidth="md" fullWidth
      PaperProps={{ sx: { minHeight: '70vh' } }}>
      <DialogTitle>
        Skill 预览媒体库
        <Typography variant="caption" color="text.secondary" sx={{ ml: 1 }}>
          (R2: {SKILL_PREVIEW_PREFIX} · 所有用户的 Skill 案例预览共用)
        </Typography>
      </DialogTitle>
      <DialogContent dividers>
        {!isR2Configured() && (
          <Alert severity="warning" sx={{ mb: 2 }}>Cloudflare R2 未配置，无法上传或浏览媒体。</Alert>
        )}
        {error && <Alert severity="error" sx={{ mb: 2 }} onClose={() => setError('')}>{error}</Alert>}
        {info  && <Alert severity="success" sx={{ mb: 2 }} onClose={() => setInfo('')}>{info}</Alert>}

        <Stack direction="row" spacing={1} alignItems="center" sx={{ mb: 2 }}>
          <Chip
            label={syncing ? '同步中…' : `图片 ${counts.image || 0} · 视频 ${counts.video || 0} · 音频 ${counts.audio || 0}`}
            color={media.length > 0 ? 'success' : 'default'}
            variant="outlined"
            icon={syncing ? <CircularProgress size={14} /> : undefined}
          />
          <Box flex={1} />
          <input
            ref={fileInputRef}
            type="file"
            accept={MEDIA_ACCEPT}
            multiple
            style={{ display: 'none' }}
            onChange={(e) => { handleUpload(e.target.files); e.target.value = ''; }}
          />
          <Button
            startIcon={<CloudUpload />}
            variant="contained"
            size="small"
            disabled={!isR2Configured() || uploading.active}
            onClick={() => fileInputRef.current?.click()}
          >
            上传媒体
          </Button>
          <Button startIcon={<Refresh />} size="small" disabled={syncing || uploading.active} onClick={refresh}>
            刷新
          </Button>
          <Button
            startIcon={<DeleteForever />}
            size="small"
            color="error"
            disabled={media.length === 0 || uploading.active}
            onClick={handleClear}
          >
            清空
          </Button>
        </Stack>

        {uploading.active && (
          <Box sx={{ mb: 2 }}>
            <Box sx={{ display: 'flex', justifyContent: 'space-between', mb: 0.5 }}>
              <Typography variant="body2">Uploading…</Typography>
              <Typography variant="body2" color="text.secondary">
                {uploading.progress} / {uploading.total}
              </Typography>
            </Box>
            <LinearProgress
              variant="determinate"
              value={uploading.total > 0 ? (uploading.progress / uploading.total) * 100 : 0}
              sx={{ height: 8, borderRadius: 4 }}
            />
          </Box>
        )}

        {media.length === 0 ? (
          <Box sx={{ py: 6, textAlign: 'center', color: 'text.secondary' }}>
            <PermMedia sx={{ fontSize: 48, opacity: 0.4 }} />
            <Typography variant="body2" sx={{ mt: 1 }}>
              还没有预览媒体。上传图片 / 视频 / 音频后，「我的 Skill 库」中的预设案例预览将随机使用这里的真实媒体，
              而不再显示内置示例图。
            </Typography>
          </Box>
        ) : (
          <Box sx={{ display: 'flex', flexWrap: 'wrap', gap: 1 }}>
            {media.map((item) => (
              <Box key={item.key || item.name} sx={{ width: 110, position: 'relative',
                '&:hover .del-btn': { opacity: 1 } }}>
                <Box sx={{ width: 110, height: 110, borderRadius: 1, overflow: 'hidden',
                  border: '1px solid', borderColor: 'divider', bgcolor: 'grey.100',
                  display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                  {item.type === 'image' ? (
                    <img
                      src={item.url}
                      alt={item.name}
                      style={{ width: '100%', height: '100%', objectFit: 'cover' }}
                      onError={(e) => {
                        e.target.style.display = 'none';
                        e.target.parentElement.innerHTML =
                          '<div style="display:flex;align-items:center;justify-content:center;height:100%;font-size:10px;color:#999;">Failed</div>';
                      }}
                    />
                  ) : item.type === 'video' ? (
                    <Videocam sx={{ fontSize: 36, color: 'warning.main' }} />
                  ) : (
                    <Audiotrack sx={{ fontSize: 36, color: 'secondary.main' }} />
                  )}
                </Box>
                <IconButton
                  className="del-btn"
                  size="small"
                  onClick={() => handleDeleteOne(item)}
                  sx={{ position: 'absolute', top: 2, right: 2, opacity: 0,
                    transition: 'opacity .15s', bgcolor: 'rgba(255,255,255,0.85)',
                    '&:hover': { bgcolor: 'error.light', color: 'white' } }}
                >
                  <Delete sx={{ fontSize: 16 }} />
                </IconButton>
                <Typography variant="caption" sx={{
                  display: 'block', mt: 0.5,
                  whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis',
                }}>
                  {item.name}
                </Typography>
              </Box>
            ))}
          </Box>
        )}
      </DialogContent>
      <DialogActions>
        <Button onClick={onClose}>关闭</Button>
      </DialogActions>
    </Dialog>
  );
}

// ─── Skill Management Tab ──────────────────────────────────────────────────────

function SkillManagement() {
  const navigate = useNavigate();
  const [skills, setSkills] = useState([]);
  const [loading, setLoading] = useState(false);
  const [mediaOpen, setMediaOpen] = useState(false);
  const [snack, setSnack] = useState({ open: false, msg: '', sev: 'success' });
  const showSnack = (msg, sev = 'success') => setSnack({ open: true, msg, sev });

  const load = useCallback(async () => {
    setLoading(true);
    setSkills(await listSubmittedSkills());
    setLoading(false);
  }, []);

  useEffect(() => { load(); }, [load]);

  const handleApprove = async (id, value) => {
    try {
      await updateSkill(id, { is_approved: value });
      showSnack(value ? '已批准 Skill' : '已撤销批准');
      load();
    } catch (err) { showSnack(err.message, 'error'); }
  };

  const handleDelete = async (id, name) => {
    if (!window.confirm(`确认删除 Skill "${name}" 吗？`)) return;
    try {
      await deleteSkill(id);
      showSnack('已删除');
      load();
    } catch (err) { showSnack(err.message, 'error'); }
  };

  return (
    <Box>
      <Stack direction="row" spacing={2} sx={{ mb: 2 }} alignItems="center">
        <Typography variant="h6">Skill 审核</Typography>
        <Box flex={1} />
        <Tooltip title="管理 Skill 案例预览使用的全局图片 / 视频 / 音频库">
          <Button variant="outlined" startIcon={<PermMedia />} onClick={() => setMediaOpen(true)}>
            预览媒体库
          </Button>
        </Tooltip>
        <Button variant="outlined" onClick={() => navigate('/skills')}>我的 Skill 库</Button>
        <Button startIcon={<Refresh />} onClick={load} disabled={loading}>刷新</Button>
      </Stack>
      {loading ? <CircularProgress /> : (
        <TableContainer component={Paper} variant="outlined">
          <Table size="small">
            <TableHead>
              <TableRow sx={{ '& th': { fontWeight: 700, bgcolor: 'grey.50' } }}>
                <TableCell>名称</TableCell>
                <TableCell>提交者</TableCell>
                <TableCell align="center">状态</TableCell>
                <TableCell align="center">公开</TableCell>
                <TableCell>提交时间</TableCell>
                <TableCell align="center">操作</TableCell>
              </TableRow>
            </TableHead>
            <TableBody>
              {skills.length === 0 && (
                <TableRow><TableCell colSpan={6} align="center" sx={{ py: 4, color: 'text.secondary' }}>暂无待审核 Skill</TableCell></TableRow>
              )}
              {skills.map((s) => {
                const status = getSkillStatus(s);
                return (
                <TableRow key={s.id} hover>
                  <TableCell>
                    <Typography variant="body2" fontWeight={600}>{s.name}</Typography>
                    <Typography variant="caption" color="text.secondary">{s.id}</Typography>
                  </TableCell>
                  <TableCell>{s.submitter_email || '—'}</TableCell>
                  <TableCell align="center">
                    <Chip
                      size="small"
                      label={status === 'approved' ? '已公开' : '待审核'}
                      color={status === 'approved' ? 'success' : 'warning'}
                    />
                  </TableCell>
                  <TableCell align="center">
                    <Switch size="small" checked={!!s.is_approved} onChange={(e) => handleApprove(s.id, e.target.checked)} color="success" />
                  </TableCell>
                  <TableCell>
                    <Typography variant="caption">
                      {s.submittedAt ? new Date(s.submittedAt).toLocaleDateString('zh-CN') : '—'}
                    </Typography>
                  </TableCell>
                  <TableCell align="center">
                    <IconButton size="small" color="error" onClick={() => handleDelete(s.id, s.name)}><Delete fontSize="small" /></IconButton>
                  </TableCell>
                </TableRow>
              );})}
            </TableBody>
          </Table>
        </TableContainer>
      )}
      <SkillPreviewMediaDialog open={mediaOpen} onClose={() => setMediaOpen(false)} />
      <Snackbar open={snack.open} autoHideDuration={3000} onClose={() => setSnack((x) => ({ ...x, open: false }))}>
        <Alert severity={snack.sev}>{snack.msg}</Alert>
      </Snackbar>
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
          <Tab label="Skill 审核" />
        </Tabs>
      </AppBar>

      <Container maxWidth="xl" sx={{ py: 3 }}>
        {tab === 0 && <TemplateManagement />}
        {tab === 1 && <ProjectOverview />}
        {tab === 2 && <SkillManagement />}
      </Container>
    </Box>
  );
}
