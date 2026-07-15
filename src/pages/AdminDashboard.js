import React, { useState, useEffect, useCallback, useRef, useMemo } from 'react';
import {
  Box, Container, Typography, AppBar, Toolbar, Tabs, Tab, Paper,
  Table, TableBody, TableCell, TableContainer, TableHead, TableRow,
  TableSortLabel,
  Button, IconButton, Chip, Dialog, DialogTitle, DialogContent,
  DialogActions, TextField, Switch, Alert, Snackbar, Checkbox,
  CircularProgress, Tooltip, Stack, Select, MenuItem, FormControl, InputLabel,
  LinearProgress, Accordion, AccordionSummary, AccordionDetails,
} from '@mui/material';
import {
  Delete, Edit, ArrowBack, Refresh, CloudUpload, Home, Preview,
  EditNote, PhotoLibrary, DeleteForever, Videocam, Audiotrack, PermMedia,
  ExpandMore, PushPin, AutoFixHigh, Stop,
} from '@mui/icons-material';
import { useNavigate } from 'react-router-dom';
import {
  listAllTemplates, updateTemplate, deleteTemplate, renameTemplateId,
  normalizeTemplateId, templateImagePrefix,
  listAllProjects, updateProjectAdmin, deleteProjectAdmin,
  seedBuiltinTemplates, previewBuiltinTemplateImport, checkIsAdmin,
} from '../lib/templateManager';
import { findDuplicateQuestionNames, repairDuplicateQuestionNames } from '../lib/questionNames';
import {
  listAllLiveSurveys,
  approveLiveListing,
  revokeLiveListing,
  updateLiveListing,
  deleteLiveListing,
  formatLiveWindow,
  computeLiveStatus,
} from '../lib/liveSurveyManager';
import { supabase } from '../lib/supabase';
import { inferMediaType, normalizeMediaEntry, MEDIA_ACCEPT, sortMediaByName } from '../lib/mediaUtils';
import { SKILL_PREVIEW_PREFIX, listSkillPreviewMedia } from '../lib/skillPreviewMedia';
import {
  listSubmittedSkills, updateSkill, deleteSkill, getSkillStatus,
} from '../lib/skillManager';
import {
  isR2Configured, uploadImageToR2, listImagesFromR2, deleteImagesFromR2,
} from '../lib/r2';
import { asyncPool } from '../lib/asyncPool';
import SurveyPreview from '../components/admin/SurveyPreview';
import SurveyBuilder from '../components/admin/SurveyBuilder';
import FeatureExtractionJobs from '../components/admin/FeatureExtractionJobs';
import MediaPreannotateDialog from '../components/admin/MediaPreannotateDialog';
import { loadUserSpatialSettings } from '../lib/spatialSettingsStore';
import { runAllFeaturesForPrefix } from '../lib/runFeatureExtraction';
import { useAuth } from '../contexts/AuthContext';
import {
  featureCsvKey,
  FEATURE_MODELS,
  preannotationKey,
  SAM_PREANNOT_MODEL,
  loadFeaturesMapFromR2,
  featureStatusFromMap,
} from '../lib/imageFeaturesR2';
import AdminShell from '../components/layout/AdminShell';
import ConfirmDialog from '../components/layout/ConfirmDialog';
import AdminScopedMediaLibrary from '../components/admin/AdminScopedMediaLibrary';
import ResearchDeepSearch from '../components/admin/ResearchDeepSearch';

const projectImagePrefix = (project) => `${project.user_id}/${project.id}/`;

// ─── Edit Template Dialog ────────────────────────────────────────────────────

