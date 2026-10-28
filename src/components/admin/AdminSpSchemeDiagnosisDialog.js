import React, { useEffect, useMemo, useRef, useState } from 'react';
import {
  Alert, Box, Button, Chip, CircularProgress, Dialog, DialogActions, DialogContent, DialogTitle,
  LinearProgress, List, ListItem, ListItemIcon, ListItemText, Stack, Typography, useMediaQuery, useTheme,
} from '@mui/material';
import { CheckCircle, CloudDownload, ErrorOutline, WarningAmber } from '@mui/icons-material';
import {
  SP_SCHEME_KIND_LABELS, buildDiagnosisFiles, diagnoseSpSchemeProject, diagnosisZipName, summarizeResponses,
} from '../../lib/spSchemeDiagnosis';
import { createResponseLoadSession, fetchAdminResponsePage } from '../../lib/adminResults';
import { fetchUrlBytes } from '../../lib/mediaLibraryDownload';
import { downloadZip } from '../../lib/zipDownload';

const ICONS = {
  ok: <CheckCircle color="success" fontSize="small" />,
  warn: <WarningAmber color="warning" fontSize="small" />,
  error: <ErrorOutline color="error" fontSize="small" />,
};

const SAMPLE_SIZE = 5;

/** Admin: what an uploaded-page project really serves and records, plus a ZIP of the upload. */
export default function AdminSpSchemeDiagnosisDialog({ project, autoDownload = false, onClose }) {
  const theme = useTheme();
  const fullScreen = useMediaQuery(theme.breakpoints.down('sm'));
  const diagnosis = useMemo(() => (project ? diagnoseSpSchemeProject(project) : null), [project]);
  const [responses, setResponses] = useState({ loading: true, count: null, rows: [], error: '' });
  const [download, setDownload] = useState({ busy: false, done: 0, total: 0, message: '', error: '' });
  const started = useRef(false);

  useEffect(() => {
    if (!project) return undefined;
    let cancelled = false;
    setResponses({ loading: true, count: null, rows: [], error: '' });
    const session = createResponseLoadSession();
    fetchAdminResponsePage(project.id, 0, null, session)
      .then((rows) => {
        if (cancelled) return;
        const sorted = [...(rows || [])].sort((a, b) => String(b.created_at || '').localeCompare(String(a.created_at || '')));
        setResponses({ loading: false, count: session.total ?? sorted.length, rows: sorted.slice(0, SAMPLE_SIZE), error: '' });
      })
      .catch((err) => { if (!cancelled) setResponses({ loading: false, count: null, rows: [], error: err.message || '读取答卷失败' }); });
    return () => { cancelled = true; };
  }, [project]);

  const handleDownload = async () => {
    if (!project || download.busy) return;
    setDownload({ busy: true, done: 0, total: 0, message: '', error: '' });
    try {
      const { files, mediaReport } = await buildDiagnosisFiles(project, {
        responseCount: responses.count,
        responses: responses.rows,
        fetchBytes: fetchUrlBytes,
        onProgress: ({ done, total }) => setDownload((d) => ({ ...d, done, total })),
      });
      downloadZip(diagnosisZipName(project), files);
      const extra = [
        mediaReport.skipped ? `${mediaReport.skipped} 个图片超出上限没打包` : '',
        mediaReport.failed.length ? `${mediaReport.failed.length} 个图片下载失败` : '',
      ].filter(Boolean).join('，');
      setDownload({ busy: false, done: 0, total: 0, error: '', message: `已下载，含 ${mediaReport.saved} 个图片${extra ? `（${extra}，见包里的 README.md）` : ''}。` });
    } catch (err) {
      setDownload({ busy: false, done: 0, total: 0, message: '', error: err.message || '打包失败' });
    }
  };

  useEffect(() => {
    if (autoDownload && !responses.loading && !started.current) {
      started.current = true;
      handleDownload();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [autoDownload, responses.loading]);

  if (!project || !diagnosis) return null;
  const kindInfo = diagnosis.kind ? SP_SCHEME_KIND_LABELS[diagnosis.kind] : null;
  const samples = summarizeResponses(responses.rows);
  const canDownload = diagnosis.kind === 'site' || diagnosis.kind === 'asIs' || Boolean(project.config?.spSite?.html);

  return (
    <Dialog open onClose={download.busy ? undefined : onClose} fullScreen={fullScreen} fullWidth maxWidth="md" aria-labelledby="sp-scheme-diagnosis-title">
      <DialogTitle id="sp-scheme-diagnosis-title" sx={{ overflowWrap: 'anywhere' }}>
        SP-Scheme 诊断 · {project.name || '未命名项目'}
        <Typography component="span" display="block" variant="caption" color="text.secondary">{project.id}</Typography>
      </DialogTitle>
      <DialogContent dividers>
        {kindInfo && (
          <Stack direction="row" spacing={1} alignItems="center" sx={{ mb: 1.5 }}>
            <Chip size="small" color={kindInfo.color} label={kindInfo.label} />
            {diagnosis.draftDiffers && <Chip size="small" color="warning" variant="outlined" label="草稿未发布" />}
          </Stack>
        )}
        <List dense disablePadding>
          {diagnosis.checks.map((c, i) => (
            <ListItem key={i} alignItems="flex-start" disableGutters>
              <ListItemIcon sx={{ minWidth: 30, mt: 0.5 }}>{ICONS[c.level]}</ListItemIcon>
              <ListItemText primary={c.title} secondary={c.detail || null} />
            </ListItem>
          ))}
        </List>

        <Typography variant="subtitle2" sx={{ mt: 2, mb: 0.5 }}>答卷</Typography>
        {responses.loading && <Stack direction="row" spacing={1} alignItems="center"><CircularProgress size={16} /><Typography variant="body2">正在读取答卷…</Typography></Stack>}
        {responses.error && <Alert severity="warning">{responses.error}</Alert>}
        {!responses.loading && !responses.error && (
          <>
            <Typography variant="body2">共 {responses.count ?? 0} 份。{responses.count ? `最近 ${samples.length} 份里记下了：` : '还没有人提交过。'}</Typography>
            {samples.map((s) => (
              <Typography key={s.id || s.createdAt} variant="caption" display="block" color="text.secondary" sx={{ mt: 0.5, overflowWrap: 'anywhere' }}>
                {s.createdAt ? new Date(s.createdAt).toLocaleString('zh-CN') : '?'}：
                {s.questions.length} 个题目有答案
                {s.requests ? `，${s.requests} 条页面请求` : ''}
                {s.pageState.length ? `，页面存储 ${s.pageState.length} 项` : ''}
                {s.mediaLists.length ? `，平台填入的图片列表 ${s.mediaLists.length} 个` : ''}
                {s.trialsWithImages ? `，${s.trialsWithImages} 条带展示图片` : ''}
              </Typography>
            ))}
          </>
        )}

        <Box sx={{ mt: 2 }}>
          <Typography variant="body2" color="text.secondary">
            下载包会把用户上传的东西拼回来：参与者看到的页面 index.html、页面能拿到的图库图片（按文件夹）、页面里嵌的数据文件、项目设置、最近几份答卷，以及这份诊断（README.md）。平台不保存上传的原始文件，所以这是重建的。
          </Typography>
          {download.busy && (
            <Box sx={{ mt: 1 }}>
              <LinearProgress variant={download.total ? 'determinate' : 'indeterminate'} value={download.total ? (download.done / download.total) * 100 : 0} />
              <Typography variant="caption">{download.total ? `正在下载图片 ${download.done}/${download.total}` : '正在打包…'}</Typography>
            </Box>
          )}
          {download.message && <Alert severity="success" sx={{ mt: 1 }}>{download.message}</Alert>}
          {download.error && <Alert severity="error" sx={{ mt: 1 }}>{download.error}</Alert>}
        </Box>
      </DialogContent>
      <DialogActions>
        <Button onClick={onClose} disabled={download.busy} sx={{ minHeight: 44 }}>关闭</Button>
        {canDownload && (
          <Button variant="contained" startIcon={<CloudDownload />} onClick={handleDownload} disabled={download.busy || responses.loading} sx={{ minHeight: 44 }}>
            下载上传文件和诊断
          </Button>
        )}
      </DialogActions>
    </Dialog>
  );
}
