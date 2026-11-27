import React, { useEffect, useRef, useState } from 'react';
import {
  Alert, Box, Button, Dialog, DialogActions, DialogContent, DialogTitle, LinearProgress, Typography,
} from '@mui/material';
import { useRegion } from '../../contexts/RegionContext';
import {
  buildTemplatePackage, formatBytes, prepareTemplatePackage, saveBlob,
} from '../../lib/templatePackage';

/**
 * Download on a template row. Shows what the ZIP holds and how big it is,
 * then fetches the media library and saves one ZIP.
 */
export default function TemplateDownloadDialog({ template, title, open, onClose }) {
  const { language } = useRegion();
  const zh = String(language || '').startsWith('zh');
  const [prepared, setPrepared] = useState(null);
  const [state, setState] = useState('idle'); // idle | loading | ready | downloading | done | error
  const [progress, setProgress] = useState([0, 0]);
  const [error, setError] = useState('');
  const [failed, setFailed] = useState(0);
  const abortRef = useRef(null);

  useEffect(() => {
    if (!open) return undefined;
    let cancelled = false;
    setState('loading');
    setError('');
    setFailed(0);
    prepareTemplatePackage(template)
      .then((p) => { if (!cancelled) { setPrepared(p); setState('ready'); } })
      .catch((err) => { if (!cancelled) { setError(err.message || 'Failed'); setState('error'); } });
    return () => { cancelled = true; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, template.id]);

  const close = () => {
    abortRef.current?.abort();
    abortRef.current = null;
    onClose();
  };

  const download = async () => {
    const controller = new AbortController();
    abortRef.current = controller;
    setState('downloading');
    setProgress([0, prepared.files.length]);
    try {
      const result = await buildTemplatePackage({
        template, title, prepared, signal: controller.signal,
        onProgress: (done, total) => setProgress([done, total]),
      });
      saveBlob(result.blob, result.filename);
      setFailed(result.failed.length);
      setState('done');
    } catch (err) {
      if (err?.name === 'AbortError') return;
      setError(err.message || 'Failed');
      setState('error');
    } finally {
      if (abortRef.current === controller) abortRef.current = null;
    }
  };

  const count = prepared?.files.length || 0;
  const size = formatBytes(prepared?.bytes || 0);
  const [done, total] = progress;

  return (
    <Dialog open={open} onClose={close} maxWidth="xs" fullWidth>
      <DialogTitle sx={{ pb: 1 }}>{zh ? '下载模板' : 'Download template'}</DialogTitle>
      <DialogContent>
        <Typography variant="body2" sx={{ fontWeight: 600, mb: 1.5 }}>{title}</Typography>
        {state === 'loading' && <LinearProgress />}
        {state === 'error' && <Alert severity="error">{error}</Alert>}
        {prepared && state !== 'error' && (
          <>
            <Typography variant="body2" color="text.secondary" component="div">
              {zh ? '一个 ZIP，包含：' : 'One ZIP with:'}
              <Box component="ul" sx={{ m: 0, mt: 0.5, pl: 2.5 }}>
                <li>{zh ? '模板本身（template.json）' : 'The template (template.json)'}</li>
                {prepared.hasPage && <li>{zh ? 'SP-Scheme 页面（index.html）' : 'The SP-Scheme page (index.html)'}</li>}
                <li>
                  {zh
                    ? `媒体库：${count} 个文件，${size}（media/ 文件夹，保留原文件夹结构）`
                    : `Media library: ${count} files, ${size} (media/ folder, original folders kept)`}
                </li>
                <li>{zh ? '文件清单 media.csv 和说明 README.md（含论文引用）' : 'File list media.csv and README.md (with the paper to cite)'}</li>
              </Box>
            </Typography>
            {state === 'downloading' && (
              <Box sx={{ mt: 2 }}>
                <LinearProgress variant="determinate" value={total ? (done / total) * 100 : 0} />
                <Typography variant="caption" color="text.secondary">
                  {zh ? `正在下载 ${done} / ${total}…` : `Downloading ${done} / ${total}…`}
                </Typography>
              </Box>
            )}
            {state === 'done' && (
              <Alert severity={failed ? 'warning' : 'success'} sx={{ mt: 2 }}>
                {failed
                  ? (zh ? `已保存，但有 ${failed} 个文件没下载成功，README.md 里列出了它们。` : `Saved, but ${failed} file(s) failed; README.md lists them.`)
                  : (zh ? '已保存到你的下载文件夹。' : 'Saved to your downloads folder.')}
              </Alert>
            )}
          </>
        )}
      </DialogContent>
      <DialogActions>
        <Button onClick={close}>{state === 'done' ? (zh ? '关闭' : 'Close') : (zh ? '取消' : 'Cancel')}</Button>
        {state !== 'done' && (
          <Button variant="contained" onClick={download} disabled={state !== 'ready'}>
            {zh ? `下载 ZIP${prepared ? `（${size}）` : ''}` : `Download ZIP${prepared ? ` (${size})` : ''}`}
          </Button>
        )}
      </DialogActions>
    </Dialog>
  );
}