function EditTemplateDialog({ template, open, onClose, onSaved }) {
  const [form, setForm] = useState({});
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const [migrateProgress, setMigrateProgress] = useState({ label: '', current: 0, total: 0 });

  useEffect(() => {
    if (template) {
      setForm({
        id:                  template.id                || '',
        name:                template.name              || '',
        description:         template.description       || '',
        author:              template.author            || '',
        year:                template.year              || '',
        category:            template.category          || '',
        tags:                (template.tags || []).join(', '),
        paper_url:           template.website           || '',
        huggingface_dataset: template.huggingfaceDataset || '',
      });
      setMigrateProgress({ label: '', current: 0, total: 0 });
      setError('');
    }
  }, [template]);

  const idChanged = template && normalizeTemplateId(form.id) !== template.id;

  const handleSave = async () => {
    setSaving(true);
    setError('');
    setMigrateProgress({ label: idChanged ? '准备迁移…' : '正在保存…', current: 0, total: 0 });
    try {
      const nextId = normalizeTemplateId(form.id);
      const fields = {
        name:                form.name,
        description:         form.description,
        author:              form.author,
        year:                form.year,
        category:            form.category,
        tags:                form.tags.split(',').map(t => t.trim()).filter(Boolean),
        paper_url:           form.paper_url,
        huggingface_dataset: form.huggingface_dataset.trim() || null,
      };
      if (nextId !== template.id) {
        await renameTemplateId(template.id, nextId, fields, ({ label, current, total }) => {
          setMigrateProgress({ label, current, total });
        });
      } else {
        await updateTemplate(template.id, fields);
      }
      onSaved();
      onClose();
    } catch (err) {
      setError(err.message);
    } finally {
      setSaving(false);
      setMigrateProgress({ label: '', current: 0, total: 0 });
    }
  };

  if (!template) return null;
  return (
    <Dialog open={open} onClose={saving ? undefined : onClose} maxWidth="sm" fullWidth disableEscapeKeyDown={saving}>
      <DialogTitle>编辑模板: {template.name}</DialogTitle>
      <DialogContent>
        {error && <Alert severity="error" sx={{ mb: 2 }}>{error}</Alert>}
        <Stack spacing={2} sx={{ mt: 1 }}>
          <TextField
            label="模板 ID"
            value={form.id || ''}
            onChange={(e) => setForm((f) => ({ ...f, id: normalizeTemplateId(e.target.value) }))}
            fullWidth
            size="small"
            helperText={`云端图片路径：${templateImagePrefix(form.id || template.id)}（修改 ID 会同步移动 R2 文件夹）`}
          />
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

          {saving && (
            <Box sx={{ p: 2, bgcolor: 'action.hover', borderRadius: 1 }}>
              <Box sx={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', mb: 1 }}>
                <Typography variant="body2" sx={{ fontWeight: 500 }}>
                  {migrateProgress.label || (idChanged ? '正在迁移模板…' : '正在保存…')}
                </Typography>
                {migrateProgress.total > 0 && (
                  <Typography variant="body2" color="text.secondary">
                    {migrateProgress.current} / {migrateProgress.total}
                  </Typography>
                )}
              </Box>
              <LinearProgress
                variant={migrateProgress.total > 0 ? 'determinate' : 'indeterminate'}
                value={migrateProgress.total > 0
                  ? (migrateProgress.current / migrateProgress.total) * 100
                  : undefined}
                sx={{ height: 6, borderRadius: 3 }}
              />
            </Box>
          )}
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
    imageDatasetConfig: template.imageDatasetConfig || template.image_dataset_config || {},
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
    // Required for set/category assignment — tags live here, not on the question alone.
    imageDatasetConfig: template.imageDatasetConfig || template.image_dataset_config || {},
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
  const { user } = useAuth();
  const [hfToken, setHfToken] = useState('');
  const [falKey, setFalKey] = useState('');
  const [r2FeatureMap, setR2FeatureMap] = useState({});
  const [images, setImages] = useState([]);
  const [preannotateTarget, setPreannotateTarget] = useState(null);
  const onSavedRef = useRef(onSaved);
  useEffect(() => { onSavedRef.current = onSaved; }, [onSaved]);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      if (!open || !user?.id) return;
      const settings = await loadUserSpatialSettings(user.id);
      if (cancelled) return;
      if (settings?.huggingFaceToken) setHfToken(settings.huggingFaceToken);
      if (settings?.falApiKey) setFalKey(settings.falApiKey);
    })();
    return () => { cancelled = true; };
  }, [open, user?.id]);

  const reloadFeatures = useCallback(async () => {
    if (!template?.id || !isR2Configured()) {
      setR2FeatureMap({});
      return;
    }
    try {
      const map = await loadFeaturesMapFromR2(templateImagePrefix(template.id), FEATURE_MODELS);
      setR2FeatureMap(map);
    } catch (err) {
      console.warn(err);
    }
  }, [template?.id]);

  useEffect(() => {
    if (open && template) {
      setImages(template.preloadedImages || []);
      reloadFeatures();
    }
  }, [open, template, reloadFeatures]);

  const handlePersist = useCallback(async (payload) => {
    if (!template) return;
    await updateTemplate(template.id, payload);
    if (payload.preloaded_images) setImages(payload.preloaded_images);
    if (onSavedRef.current) onSavedRef.current({ silent: true });
  }, [template]);

  if (!template) return null;

  return (
    <Dialog open={open} onClose={onClose} maxWidth="lg" fullWidth
      PaperProps={{ sx: { minHeight: '80vh' } }}>
      <DialogTitle>
        模板媒体 — {template.name}
        <Typography variant="caption" color="text.secondary" sx={{ ml: 1 }}>
          (R2: {templateImagePrefix(template.id)})
        </Typography>
      </DialogTitle>
      <DialogContent dividers>
        <Accordion defaultExpanded={false} sx={{ mb: 2 }}>
          <AccordionSummary expandIcon={<ExpandMore />}>
            <Box>
              <Typography variant="subtitle2" fontWeight={700}>Spatial features (L0 / Seg)</Typography>
              <Typography variant="caption" color="text.secondary">
                为模板媒体预计算特征；项目导入时会按文件名自动带上
              </Typography>
            </Box>
          </AccordionSummary>
          <AccordionDetails>
            {!hfToken && (
              <Alert severity="info" sx={{ mb: 1.5 }}>
                SegFormer 需要 HuggingFace token（在 Media Dataset → Spatial Intelligence 保存）。
              </Alert>
            )}
            {!falKey && (
              <Alert severity="info" sx={{ mb: 1.5 }}>
                SAM 预标注需要 fal key（同上）。
              </Alert>
            )}
            <FeatureExtractionJobs
              r2Prefix={templateImagePrefix(template.id)}
              images={images}
              hfToken={hfToken}
              onFeaturesUpdated={setR2FeatureMap}
            />
            {images.length > 0 && (
              <Stack direction="row" spacing={1} flexWrap="wrap" useFlexGap sx={{ mt: 1.5 }}>
                {images.slice(0, 24).map((img) => {
                  const feat = featureStatusFromMap(r2FeatureMap, img, FEATURE_MODELS);
                  const samOk = feat?.status?.[SAM_PREANNOT_MODEL] === 'ready';
                  return (
                    <Chip
                      key={img.key || img.name}
                      size="small"
                      label={`${img.name}${samOk ? ' · SAM' : ''}`}
                      onClick={() => setPreannotateTarget(img)}
                      variant="outlined"
                    />
                  );
                })}
                {images.length > 24 && (
                  <Typography variant="caption" color="text.secondary">+{images.length - 24} more</Typography>
                )}
              </Stack>
            )}
          </AccordionDetails>
        </Accordion>

        <AdminScopedMediaLibrary
          r2Prefix={templateImagePrefix(template.id)}
          owner={template}
          allowTemplateKeys
          rootLabel="(template root)"
          userId={user?.id || 'admin'}
          onPersist={handlePersist}
          onImagesChange={setImages}
        />
      </DialogContent>
      <DialogActions>
        <Button onClick={onClose}>关闭</Button>
      </DialogActions>

      <MediaPreannotateDialog
        open={!!preannotateTarget}
        onClose={() => setPreannotateTarget(null)}
        mediaEntry={preannotateTarget}
        r2Prefix={template ? templateImagePrefix(template.id) : ''}
        falKey={falKey}
        projectId=""
        onSaved={() => reloadFeatures()}
      />
    </Dialog>
  );
}

// ─── Template Management Tab ─────────────────────────────────────────────────

function compareTemplateSort(a, b, sortBy) {
  switch (sortBy) {
    case 'name':
      return String(a.name || '').localeCompare(String(b.name || ''), undefined, { sensitivity: 'base' });
    case 'year': {
      const av = parseInt(String(a.year || ''), 10) || 0;
      const bv = parseInt(String(b.year || ''), 10) || 0;
      return av - bv;
    }
    case 'submitter':
      return String(a.submitter_email || '').localeCompare(String(b.submitter_email || ''), undefined, { sensitivity: 'base' });
    case 'category':
      return String(a.category || '').localeCompare(String(b.category || ''), undefined, { sensitivity: 'base' });
    case 'approved':
      return Number(!!a.is_approved) - Number(!!b.is_approved);
    case 'pinned':
      return Number(!!a.is_pinned) - Number(!!b.is_pinned);
    case 'landing':
      return Number(!!a.show_on_landing) - Number(!!b.show_on_landing);
    case 'images':
      return (a.preloadedImages?.length || 0) - (b.preloadedImages?.length || 0);
    case 'createdAt': {
      const av = a.createdAt ? new Date(a.createdAt).getTime() : 0;
      const bv = b.createdAt ? new Date(b.createdAt).getTime() : 0;
      return av - bv;
    }
    default:
      return 0;
  }
}

function TemplateSortLabel({ column, label, align, sortBy, sortOrder, onSort }) {
  return (
    <TableCell align={align} sortDirection={sortBy === column ? sortOrder : false}>
      <TableSortLabel
        active={sortBy === column}
        direction={sortBy === column ? sortOrder : 'asc'}
        onClick={() => onSort(column)}
      >
        {label}
      </TableSortLabel>
    </TableCell>
  );
}

function TemplateManagement() {
  const { user } = useAuth();
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
  const [seedConfirmOpen, setSeedConfirmOpen] = useState(false);
  const [seedPreview, setSeedPreview]     = useState(null);
  const [seedPreviewLoading, setSeedPreviewLoading] = useState(false);
  /** Selected builtin template ids in the import confirm dialog. */
  const [seedSelectedIds, setSeedSelectedIds] = useState(() => new Set());
  const [sortBy, setSortBy]               = useState('year');
  const [sortOrder, setSortOrder]         = useState('desc');
  const [confirmDialog, setConfirmDialog] = useState(null);
  const [bulkFeat, setBulkFeat]           = useState({
    active: false,
    phase: '',
    templateIndex: 0,
    templateTotal: 0,
    templateName: '',
    imageDone: 0,
    imageTotal: 0,
    log: '',
  });
  const bulkAbortRef = useRef(false);

  const showSnack = (msg, sev = 'success') => setSnack({ open: true, msg, sev });

  const handleSort = (column) => {
    if (sortBy === column) {
      setSortOrder((o) => (o === 'asc' ? 'desc' : 'asc'));
    } else {
      setSortBy(column);
      setSortOrder(['createdAt', 'year', 'images', 'approved', 'landing', 'pinned'].includes(column) ? 'desc' : 'asc');
    }
  };

  const sortedTemplates = useMemo(() => {
    const dir = sortOrder === 'asc' ? 1 : -1;
    return [...templates].sort((a, b) => compareTemplateSort(a, b, sortBy) * dir);
  }, [templates, sortBy, sortOrder]);

  const load = useCallback(async () => {
    setLoading(true);
    const data = await listAllTemplates();
    setTemplates(data);
    setLoading(false);
  }, []);

  useEffect(() => { load(); }, [load]);

  const handleBulkFeatures = async ({ runL0 = true, runSeg = true } = {}) => {
    if (!isR2Configured()) {
      showSnack('R2 未配置，无法写入 feature CSV', 'error');
      return;
    }
    if (runSeg) {
      const settings = user?.id ? await loadUserSpatialSettings(user.id) : null;
      if (!String(settings?.huggingFaceToken || '').trim()) {
        showSnack('请先在任意项目的 Spatial Intelligence 中保存 HuggingFace token', 'error');
        return;
      }
    }

    const candidates = templates;
    if (!candidates.length) {
      showSnack('暂无模板', 'warning');
      return;
    }

    const label = runL0 && runSeg ? 'L0 + Seg' : runL0 ? 'L0' : 'Seg';
    const estimatedWithImages = candidates.filter((t) => (t.preloadedImages?.length || 0) > 0).length;
    setConfirmDialog({
      title: `一键提取全部模板 ${label}`,
      message:
        `将扫描全部 ${candidates.length} 个模板（约 ${estimatedWithImages} 个已登记图片），`
        + `对实际有图的依次提取 ${label}；已完成的图片会跳过，写入方式与单模板图片页相同。可随时停止。`,
      confirmLabel: '开始',
      confirmColor: 'primary',
      onConfirm: async () => {
        setConfirmDialog(null);
        bulkAbortRef.current = false;
        const settings = user?.id ? await loadUserSpatialSettings(user.id) : null;
        const hfToken = settings?.huggingFaceToken || '';

        let templatesDone = 0;
        let templatesWithImages = 0;
        let imagesL0 = 0;
        let imagesSeg = 0;
        let imagesSkippedL0 = 0;
        let imagesSkippedSeg = 0;
        const errors = [];

        setBulkFeat({
          active: true,
          phase: 'scan',
          templateIndex: 0,
          templateTotal: candidates.length,
          templateName: '',
          imageDone: 0,
          imageTotal: 0,
          log: `开始批量 ${label}：扫描 ${candidates.length} 个模板…`,
        });

        for (let i = 0; i < candidates.length; i += 1) {
          if (bulkAbortRef.current) break;
          const t = candidates[i];
          const prefix = templateImagePrefix(t.id);
          setBulkFeat((s) => ({
            ...s,
            phase: 'list',
            templateIndex: i + 1,
            templateName: t.name || t.id,
            imageDone: 0,
            imageTotal: 0,
            log: `[${i + 1}/${candidates.length}] ${t.name || t.id} — 列出图片…`,
          }));

          let images = [];
          try {
            const listed = await listImagesFromR2(prefix);
            if (listed.success && listed.images?.length) {
              images = listed.images
                .filter((img) => {
                  const key = String(img.key || img.name || '');
                  return !key.includes('/features/') && !key.includes('/preannotations/');
                })
                .map((img) => normalizeMediaEntry({
                  url: img.url,
                  name: img.name,
                  type: img.type || inferMediaType(img.name),
                }))
                .filter((m) => m && m.type === 'image' && m.url);
            }
          } catch (err) {
            console.warn(err);
          }
          if (!images.length && t.preloadedImages?.length) {
            images = t.preloadedImages
              .map((img) => normalizeMediaEntry(img))
              .filter((m) => m && m.type === 'image' && m.url);
          }
          if (!images.length) continue;

          templatesWithImages += 1;
          try {
            // eslint-disable-next-line no-await-in-loop
            const result = await runAllFeaturesForPrefix({
              r2Prefix: prefix,
              images,
              hfToken,
              runL0,
              runSeg,
              shouldAbort: () => bulkAbortRef.current,
              onProgress: ({ phase, done, total }) => {
                setBulkFeat((s) => ({
                  ...s,
                  phase,
                  templateIndex: i + 1,
                  templateName: t.name || t.id,
                  imageDone: done,
                  imageTotal: total,
                  log: `[${i + 1}/${candidates.length}] ${t.name || t.id} — ${phase.toUpperCase()} ${done}/${total}`,
                }));
              },
            });
            imagesL0 += result.l0?.done || 0;
            imagesSeg += result.seg?.done || 0;
            imagesSkippedL0 += result.l0?.skipped || 0;
            imagesSkippedSeg += result.seg?.skipped || 0;
            templatesDone += 1;
            if (result.stopped) break;
          } catch (err) {
            errors.push(`${t.id}: ${err.message || String(err)}`);
            setBulkFeat((s) => ({
              ...s,
              log: `[${i + 1}/${candidates.length}] ${t.name || t.id} — 失败: ${err.message || err}`,
            }));
          }
        }

        const stopped = bulkAbortRef.current;
        setBulkFeat((s) => ({
          ...s,
          active: false,
          phase: '',
          log: stopped
            ? `已停止。处理 ${templatesDone}/${templatesWithImages} 个有图模板（共扫描 ${candidates.length}）。L0 新写 ${imagesL0}（跳过 ${imagesSkippedL0}），Seg 新写 ${imagesSeg}（跳过 ${imagesSkippedSeg}）。`
            : `完成。处理 ${templatesDone}/${templatesWithImages} 个有图模板（共扫描 ${candidates.length}）。L0 新写 ${imagesL0}（跳过 ${imagesSkippedL0}），Seg 新写 ${imagesSeg}（跳过 ${imagesSkippedSeg}）。`
              + (errors.length ? ` 错误 ${errors.length} 条。` : ''),
        }));
        showSnack(
          stopped ? '批量特征提取已停止' : (errors.length ? `批量完成，有 ${errors.length} 个错误` : '批量特征提取完成'),
          errors.length ? 'warning' : 'success',
        );
        if (errors.length) {
          console.warn('Bulk feature errors:', errors);
        }
      },
    });
  };

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

  const handlePin = async (id, value) => {
    try {
      await updateTemplate(id, { is_pinned: value });
      showSnack(value ? '已置顶（所有用户模板库优先显示）' : '已取消置顶');
      load();
    } catch (err) {
      showSnack(err.message, 'error');
    }
  };

  const handleDelete = (id, name) => {
    setConfirmDialog({
      title: '删除模板',
      message: `确认删除模板 "${name}" 吗？此操作不可恢复。`,
      confirmLabel: '删除',
      confirmColor: 'error',
      onConfirm: async () => {
        setConfirmDialog(null);
        try {
          // Best-effort cleanup of R2 image folder before removing the row.
          // We don't block deletion on this failing — orphans are easy to spot
          // and the user explicitly opted into a destructive action.
          if (isR2Configured()) {
            try {
              const listed = await listImagesFromR2(templateImagePrefix(id));
              if (listed.success && listed.images.length > 0) {
                await deleteImagesFromR2(listed.images.map((img) => img.key), { allowTemplateKeys: true });
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
      },
    });
  };

  const handleOpenSeedConfirm = async () => {
    setSeedPreviewLoading(true);
    setSeedPreview(null);
    setSeedSelectedIds(new Set());
    setSeedConfirmOpen(true);
    try {
      const preview = await previewBuiltinTemplateImport(templates.map((t) => t.id));
      setSeedPreview(preview);
      // Default: select new imports; leave updates unchecked so overwrite is intentional.
      setSeedSelectedIds(new Set((preview.toInsert || []).map((item) => item.id)));
    } catch (err) {
      showSnack(err.message, 'error');
      setSeedConfirmOpen(false);
    } finally {
      setSeedPreviewLoading(false);
    }
  };

  const seedSelectableItems = useMemo(() => {
    if (!seedPreview) return [];
    return [
      ...(seedPreview.toInsert || []).map((item) => ({ ...item, action: 'insert' })),
      ...(seedPreview.toUpdate || []).map((item) => ({ ...item, action: 'update' })),
    ];
  }, [seedPreview]);

  const toggleSeedSelected = (id) => {
    setSeedSelectedIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const setSeedSelectionForAction = (action, checked) => {
    setSeedSelectedIds((prev) => {
      const next = new Set(prev);
      seedSelectableItems
        .filter((item) => item.action === action)
        .forEach((item) => {
          if (checked) next.add(item.id);
          else next.delete(item.id);
        });
      return next;
    });
  };

  const handleConfirmSeed = async () => {
    const idsToImport = seedSelectableItems
      .map((item) => item.id)
      .filter((id) => seedSelectedIds.has(id));
    if (!idsToImport.length) return;
    const selectedInsert = (seedPreview?.toInsert || []).filter((i) => seedSelectedIds.has(i.id)).length;
    const selectedUpdate = (seedPreview?.toUpdate || []).filter((i) => seedSelectedIds.has(i.id)).length;
    setSeeding(true);
    setSeedLog('');
    setSeedConfirmOpen(false);
    try {
      const result = await seedBuiltinTemplates({
        idsToImport,
        onProgress: ({ inserted, updated, skipped, total, current }) => {
          setSeedLog(
            `进度: 新增 ${inserted} / 更新 ${updated ?? 0} / 跳过 ${skipped} / 共 ${total} — ${current}`,
          );
        },
      });
      showSnack(
        `导入完成: 新增 ${result.inserted} 条, 更新 ${result.updated ?? 0} 条`
        + (result.skipped ? `, 跳过 ${result.skipped} 条` : '')
        + `（勾选 ${selectedInsert} 新 / ${selectedUpdate} 更新）`,
      );
      const parts = [];
      if (result.errors?.length) parts.push('错误: ' + result.errors.join('; '));
      if (result.warnings?.length) parts.push('提示: ' + result.warnings.join('; '));
      setSeedLog(parts.join('\n') || '');
      load();
    } catch (err) {
      showSnack(err.message, 'error');
    } finally {
      setSeeding(false);
      setSeedPreview(null);
      setSeedSelectedIds(new Set());
    }
  };

  return (
    <Box>
      <Stack direction="row" spacing={2} sx={{ mb: 2 }} alignItems="center" flexWrap="wrap">
        <Typography variant="h6">模板管理</Typography>
        <Box flex={1} />
        <Tooltip title="对所有有图片的模板依次跑 L0 + Seg（跳过已完成，写入 R2 CSV）">
          <span>
            <Button
              variant="contained"
              color="secondary"
              startIcon={bulkFeat.active ? <CircularProgress size={16} color="inherit" /> : <AutoFixHigh />}
              onClick={() => handleBulkFeatures({ runL0: true, runSeg: true })}
              disabled={bulkFeat.active || seeding || loading}
            >
              一键提取全部 Features
            </Button>
          </span>
        </Tooltip>
        {bulkFeat.active && (
          <Button
            variant="outlined"
            color="warning"
            startIcon={<Stop />}
            onClick={() => { bulkAbortRef.current = true; }}
          >
            停止
          </Button>
        )}
        <Tooltip title="导入或更新本地内置模板到 Supabase（已存在的会覆盖问卷配置）">
          <Button
            variant="outlined"
            startIcon={seeding ? <CircularProgress size={16} /> : <CloudUpload />}
            onClick={handleOpenSeedConfirm}
            disabled={seeding || seedPreviewLoading || bulkFeat.active}
          >
            导入内置模板
          </Button>
        </Tooltip>
        <Button startIcon={<Refresh />} onClick={load} disabled={loading || bulkFeat.active}>
          刷新
        </Button>
      </Stack>

      {(seedLog || bulkFeat.log) && (
        <Alert
          severity={bulkFeat.active ? 'info' : 'info'}
          sx={{ mb: 2 }}
          onClose={bulkFeat.active ? undefined : () => {
            setSeedLog('');
            setBulkFeat((s) => ({ ...s, log: '' }));
          }}
        >
          {bulkFeat.log || seedLog}
          {bulkFeat.active && bulkFeat.imageTotal > 0 && (
            <Box sx={{ mt: 1 }}>
              <Typography variant="caption" display="block" sx={{ mb: 0.5 }}>
                模板 {bulkFeat.templateIndex}/{bulkFeat.templateTotal}
                {bulkFeat.templateName ? ` · ${bulkFeat.templateName}` : ''}
                {' · '}
                {(bulkFeat.phase || '').toUpperCase()} {bulkFeat.imageDone}/{bulkFeat.imageTotal}
              </Typography>
              <LinearProgress
                variant="determinate"
                value={(100 * bulkFeat.imageDone) / bulkFeat.imageTotal}
              />
            </Box>
          )}
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
                <TemplateSortLabel column="name" label="名称" sortBy={sortBy} sortOrder={sortOrder} onSort={handleSort} />
                <TemplateSortLabel column="year" label="年份" align="center" sortBy={sortBy} sortOrder={sortOrder} onSort={handleSort} />
                <TemplateSortLabel column="submitter" label="提交者" sortBy={sortBy} sortOrder={sortOrder} onSort={handleSort} />
                <TemplateSortLabel column="category" label="分类" sortBy={sortBy} sortOrder={sortOrder} onSort={handleSort} />
                <TemplateSortLabel column="approved" label="已批准" align="center" sortBy={sortBy} sortOrder={sortOrder} onSort={handleSort} />
                <TemplateSortLabel column="pinned" label="置顶" align="center" sortBy={sortBy} sortOrder={sortOrder} onSort={handleSort} />
                <TemplateSortLabel column="landing" label="首页展示" align="center" sortBy={sortBy} sortOrder={sortOrder} onSort={handleSort} />
                <TemplateSortLabel column="images" label="图片" align="center" sortBy={sortBy} sortOrder={sortOrder} onSort={handleSort} />
                <TemplateSortLabel column="createdAt" label="提交时间" sortBy={sortBy} sortOrder={sortOrder} onSort={handleSort} />
                <TableCell align="center">操作</TableCell>
              </TableRow>
            </TableHead>
            <TableBody>
              {sortedTemplates.length === 0 && (
                <TableRow>
                  <TableCell colSpan={10} align="center" sx={{ py: 4, color: 'text.secondary' }}>
                    暂无模板数据
                  </TableCell>
                </TableRow>
              )}
              {sortedTemplates.map(t => (
                <TableRow key={t.id} hover sx={t.is_pinned ? { bgcolor: 'warning.50' } : undefined}>
                  <TableCell>
                    <Stack direction="row" spacing={0.75} alignItems="center">
                      {t.is_pinned && (
                        <PushPin fontSize="small" color="warning" sx={{ transform: 'rotate(45deg)' }} />
                      )}
                      <Box>
                        <Typography variant="body2" fontWeight={600}>{t.name}</Typography>
                        <Typography variant="caption" color="text.secondary">{t.id}</Typography>
                      </Box>
                    </Stack>
                  </TableCell>
                  <TableCell align="center">
                    <Typography variant="body2">{t.year || '—'}</Typography>
                  </TableCell>
                  <TableCell>
                    <Stack direction="row" spacing={0.75} alignItems="center" flexWrap="wrap" useFlexGap>
                      <Typography variant="body2">{t.submitter_email || '—'}</Typography>
                      {Array.isArray(t.tags) && t.tags.includes('paper-request') && (
                        <Chip size="small" color="info" variant="outlined" label="Paper request" />
                      )}
                    </Stack>
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
                    <Tooltip title="置顶后，所有用户在编辑页模板库中优先看到此模板">
                      <Switch
                        size="small"
                        checked={!!t.is_pinned}
                        onChange={e => handlePin(t.id, e.target.checked)}
                        color="warning"
                        disabled={!t.is_approved}
                      />
                    </Tooltip>
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

      <Dialog
        open={seedConfirmOpen}
        onClose={() => !seeding && setSeedConfirmOpen(false)}
        maxWidth="md"
        fullWidth
      >
        <DialogTitle>确认导入内置模板</DialogTitle>
        <DialogContent dividers>
          {seedPreviewLoading ? (
            <Box sx={{ display: 'flex', justifyContent: 'center', py: 4 }}>
              <CircularProgress />
            </Box>
          ) : seedPreview ? (
            <Stack spacing={2}>
              <Typography variant="body2" color="text.secondary">
                勾选要处理的内置模板。新模板会导入；已存在的会<strong>覆盖</strong>问卷配置与元数据（有图片包则刷新图库）。
                默认只勾选「新建」项，更新项需手动勾选。
              </Typography>
              <Stack direction="row" spacing={1} flexWrap="wrap" useFlexGap alignItems="center">
                <Chip
                  size="small"
                  color="success"
                  label={`已选新建 ${(seedPreview.toInsert || []).filter((i) => seedSelectedIds.has(i.id)).length}/${seedPreview.toInsert.length}`}
                />
                <Chip
                  size="small"
                  color="warning"
                  label={`已选更新 ${(seedPreview.toUpdate || []).filter((i) => seedSelectedIds.has(i.id)).length}/${(seedPreview.toUpdate || []).length}`}
                />
                <Button size="small" onClick={() => setSeedSelectionForAction('insert', true)}>全选新建</Button>
                <Button size="small" onClick={() => setSeedSelectionForAction('update', true)}>全选更新</Button>
                <Button size="small" onClick={() => setSeedSelectedIds(new Set())}>清空</Button>
                {(seedPreview.invalid.length + seedPreview.errors.length) > 0 && (
                  <Chip
                    size="small"
                    color="default"
                    label={`无法处理 ${seedPreview.invalid.length + seedPreview.errors.length} 个`}
                  />
                )}
              </Stack>
              <TableContainer component={Paper} variant="outlined" sx={{ maxHeight: 420 }}>
                <Table size="small" stickyHeader>
                  <TableHead>
                    <TableRow sx={{ '& th': { fontWeight: 700, bgcolor: 'grey.50' } }}>
                      <TableCell padding="checkbox">
                        <Checkbox
                          size="small"
                          indeterminate={
                            seedSelectedIds.size > 0
                            && seedSelectedIds.size < seedSelectableItems.length
                          }
                          checked={
                            seedSelectableItems.length > 0
                            && seedSelectedIds.size === seedSelectableItems.length
                          }
                          onChange={(e) => {
                            if (e.target.checked) {
                              setSeedSelectedIds(new Set(seedSelectableItems.map((i) => i.id)));
                            } else {
                              setSeedSelectedIds(new Set());
                            }
                          }}
                          inputProps={{ 'aria-label': '全选' }}
                        />
                      </TableCell>
                      <TableCell>状态</TableCell>
                      <TableCell>ID</TableCell>
                      <TableCell>名称</TableCell>
                      <TableCell>作者</TableCell>
                      <TableCell align="center">年份</TableCell>
                      <TableCell align="center">页数</TableCell>
                      <TableCell align="center">图片</TableCell>
                      <TableCell>文件</TableCell>
                    </TableRow>
                  </TableHead>
                  <TableBody>
                    {seedSelectableItems.map((item) => {
                      const checked = seedSelectedIds.has(item.id);
                      const isUpdate = item.action === 'update';
                      return (
                        <TableRow
                          key={`${item.action}-${item.id}`}
                          hover
                          selected={checked}
                          onClick={() => toggleSeedSelected(item.id)}
                          sx={{ cursor: 'pointer' }}
                        >
                          <TableCell padding="checkbox" onClick={(e) => e.stopPropagation()}>
                            <Checkbox
                              size="small"
                              checked={checked}
                              onChange={() => toggleSeedSelected(item.id)}
                            />
                          </TableCell>
                          <TableCell>
                            <Chip
                              size="small"
                              color={isUpdate ? 'warning' : 'success'}
                              label={
                                isUpdate
                                  ? (item.willRefreshImages ? '更新+图片' : '更新')
                                  : '新建'
                              }
                            />
                          </TableCell>
                          <TableCell>
                            <Typography variant="caption">{item.id}</Typography>
                          </TableCell>
                          <TableCell>{item.name}</TableCell>
                          <TableCell>{item.author || '—'}</TableCell>
                          <TableCell align="center">{item.year || '—'}</TableCell>
                          <TableCell align="center">{item.pageCount}</TableCell>
                          <TableCell align="center">{item.imageCount}</TableCell>
                          <TableCell>
                            <Typography variant="caption" color="text.secondary">{item.filename}</Typography>
                          </TableCell>
                        </TableRow>
                      );
                    })}
                    {seedSelectableItems.length === 0 && (
                      <TableRow>
                        <TableCell colSpan={9} align="center" sx={{ py: 3, color: 'text.secondary' }}>
                          没有可预览的内置模板
                        </TableCell>
                      </TableRow>
                    )}
                  </TableBody>
                </Table>
              </TableContainer>
              {seedPreview.invalid.length > 0 && (
                <Alert severity="warning">
                  无效模板: {seedPreview.invalid.map((i) => `${i.filename} (${i.reason})`).join('；')}
                </Alert>
              )}
              {seedPreview.errors.length > 0 && (
                <Alert severity="error">
                  加载失败: {seedPreview.errors.map((e) => `${e.filename} (${e.reason})`).join('；')}
                </Alert>
              )}
            </Stack>
          ) : null}
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setSeedConfirmOpen(false)} disabled={seeding}>
            取消
          </Button>
          <Button
            variant="contained"
            onClick={handleConfirmSeed}
            disabled={seeding || seedPreviewLoading || seedSelectedIds.size === 0}
          >
            {seedSelectedIds.size
              ? `确认处理已选 ${seedSelectedIds.size} 个`
              : '请先勾选模板'}
          </Button>
        </DialogActions>
      </Dialog>

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
            onRepairComplete={async (fixed) => {
              setDraftConfig(fixed);
              await updateProjectAdmin(project.id, { survey_config: fixed });
              onSaved?.();
            }}
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
  const onSavedRef = useRef(onSaved);
  useEffect(() => { onSavedRef.current = onSaved; }, [onSaved]);

  const handlePersist = useCallback(async (payload) => {
    if (!project) return;
    await updateProjectAdmin(project.id, payload);
    if (onSavedRef.current) onSavedRef.current({ silent: true });
  }, [project]);

  if (!project) return null;

  return (
    <Dialog open={open} onClose={onClose} maxWidth="lg" fullWidth
      PaperProps={{ sx: { minHeight: '80vh' } }}>
      <DialogTitle>
        项目媒体 — {project.name}
        <Typography variant="caption" color="text.secondary" sx={{ ml: 1 }}>
          (R2: {project.user_id ? projectImagePrefix(project) : 'n/a'})
        </Typography>
      </DialogTitle>
      <DialogContent dividers>
        {!project.user_id && (
          <Alert severity="warning" sx={{ mb: 2 }}>
            该项目没有 user_id，无法管理 R2 媒体。
          </Alert>
        )}
        {project.user_id && (
          <AdminScopedMediaLibrary
            r2Prefix={projectImagePrefix(project)}
            owner={project}
            rootLabel="(project root)"
            userId={project.user_id}
            onPersist={handlePersist}
          />
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
  const [confirmDialog, setConfirmDialog] = useState(null);
  const [repairingId, setRepairingId]     = useState(null);

  const showSnack = (msg, sev = 'success') => setSnack({ open: true, msg, sev });

  const load = useCallback(async () => {
    setLoading(true);
    const data = await listAllProjects();
    setProjects(data);
    setLoading(false);
  }, []);

  useEffect(() => { load(); }, [load]);

  const projectsWithDupIds = useMemo(
    () => projects
      .map((p) => ({
        project: p,
        dups: findDuplicateQuestionNames(p.config),
      }))
      .filter((row) => row.dups.length > 0),
    [projects],
  );

  const handleRepairDuplicates = (project) => {
    const dups = findDuplicateQuestionNames(project.config);
    if (!dups.length) return;
    const names = dups.map((d) => `"${d.name}"×${d.count}`).join(', ');
    setConfirmDialog({
      title: '修复重复题目 ID',
      message: (
        <Box>
          <Typography variant="body2" sx={{ mb: 1 }}>
            项目「{project.name}」存在重复 question id：{names}
          </Typography>
          <Typography variant="body2" color="text.secondary">
            将保留第一次出现的 id，给后续副本自动改名并写入数据库。已收集答卷里写在旧共享 id 下的答案无法自动拆分。
          </Typography>
        </Box>
      ),
      confirmLabel: '修复并保存',
      confirmColor: 'warning',
      onConfirm: async () => {
        setConfirmDialog(null);
        setRepairingId(project.id);
        try {
          const { config: fixed, renames, remainingDuplicates } = repairDuplicateQuestionNames(project.config);
          if (!renames.length) {
            throw new Error('未能生成任何改名（配置可能异常）。请打开「编辑调查内容」手动改 name。');
          }
          if (remainingDuplicates?.length) {
            throw new Error(`仍有 ${remainingDuplicates.length} 组重复 id，请手动处理：${remainingDuplicates.map((d) => d.name).join(', ')}`);
          }
          const result = await updateProjectAdmin(project.id, { survey_config: fixed });
          // Verify persisted config no longer has duplicates
          const savedConfig = result.project?.survey_config || fixed;
          const still = findDuplicateQuestionNames(savedConfig);
          if (still.length) {
            throw new Error('数据库返回的配置仍有重复 id，请检查权限或稍后重试。');
          }
          showSnack(`已修复并保存 ${renames.length} 个重复 id`);
          await load();
        } catch (err) {
          showSnack(err.message, 'error');
        } finally {
          setRepairingId(null);
        }
      },
    });
  };

  const handleDelete = (project) => {
    setConfirmDialog({
      title: '删除项目',
      message: `确认删除项目 "${project.name}" 吗？此操作不可恢复。`,
      confirmLabel: '删除',
      confirmColor: 'error',
      onConfirm: async () => {
        setConfirmDialog(null);
        try {
          if (isR2Configured() && project.user_id) {
            try {
              const listed = await listImagesFromR2(projectImagePrefix(project));
              if (listed.success && listed.images.length > 0) {
                const prefix = projectImagePrefix(project);
                await deleteImagesFromR2(
                  listed.images.map((img) => img.key),
                  { allowedPrefix: prefix },
                );
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
      },
    });
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

      {projectsWithDupIds.length > 0 && (
        <Alert severity="error" sx={{ mb: 2 }}>
          <Typography variant="subtitle2" sx={{ mb: 0.5 }}>
            发现 {projectsWithDupIds.length} 个项目存在重复题目 ID
          </Typography>
          <Typography variant="body2" color="text.secondary" sx={{ mb: 1 }}>
            同名题目会导致答卷互相覆盖。可在对应行点击「修复重复 ID」。已收数据无法按副本自动拆分。
          </Typography>
          {projectsWithDupIds.slice(0, 8).map(({ project, dups }) => (
            <Typography key={project.id} variant="caption" display="block">
              • {project.name || project.id}：{dups.map((d) => `${d.name}×${d.count}`).join(', ')}
            </Typography>
          ))}
          {projectsWithDupIds.length > 8 && (
            <Typography variant="caption">…还有 {projectsWithDupIds.length - 8} 个</Typography>
          )}
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
              {projects.map(p => {
                const dups = findDuplicateQuestionNames(p.config);
                return (
                <TableRow key={p.id} hover>
                  <TableCell>
                    <Typography variant="body2" fontWeight={600}>{p.name || '未命名'}</Typography>
                    <Typography variant="caption" color="text.secondary">{p.id}</Typography>
                    {dups.length > 0 && (
                      <Chip
                        size="small"
                        color="error"
                        label={`重复ID ${dups.length}`}
                        sx={{ mt: 0.5 }}
                      />
                    )}
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
                      {dups.length > 0 && (
                        <Tooltip title="修复重复题目 ID">
                          <Button
                            size="small"
                            color="warning"
                            variant="outlined"
                            disabled={repairingId === p.id}
                            onClick={() => handleRepairDuplicates(p)}
                          >
                            {repairingId === p.id ? '修复中…' : '修复重复ID'}
                          </Button>
                        </Tooltip>
                      )}
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
                );
              })}
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
  const [confirmDialog, setConfirmDialog] = useState(null);
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

  const handleDeleteOne = (item) => {
    setConfirmDialog({
      title: '删除预览媒体',
      message: `确认删除「${item.name}」吗？`,
      confirmLabel: '删除',
      confirmColor: 'error',
      onConfirm: async () => {
        setConfirmDialog(null);
        const result = await deleteImagesFromR2([item.key || `${SKILL_PREVIEW_PREFIX}${item.name}`]);
        if (!result.success) { setError(result.error || 'Delete failed'); return; }
        refresh();
      },
    });
  };

  const handleClear = () => {
    if (!media.length) return;
    setConfirmDialog({
      title: '清空预览媒体库',
      message: `确认清空全部 ${media.length} 个预览媒体吗？此操作不可恢复。`,
      confirmLabel: '清空',
      confirmColor: 'error',
      onConfirm: async () => {
        setConfirmDialog(null);
        const result = await deleteImagesFromR2(media.map((m) => m.key || `${SKILL_PREVIEW_PREFIX}${m.name}`));
        if (!result.success) { setError(result.error || 'Delete failed'); return; }
        setInfo('已清空预览媒体库。');
        refresh();
      },
    });
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

      <ConfirmDialog
        open={Boolean(confirmDialog)}
        title={confirmDialog?.title}
        message={confirmDialog?.message}
        confirmLabel={confirmDialog?.confirmLabel}
        confirmColor={confirmDialog?.confirmColor || 'error'}
        onConfirm={() => confirmDialog?.onConfirm?.()}
        onCancel={() => setConfirmDialog(null)}
      />
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
  const [confirmDialog, setConfirmDialog] = useState(null);
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

  const handleDelete = (id, name) => {
    setConfirmDialog({
      title: '删除 Skill',
      message: `确认删除 Skill "${name}" 吗？`,
      confirmLabel: '删除',
      confirmColor: 'error',
      onConfirm: async () => {
        setConfirmDialog(null);
        try {
          await deleteSkill(id);
          showSnack('已删除');
          load();
        } catch (err) { showSnack(err.message, 'error'); }
      },
    });
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

// ─── Live Surveys Management ─────────────────────────────────────────────────

function LiveSurveyManagement() {
  const [listings, setListings] = useState([]);
  const [loading, setLoading] = useState(true);
  const [filter, setFilter] = useState('all');
  const [snack, setSnack] = useState({ open: false, msg: '', sev: 'success' });
  const [confirmDialog, setConfirmDialog] = useState(null);
  const showSnack = (msg, sev = 'success') => setSnack({ open: true, msg, sev });

  const load = useCallback(async () => {
    setLoading(true);
    setListings(await listAllLiveSurveys());
    setLoading(false);
  }, []);

  useEffect(() => { load(); }, [load]);

  const reviewerEmail = async () => {
    try {
      const { data: { user } } = await supabase.auth.getUser();
      return user?.email || null;
    } catch {
      return null;
    }
  };

  const handleApprove = async (id) => {
    try {
      await approveLiveListing(id, await reviewerEmail());
      showSnack('已批准 / 已应用时间窗');
      load();
    } catch (err) { showSnack(err.message, 'error'); }
  };

  const handleRevoke = (id, title) => {
    setConfirmDialog({
      title: '撤销 Live 上架',
      message: `撤销 Live 上架「${title}」？参与者直链在窗口外也会被关闭。`,
      confirmLabel: '撤销',
      confirmColor: 'warning',
      onConfirm: async () => {
        setConfirmDialog(null);
        try {
          await revokeLiveListing(id, 'Revoked by admin', await reviewerEmail());
          showSnack('已撤销');
          load();
        } catch (err) { showSnack(err.message, 'error'); }
      },
    });
  };

  const handleShowOnLive = async (id, value) => {
    try {
      await updateLiveListing(id, { show_on_live: value });
      showSnack(value ? '已显示在 Live 页' : '已从 Live 页隐藏');
      load();
    } catch (err) { showSnack(err.message, 'error'); }
  };

  const handleDelete = (id, title) => {
    setConfirmDialog({
      title: '删除申请记录',
      message: `永久删除申请记录「${title}」？`,
      confirmLabel: '删除',
      confirmColor: 'error',
      onConfirm: async () => {
        setConfirmDialog(null);
        try {
          await deleteLiveListing(id);
          showSnack('已删除');
          load();
        } catch (err) { showSnack(err.message, 'error'); }
      },
    });
  };

  const filtered = listings.filter((l) => {
    const phase = computeLiveStatus(l);
    if (filter === 'pending') return l.status === 'pending' || l.has_pending_window_change;
    if (filter === 'approved') return l.status === 'approved';
    if (filter === 'expired') return l.status === 'approved' && phase === 'closed';
    if (filter === 'revoked') return l.status === 'revoked';
    return true;
  });

  return (
    <Box>
      <Stack direction="row" spacing={2} sx={{ mb: 2 }} alignItems="center" flexWrap="wrap">
        <Typography variant="h6">Live Surveys 审核</Typography>
        <FormControl size="small" sx={{ minWidth: 160 }}>
          <InputLabel>筛选</InputLabel>
          <Select value={filter} label="筛选" onChange={(e) => setFilter(e.target.value)}>
            <MenuItem value="all">全部</MenuItem>
            <MenuItem value="pending">待审核 / 时间窗变更</MenuItem>
            <MenuItem value="approved">已批准</MenuItem>
            <MenuItem value="expired">已过期（仍批准）</MenuItem>
            <MenuItem value="revoked">已撤销</MenuItem>
          </Select>
        </FormControl>
        <Box flex={1} />
        <Button startIcon={<Refresh />} onClick={load} disabled={loading}>刷新</Button>
      
      </Stack>
      {loading ? <CircularProgress /> : (
        <TableContainer component={Paper} variant="outlined">
          <Table size="small">
            <TableHead>
              <TableRow sx={{ '& th': { fontWeight: 700, bgcolor: 'grey.50' } }}>
                <TableCell>标题</TableCell>
                <TableCell>项目 ID</TableCell>
                <TableCell>提交者</TableCell>
                <TableCell>在线窗口</TableCell>
                <TableCell align="center">状态</TableCell>
                <TableCell align="center">Live 页</TableCell>
                <TableCell align="center">操作</TableCell>
              </TableRow>
            </TableHead>
            <TableBody>
              {filtered.length === 0 && (
                <TableRow>
                  <TableCell colSpan={7} align="center" sx={{ py: 4, color: 'text.secondary' }}>
                    暂无记录
                  </TableCell>
                </TableRow>
              )}
              {filtered.map((l) => {
                const phase = computeLiveStatus(l);
                return (
                  <TableRow key={l.id} hover>
                    <TableCell>
                      <Typography variant="body2" fontWeight={600}>{l.title}</Typography>
                      <Typography variant="caption" color="text.secondary" display="block">
                        {l.author || '—'} · {l.category}
                      </Typography>
                      {l.has_pending_window_change && (
                        <Chip size="small" color="warning" label="时间窗变更待审" sx={{ mt: 0.5 }} />
                      )}
                    </TableCell>
                    <TableCell>
                      <Typography variant="caption" sx={{ fontFamily: 'monospace' }}>{l.project_id}</Typography>
                    </TableCell>
                    <TableCell>{l.submitter_email || '—'}</TableCell>
                    <TableCell>
                      <Typography variant="caption" display="block">
                        {formatLiveWindow(l.online_start, l.online_end)}
                      </Typography>
                      {l.has_pending_window_change && (
                        <Typography variant="caption" color="warning.main" display="block">
                          待审: {formatLiveWindow(l.pending_online_start, l.pending_online_end)}
                        </Typography>
                      )}
                      {l.status === 'approved' && (
                        <Chip
                          size="small"
                          sx={{ mt: 0.5 }}
                          label={phase}
                          color={phase === 'online' ? 'success' : phase === 'upcoming' ? 'info' : 'default'}
                        />
                      )}
                    </TableCell>
                    <TableCell align="center">
                      <Chip
                        size="small"
                        label={l.status}
                        color={l.status === 'approved' ? 'success' : l.status === 'pending' ? 'warning' : 'default'}
                      />
                    </TableCell>
                    <TableCell align="center">
                      <Switch
                        size="small"
                        checked={!!l.show_on_live && l.status === 'approved'}
                        disabled={l.status !== 'approved'}
                        onChange={(e) => handleShowOnLive(l.id, e.target.checked)}
                        color="success"
                      />
                    </TableCell>
                    <TableCell align="center">
                      <Stack direction="row" spacing={0.5} justifyContent="center" flexWrap="wrap">
                        {(l.status === 'pending' || l.has_pending_window_change) && (
                          <Button size="small" variant="contained" color="success" onClick={() => handleApprove(l.id)}>
                            批准
                          </Button>
                        )}
                        <Tooltip title="打开问卷">
                          <IconButton
                            size="small"
                            component="a"
                            href={`/survey?project=${encodeURIComponent(l.project_id)}`}
                            target="_blank"
                            rel="noopener noreferrer"
                          >
                            <Preview fontSize="small" />
                          </IconButton>
                        </Tooltip>
                        {l.status !== 'revoked' && (
                          <Button size="small" color="warning" onClick={() => handleRevoke(l.id, l.title)}>
                            撤销
                          </Button>
                        )}
                        <IconButton size="small" color="error" onClick={() => handleDelete(l.id, l.title)}>
                          <Delete fontSize="small" />
                        </IconButton>
                      </Stack>
                    </TableCell>
                  </TableRow>
                );
              })}
            </TableBody>
          </Table>
        </TableContainer>
      )}
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
    <AdminShell
      title="平台管理"
      backTo="/admin"
      maxWidth="xl"
      actions={(
        <Tooltip title="返回首页">
          <IconButton onClick={() => navigate('/')} size="small">
            <Home />
          </IconButton>
        </Tooltip>
      )}
    >
      <Box sx={{ mx: { xs: -2, sm: -3 }, mt: { xs: -2, sm: -3 }, mb: 2 }}>
        <Tabs
          value={tab}
          onChange={(_, v) => setTab(v)}
          sx={{ borderBottom: 1, borderColor: 'divider', bgcolor: 'background.paper', px: { xs: 1, sm: 2 } }}
          variant="scrollable"
          scrollButtons="auto"
        >
          <Tab label="模板管理" />
          <Tab label="项目概览" />
          <Tab label="Skill 审核" />
          <Tab label="Live Surveys" />
          <Tab label="论文库" />
        </Tabs>
      </Box>
      {tab === 0 && <TemplateManagement />}
      {tab === 1 && <ProjectOverview />}
      {tab === 2 && <SkillManagement />}
      {tab === 3 && <LiveSurveyManagement />}
      {tab === 4 && <ResearchDeepSearch />}
    </AdminShell>
  );
}
