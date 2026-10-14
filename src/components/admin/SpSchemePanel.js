import React, { useEffect, useMemo, useRef, useState } from 'react';
import {
  Alert,
  Box,
  Button,
  Checkbox,
  Chip,
  Dialog,
  DialogActions,
  DialogContent,
  DialogTitle,
  FormControlLabel,
  LinearProgress,
  Paper,
  TextField,
  Typography,
} from '@mui/material';
import { AutoAwesome, AutoFixHigh, CheckCircle, ContentCopy, Link as LinkIcon, Download, FactCheck, FolderZip, UploadFile, Web } from '@mui/icons-material';
import { strToU8, zipSync } from 'fflate';
import { useRegion } from '../../contexts/RegionContext';
import { uiPair } from '../../lib/uiLanguages';
import {
  SP_SCHEME_VERSION,
  applySpSchemePackage,
  buildExampleZip,
  buildSpSchemeText,
  readSpSchemeUpload,
  validateSpSchemePackage,
} from '../../lib/spScheme';
import { externalHostsIn, extractEmbeddedScheme } from '../../lib/spSite';
import { convertSurveyPage, fetchSurveyPage, fetchSurveyPageMedia } from '../../lib/agentApi';
import { CONVERT_FIX_ROUNDS, convertSurveyHtml, importMediaBase } from '../../lib/spSchemeConvert';
import { downloadPageMedia, uploadPlannedMedia } from '../../lib/spSchemeMediaImport';
import { uploadImageToR2 } from '../../lib/r2';
import { useOptionalAuth } from '../../contexts/AuthContext';

function downloadText(filename, text, type) {
  const blob = new Blob([text], { type });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
}

function downloadBytes(filename, bytes, type) {
  const blob = new Blob([bytes], { type });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
}

function IssueList({ items, max = 8 }) {
  return (
    <Box component="ul" sx={{ m: 0, pl: 2.5 }}>
      {items.slice(0, max).map((item, i) => (
        <Typography component="li" variant="body2" key={`${item.path}-${i}`} sx={{ overflowWrap: 'anywhere' }}>
          {item.message}
          {item.path ? <Typography component="span" variant="caption" color="text.secondary"> · {item.path}</Typography> : null}
        </Typography>
      ))}
      {items.length > max ? <Typography component="li" variant="caption">+ {items.length - max}</Typography> : null}
    </Box>
  );
}

function formatKb(bytes) {
  return `${Math.max(1, Math.round((bytes || 0) / 1024))} KB`;
}

const MODEL_STAGE_SECONDS = 60;

/**
 * Conversion progress: the model call has no progress events, so its bar
 * eases toward the end of its share while time passes; checking is quick.
 */
function ConvertProgress({ state, L }) {
  const [now, setNow] = useState(Date.now());
  const startedAt = useRef(Date.now());
  const stageAt = useRef(Date.now());
  const stageKey = `${state.round}-${state.stage}`;
  useEffect(() => { stageAt.current = Date.now(); }, [stageKey]);
  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), 500);
    return () => clearInterval(id);
  }, []);
  const rounds = 1 + Math.max(0, state.maxRounds || 0);
  const inStage = (now - stageAt.current) / 1000;
  // Each round (first pass, then each fix) fills the bar again.
  const value = state.stage === 'model'
    ? 90 * (1 - Math.exp(-inStage / (MODEL_STAGE_SECONDS / 2)))
    : (state.stage === 'media' ? Math.round(((state.done || 0) / Math.max(1, state.total || 1)) * 100) : 96);
  const elapsed = Math.round((now - startedAt.current) / 1000);
  const steps = [
    { key: 'read', label: L('Read the page', '读取页面'), done: true },
    { key: 'model', label: L('Model maps questions and submission to the platform', '模型把题目和提交接到平台'), done: state.stage !== 'model' || state.round > 0, active: state.stage === 'model' && state.round === 0 },
    { key: 'check', label: L('Apply changes and check', '应用修改并检查'), done: state.round > 0 || state.stage === 'media', active: state.stage === 'check' && state.round === 0 },
  ];
  if (state.stage === 'media' || state.mediaDone) {
    steps.push({
      key: 'media',
      label: state.stage === 'media'
        ? L(`Download the page's stimulus images (${state.done || 0} / ${state.total || 0})`, `下载页面里的刺激图（${state.done || 0} / ${state.total || 0}）`)
        : L('Downloaded the page\'s stimulus images', '已下载页面里的刺激图'),
      done: state.stage !== 'media',
      active: state.stage === 'media',
    });
  }
  if (state.round > 0 && state.stage !== 'media') {
    steps.push({
      key: 'fix',
      label: L(`Fix ${state.feedback?.length || 0} problem(s) (round ${state.round} of ${rounds - 1})`, `修正 ${state.feedback?.length || 0} 个问题（第 ${state.round}/${rounds - 1} 轮）`),
      done: false,
      active: true,
    });
  }
  return (
    <Box data-testid="sp-scheme-convert-progress">
      <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
        <LinearProgress variant="determinate" value={value} sx={{ flex: 1, height: 8, borderRadius: 4 }} />
        <Typography variant="caption" color="text.secondary" sx={{ minWidth: 72, textAlign: 'right' }}>
          {Math.round(value)}% · {elapsed}s
        </Typography>
      </Box>
      <Box component="ol" sx={{ listStyle: 'none', m: '8px 0 0', p: 0 }}>
        {steps.map((step) => (
          <Typography
            component="li"
            variant="body2"
            key={step.key}
            sx={{ display: 'flex', alignItems: 'center', gap: 0.75, color: step.done ? 'success.main' : (step.active ? 'text.primary' : 'text.disabled'), fontWeight: step.active ? 600 : 400 }}
          >
            {step.done ? <CheckCircle sx={{ fontSize: 16 }} /> : <Box component="span" sx={{ width: 16, display: 'inline-flex', justifyContent: 'center' }}>{step.active ? '•' : '○'}</Box>}
            {step.label}
          </Typography>
        ))}
      </Box>
      {state.stage === 'model' && inStage > 20 ? (
        <Typography variant="caption" color="text.secondary">
          {L('The free model usually needs 30–90 seconds for a full page. You can keep this dialog open.', '免费模型处理整页通常需要 30–90 秒，请保持此窗口打开。')}
        </Typography>
      ) : null}
    </Box>
  );
}

/**
 * SP-Scheme: copy the platform contract to any external LLM, then upload the
 * page it builds. Nothing changes until the researcher confirms import.
 */
export default function SpSchemePanel({ config, onChange, currentProject = null, onProjectUpdate = null }) {
  const { language } = useRegion();
  const user = useOptionalAuth()?.user || null;
  const [mediaProgress, setMediaProgress] = useState(null);
  const L = (en, zh) => uiPair(language, en, zh);
  const schemeText = useMemo(() => buildSpSchemeText(), []);
  const fileRef = useRef(null);
  const [notice, setNotice] = useState(null);
  const [open, setOpen] = useState(false);
  const [pasted, setPasted] = useState('');
  const [report, setReport] = useState(null);
  const [parseError, setParseError] = useState('');
  const [importing, setImporting] = useState(false);
  const [upload, setUpload] = useState(null);
  // Domains the page may reach at run time, ticked by the researcher.
  const [hosts, setHosts] = useState([]);
  const [allowed, setAllowed] = useState([]);
  const [convertNotes, setConvertNotes] = useState('');
  const [converting, setConverting] = useState(null);
  const [conversion, setConversion] = useState(null);

  const copyScheme = async () => {
    try {
      await navigator.clipboard.writeText(schemeText);
      setNotice({ severity: 'success', text: L('SP-Scheme copied. Paste it into any LLM together with your study idea.', 'SP-Scheme 已复制。把它和你的研究想法一起发给任意大模型。') });
    } catch {
      downloadText(`sp-scheme-${SP_SCHEME_VERSION}.md`, schemeText, 'text/markdown');
      setNotice({ severity: 'info', text: L('Clipboard unavailable; downloaded the file instead.', '无法写入剪贴板，已改为下载文件。') });
    }
  };

  const revalidate = (pkg, siteHtml, allowedHosts) => {
    setReport(validateSpSchemePackage(pkg, { siteHtml, allowedHosts }));
  };

  const check = (bytes, name = '') => {
    setReport(null);
    setParseError('');
    setUpload(null);
    setConversion(null);
    try {
      const read = readSpSchemeUpload(bytes);
      const found = read.siteHtml
        ? externalHostsIn(read.siteHtml).map(({ host, kinds }) => ({ host, why: kinds.join(', '), needed: kinds.some((k) => k !== 'request') }))
        : [];
      const ticked = found.filter((h) => h.needed).map((h) => h.host);
      setHosts(found);
      setAllowed(ticked);
      setUpload({ name, ...read });
      revalidate(read.pkg, read.siteHtml, ticked);
    } catch (err) {
      setParseError(err.message);
    }
  };

  const toggleHost = (host) => {
    const next = allowed.includes(host) ? allowed.filter((h) => h !== host) : [...allowed, host];
    setAllowed(next);
    if (upload) revalidate(upload.pkg, upload.siteHtml, next);
  };

  // A page imported from the web keeps loading its images and data from its own site.
  const withSourceHost = (list, up) => {
    if (!up?.sourceHost) return list;
    const rest = list.filter((h) => h.host !== up.sourceHost);
    return [{ host: up.sourceHost, why: L('the page\'s own site (images, data)', '页面原站点（图片、数据）'), needed: true }, ...rest];
  };

  const [pageUrl, setPageUrl] = useState('');
  const [fetchingPage, setFetchingPage] = useState(false);
  const fetchPage = async () => {
    setParseError('');
    setReport(null);
    setConversion(null);
    setFetchingPage(true);
    try {
      const res = await fetchSurveyPage(pageUrl.trim());
      if (!res?.success) throw new Error(res?.error || L('The page could not be fetched.', '无法抓取这个页面。'));
      const up = { name: res.url, siteHtml: res.html, pkg: extractEmbeddedScheme(res.html), dataFiles: res.dataFiles || [], files: [], sourceUrl: res.url, sourceHost: res.host };
      const found = withSourceHost(externalHostsIn(res.html).map(({ host, kinds }) => ({ host, why: kinds.join(', '), needed: kinds.some((k) => k !== 'request') })), up);
      const ticked = found.filter((h) => h.needed).map((h) => h.host);
      setHosts(found);
      setAllowed(ticked);
      setUpload(up);
      revalidate(up.pkg, up.siteHtml, ticked);
    } catch (err) {
      setParseError(err?.message || String(err));
    } finally {
      setFetchingPage(false);
    }
  };

  const runConversion = async () => {
    const source = upload?.originalHtml || upload?.siteHtml;
    if (!source) return;
    setParseError('');
    setConverting({ round: 0, stage: 'model', maxRounds: CONVERT_FIX_ROUNDS + (upload?.sourceUrl ? 1 : 0) });
    try {
      const out = await convertSurveyHtml(source, {
        request: convertSurveyPage,
        notes: convertNotes,
        dataFiles: upload?.dataFiles || [],
        mediaFiles: upload?.mediaFiles || [],
        mediaBase: importMediaBase(upload?.sourceUrl ? `${upload.sourceHost}${new URL(upload.sourceUrl).pathname}` : upload?.name),
        fetchMedia: upload?.sourceUrl
          ? (urls, progress) => downloadPageMedia(urls, upload.sourceUrl, { fetchViaServer: fetchSurveyPageMedia, onProgress: progress })
          : null,
        onProgress: (p) => setConverting((prev) => ({
          ...p,
          maxRounds: CONVERT_FIX_ROUNDS + (upload?.sourceUrl ? 1 : 0),
          mediaDone: Boolean(prev?.mediaDone || (prev?.stage === 'media' && p.stage !== 'media')),
        })),
      });
      const ticked = out.hosts.filter((h) => h.needed).map((h) => h.host);
      setConversion({
        ok: out.ok,
        rounds: out.rounds,
        problems: out.problems,
        notes: out.result?.notes || [],
        originalImages: out.result?.originalImages || [],
        mediaPlan: out.mediaPlan,
        model: out.model,
      });
      const allHosts = withSourceHost(out.hosts, upload);
      if (upload?.sourceHost && !ticked.includes(upload.sourceHost)) ticked.push(upload.sourceHost);
      setHosts(allHosts);
      setAllowed(ticked);
      setUpload((prev) => ({ ...prev, originalHtml: source, siteHtml: out.html, pkg: out.pkg, converted: true }));
      revalidate(out.pkg, out.html, ticked);
    } catch (err) {
      setParseError(err?.message || String(err));
    } finally {
      setConverting(null);
    }
  };

  // One file is read as is; several (index.html plus its config or CSV files) are
  // read as if they came in one zip.
  const readFiles = async (list) => {
    const files = Array.from(list || []).filter(Boolean);
    if (!files.length) return;
    const contents = await Promise.all(files.map((file) => new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = (e) => resolve(new Uint8Array(e.target.result));
      reader.onerror = () => reject(reader.error);
      reader.readAsArrayBuffer(file);
    })));
    setPasted('');
    setOpen(true);
    if (files.length === 1) {
      check(contents[0], files[0].name);
      return;
    }
    const bundle = {};
    files.forEach((file, i) => { bundle[file.name] = contents[i]; });
    const page = files.find((file) => /\.html?$/i.test(file.name));
    check(zipSync(bundle), page ? `${page.name} + ${files.length - 1}` : `${files.length} files`);
  };

  const onFile = (event) => {
    const list = event.target.files;
    readFiles(list).catch((err) => setParseError(err?.message || String(err)));
    event.target.value = '';
  };

  const [dragging, setDragging] = useState(false);
  const dropProps = {
    onDragOver: (e) => {
      if (!Array.from(e.dataTransfer?.types || []).includes('Files')) return;
      e.preventDefault();
      e.stopPropagation();
      setDragging(true);
    },
    onDragLeave: (e) => {
      if (!e.currentTarget.contains(e.relatedTarget)) setDragging(false);
    },
    onDrop: (e) => {
      if (!e.dataTransfer?.files?.length) return;
      e.preventDefault();
      // The dialog renders in a portal, but React still bubbles its events to the panel.
      e.stopPropagation();
      setDragging(false);
      if (converting || importing) return;
      readFiles(e.dataTransfer.files).catch((err) => setParseError(err?.message || String(err)));
    },
  };

  const [copied, setCopied] = useState(false);
  const copyForFix = async () => {
    const errorsText = report?.errors?.length && report?.summary
      ? `\n\n## Problems to fix in my index.html\n${report.errors.map((e) => `- ${e.message}${e.path ? ` (${e.path})` : ''}`).join('\n')}\n`
      : '';
    try {
      await navigator.clipboard.writeText(schemeText + errorsText);
    } catch {
      downloadText(`sp-scheme-${SP_SCHEME_VERSION}.md`, schemeText + errorsText, 'text/markdown');
    }
    setCopied(true);
    setTimeout(() => setCopied(false), 2500);
  };

  const closeDialog = () => {
    if (importing || converting) return;
    setOpen(false);
  };

  const mediaPlan = conversion?.mediaPlan?.files?.length ? conversion.mediaPlan : null;
  const canUploadMedia = Boolean(currentProject?.id && onProjectUpdate && user?.id);

  const doImport = async () => {
    setImporting(true);
    try {
      if (mediaPlan) {
        // Stimuli first: the imported questions draw from these folders.
        setMediaProgress({ done: 0, total: mediaPlan.files.length });
        const result = await uploadPlannedMedia({
          plan: mediaPlan,
          project: currentProject,
          userId: user?.id,
          upload: uploadImageToR2,
          onProjectUpdate,
          onProgress: setMediaProgress,
        });
        if (result.saveError || result.failures.length) {
          throw new Error(result.saveError
            ? L(`Media uploaded, but saving the media list failed: ${result.saveError}`, `媒体已上传，但保存媒体清单失败：${result.saveError}`)
            : L(`${result.failures.length} file(s) failed to upload (e.g. ${result.failures[0].name}: ${result.failures[0].error}). Nothing was imported; try again.`, `${result.failures.length} 个文件上传失败（如 ${result.failures[0].name}：${result.failures[0].error}）。问卷尚未导入，请重试。`));
        }
      }
      const next = applySpSchemePackage(report, { baseConfig: config });
      if (next.spSite && upload?.converted) next.spSite.convertedFrom = upload.name || 'index.html';
      onChange(next);
      setOpen(false);
      setReport(null);
      setPasted('');
      setUpload(null);
      setConversion(null);
      setHosts([]);
      setAllowed([]);
      setNotice({
        severity: 'success',
        text: next.spSite
          ? L('Imported. Preview and the survey link now use the page the model built. Check it in Preview, then Save.', '已导入。预览和问卷链接现在都使用大模型做的页面。请在预览里确认后点保存。')
          : L('Imported into the Builder. Review it, preview, then Save.', '已导入 Builder。检查并预览后再点保存。'),
      });
    } catch (err) {
      setParseError(err.message || String(err));
    } finally {
      setImporting(false);
      setMediaProgress(null);
    }
  };

  const hasQuestions = (config?.pages || []).some((p) => (p.elements || []).length);
  const activeSite = config?.spSite?.html ? config.spSite : null;
  const removeSite = () => {
    const { spSite: _site, ...rest } = config;
    onChange(rest);
    setNotice({ severity: 'info', text: L('The model-built page was removed; the survey uses the standard platform style again. Save to apply.', '已移除大模型页面，问卷恢复平台标准样式。点保存后生效。') });
  };
  const summary = report?.summary;

  return (
    <Paper
      variant="outlined"
      data-testid="sp-scheme-panel"
      {...dropProps}
      sx={{
        mb: 2,
        p: { xs: 2, sm: 2.5 },
        borderRadius: 2,
        borderWidth: 2,
        borderColor: 'primary.main',
        borderStyle: dragging ? 'dashed' : 'solid',
        outline: dragging ? '3px solid' : 'none',
        outlineColor: 'primary.light',
        background: (theme) => `linear-gradient(135deg, ${theme.palette.primary.main}14, transparent 60%)`,
      }}
    >
      <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, flexWrap: 'wrap', mb: 0.5 }}>
        <AutoAwesome color="primary" />
        <Typography variant="h6" sx={{ fontWeight: 700 }}>SP-Scheme</Typography>
        <Chip size="small" label={`v${SP_SCHEME_VERSION}`} variant="outlined" color="primary" />
        <Typography variant="body2" color="text.secondary" sx={{ flexBasis: { xs: '100%', md: 'auto' } }}>
          {L('Design any survey interface with an external LLM, within the platform contract.', '用外部大模型设计任意问卷界面，同时保持平台的数据规范。')}
        </Typography>
      </Box>

      <Box component="ol" sx={{ m: '8px 0 12px', pl: 2.5, color: 'text.secondary', '& li': { mb: 0.25 } }}>
        <Typography component="li" variant="body2">
          {L('Copy SP-Scheme into any LLM and describe your study.', '复制 SP-Scheme 发给任意大模型，并描述你的研究。')}
        </Typography>
        <Typography component="li" variant="body2">
          {L('Let it build the survey as a web page and refine it until you are happy.', '让它把问卷做成网页，试到满意为止。')}
        </Typography>
        <Typography component="li" variant="body2">
          {L('Upload its index.html here to go live; the platform handles images and answers.', '上传它的 index.html 即可上线，抽图和记录答案由平台负责。')}
        </Typography>
      </Box>

      <Box sx={{ display: 'flex', gap: 1, flexWrap: 'wrap' }}>
        <Button variant="contained" startIcon={<ContentCopy />} onClick={copyScheme}>
          {L('Copy SP-Scheme', '复制 SP-Scheme')}
        </Button>
        <Button variant="outlined" startIcon={<Download />} onClick={() => downloadText(`sp-scheme-${SP_SCHEME_VERSION}.md`, schemeText, 'text/markdown')}>
          {L('Download .md', '下载 .md')}
        </Button>
        <input ref={fileRef} type="file" accept=".html,.htm,.zip,.json,.txt,.md,.csv,.tsv,text/html,application/zip,application/json" multiple hidden onChange={onFile} data-testid="sp-scheme-file" />
        <Button variant="contained" color="secondary" startIcon={<UploadFile />} onClick={() => fileRef.current?.click()}>
          {L('Upload or drop index.html / zip', '上传或拖入 index.html / zip')}
        </Button>
        <Button variant="text" startIcon={<FolderZip />} onClick={() => downloadBytes('sp-scheme-example.zip', buildExampleZip(), 'application/zip')}>
          {L('Example', '示例')}
        </Button>
        <Button variant="text" startIcon={<FactCheck />} onClick={() => { setUpload(null); setReport(null); setParseError(''); setConversion(null); setHosts([]); setAllowed([]); setOpen(true); }}>
          {L('Paste code or link', '粘贴代码或链接')}
        </Button>
      </Box>

      {activeSite ? (
        <Alert
          severity="success"
          icon={<Web />}
          sx={{ mt: 1.5 }}
          data-testid="sp-site-active"
          action={<Button color="inherit" size="small" onClick={removeSite}>{L('Remove', '移除')}</Button>}
        >
          {L(`This survey runs on the page built with SP-Scheme (${formatKb(activeSite.html.length)}). Preview and the survey link show it; editing questions here changes what it records.`,
            `这份问卷使用 SP-Scheme 导入的大模型页面（${formatKb(activeSite.html.length)}）。预览和问卷链接都显示这个页面；在这里修改题目会改变它记录的内容。`)}
        </Alert>
      ) : null}

      {notice ? <Alert severity={notice.severity} sx={{ mt: 1.5 }} onClose={() => setNotice(null)}>{notice.text}</Alert> : null}

      <Dialog open={open} onClose={closeDialog} fullWidth maxWidth="md">
        <DialogTitle>{L('Check an SP-Scheme upload', '检查 SP-Scheme 上传')}</DialogTitle>
        <DialogContent dividers {...dropProps} sx={dragging ? { outline: '3px dashed', outlineColor: 'primary.main', outlineOffset: -6 } : undefined}>
          {upload?.name ? (
            <Alert severity="info" sx={{ mb: 2 }}>
              {upload.name}
              {upload.fromZip ? ` · ${L(`${upload.files.length} file(s) read.`, `已读取 ${upload.files.length} 个文件。`)}` : ''}
            </Alert>
          ) : null}
          {!upload?.name ? (
            <Box sx={{ display: 'flex', gap: 1, mb: 2 }}>
              <TextField
                fullWidth
                size="small"
                value={pageUrl}
                onChange={(e) => setPageUrl(e.target.value)}
                onKeyDown={(e) => { if (e.key === 'Enter' && pageUrl.trim() && !fetchingPage) fetchPage(); }}
                placeholder={L('Survey web address, e.g. https://name.github.io/my-survey/', '问卷网址，例如 https://name.github.io/my-survey/')}
                inputProps={{ 'aria-label': 'Survey web address' }}
              />
              <Button variant="outlined" startIcon={<LinkIcon />} onClick={fetchPage} disabled={!pageUrl.trim() || fetchingPage} sx={{ whiteSpace: 'nowrap' }} data-testid="sp-scheme-fetch-url">
                {fetchingPage ? L('Fetching…', '抓取中…') : L('Import link', '导入链接')}
              </Button>
            </Box>
          ) : null}
          {!upload?.name ? (
          <TextField
            fullWidth
            multiline
            minRows={6}
            maxRows={14}
            value={pasted}
            onChange={(e) => { setPasted(e.target.value); setReport(null); setParseError(''); }}
            placeholder={L('Paste the whole index.html the model gave you (or a sp-scheme.json).', '把大模型给你的完整 index.html 代码粘贴到这里（也可以是 sp-scheme.json）。')}
            inputProps={{ 'aria-label': 'SP-Scheme package', style: { fontFamily: 'monospace', fontSize: 12 } }}
          />
          ) : null}
          {!upload?.name ? (
          <Box sx={{ mt: 1, display: 'flex', gap: 1 }}>
            <Button variant="outlined" size="small" startIcon={<FactCheck />} onClick={() => check(strToU8(pasted))} disabled={!pasted.trim()}>
              {L('Check format', '检查格式')}
            </Button>
          </Box>
          ) : null}

          {parseError ? <Alert severity="error" sx={{ mt: 2 }}>{parseError}</Alert> : null}

          {report ? (
            <Box sx={{ mt: 2, display: 'flex', flexDirection: 'column', gap: 1.5 }}>
              <Alert
                severity={report.ok ? 'success' : 'error'}
                data-testid="sp-scheme-verdict"
                action={report.ok ? null : (
                  <Button color="inherit" size="small" startIcon={copied ? <CheckCircle /> : <ContentCopy />} onClick={copyForFix} sx={{ whiteSpace: 'nowrap' }}>
                    {copied ? L('Copied', '已复制') : L('Copy SP-Scheme', '复制 SP-Scheme')}
                  </Button>
                )}
              >
                <Typography variant="subtitle2">
                  {report.ok
                    ? L('Format aligned with the platform. Ready to import.', '格式与平台对齐，可以导入。')
                    : (summary
                      ? L(`${report.errors.length} problem(s) to fix: copy SP-Scheme (with the problems) to your model to fix it, or convert it online below.`, `有 ${report.errors.length} 个问题需要修正：复制 SP-Scheme（附带问题列表）让大模型修正，或在下方用模型在线转换。`)
                      : L('This is not a survey file that matches SP-Scheme: copy SP-Scheme to your model to fix it, or convert it online below.', '这不是符合 SP-Scheme 的问卷文件：复制 SP-Scheme 让大模型修正，或在下方用模型在线转换。'))}
                </Typography>
                {summary ? (
                  <Typography variant="body2" sx={{ mt: 0.5 }}>
                    {summary.title ? `「${summary.title}」 · ` : ''}
                    {L(`${summary.pageCount} pages · ${summary.questionCount} questions`, `${summary.pageCount} 页 · ${summary.questionCount} 题`)}
                  </Typography>
                ) : null}
              </Alert>
              {summary?.hasSite ? (
                <Alert severity="info" icon={<Web />} data-testid="sp-scheme-site">
                  {L(`Includes the page the model built (${upload?.siteFile || 'index.html'}, ${formatKb(summary.siteBytes)}). After import, Preview and the survey link show this page.`,
                    `包含大模型做的页面（${upload?.siteFile || 'index.html'}，${formatKb(summary.siteBytes)}）。导入后，预览和问卷链接都直接显示这个页面。`)}
                </Alert>
              ) : null}
              {conversion ? (
                <Alert severity={conversion.ok ? 'success' : 'warning'} icon={<AutoFixHigh />} data-testid="sp-scheme-converted">
                  {conversion.ok
                    ? L('Converted by the model: the original design is kept, and its questions and submission now go through the platform. Try it in Preview after import.', '已由模型转换：保留原设计，题目和提交改由平台记录。导入后请在预览里试一遍。')
                    : L(`The model could not fix everything in ${conversion.rounds} rounds. You can convert again, or send the errors below to another model.`, `模型在 ${conversion.rounds} 轮内没能修完所有问题。可以再转换一次，或把下面的错误发给其他大模型。`)}
                  {conversion.notes.length ? (
                    <Box component="ul" sx={{ m: '4px 0 0', pl: 2.5 }}>
                      {conversion.notes.map((n, i) => <Typography component="li" variant="body2" key={i}>{n}</Typography>)}
                    </Box>
                  ) : null}
                  <Button size="small" startIcon={<Download />} sx={{ mt: 0.5 }} onClick={() => downloadText('index.sp-scheme.html', upload.siteHtml, 'text/html')}>
                    {L('Download converted page', '下载转换后的页面')}
                  </Button>
                </Alert>
              ) : null}
              {conversion?.originalImages?.length ? (
                <Alert severity="info" data-testid="sp-scheme-original-images">
                  {L('Stimulus images now come from this project\'s Media Dataset. Upload these original images there so participants see them:', '刺激图片现在由本项目的媒体库抽取。请把这些原图上传到媒体库，参与者才能看到：')}
                  <Box component="ul" sx={{ m: '4px 0 0', pl: 2.5, maxHeight: 140, overflow: 'auto' }}>
                    {conversion.originalImages.slice(0, 50).map((img, i) => (
                      <Typography component="li" variant="caption" key={i} sx={{ display: 'list-item', overflowWrap: 'anywhere' }}>
                        {img.url}{img.note ? ` · ${img.note}` : ''}
                      </Typography>
                    ))}
                  </Box>
                </Alert>
              ) : null}
              {mediaPlan ? (
                <Alert severity={canUploadMedia ? 'info' : 'warning'} data-testid="sp-scheme-media-plan">
                  {canUploadMedia
                    ? L(`On import, the ${mediaPlan.files.length} stimulus files from the zip are uploaded to this project's media library:`, `导入时会把 zip 里的 ${mediaPlan.files.length} 个刺激文件上传到本项目的媒体库：`)
                    : L('Open this survey inside a project to upload the zip\'s stimulus files on import.', '请在项目里打开这份问卷，导入时才能上传 zip 里的刺激文件。')}
                  <Box component="ul" sx={{ m: '4px 0 0', pl: 2.5 }}>
                    {[...mediaPlan.folders.values()].map((f) => (
                      <Typography component="li" variant="body2" key={f.full}>{f.full} · {f.count}</Typography>
                    ))}
                  </Box>
                  {mediaProgress ? (
                    <Box sx={{ mt: 1 }}>
                      <LinearProgress variant="determinate" value={(mediaProgress.done / Math.max(1, mediaProgress.total)) * 100} />
                      <Typography variant="caption">{L(`Uploading ${mediaProgress.done} / ${mediaProgress.total}`, `正在上传 ${mediaProgress.done} / ${mediaProgress.total}`)}</Typography>
                    </Box>
                  ) : null}
                </Alert>
              ) : null}
              {hosts.length ? (
                <Box data-testid="sp-scheme-hosts" sx={{ p: 1.5, border: '1px solid', borderColor: 'divider', borderRadius: 1 }}>
                  <Typography variant="subtitle2">{L('Network access', '联网放行')}</Typography>
                  <Typography variant="body2" color="text.secondary" sx={{ mb: 0.5 }}>
                    {L('The page uses these domains. Tick only the ones it must load from; results sent anywhere else stay on the platform. Your choice is saved with the survey.', '页面用到了这些域名。只勾选它运行时必须加载内容的域名；发往其他地方的结果会留在平台内。勾选结果会随问卷保存。')}
                  </Typography>
                  {hosts.map((h) => (
                    <FormControlLabel
                      key={h.host}
                      sx={{ display: 'flex' }}
                      control={<Checkbox size="small" checked={allowed.includes(h.host)} onChange={() => toggleHost(h.host)} />}
                      label={<Typography variant="body2" sx={{ overflowWrap: 'anywhere' }}>{h.host}{h.why ? <Typography component="span" variant="caption" color="text.secondary"> · {h.why}</Typography> : null}</Typography>}
                    />
                  ))}
                </Box>
              ) : null}
              {!report.ok && (upload?.siteHtml || upload?.originalHtml) ? (
                <Box data-testid="sp-scheme-convert-box" sx={{ p: 1.5, border: '1px dashed', borderColor: 'primary.main', borderRadius: 1 }}>
                  <Typography variant="subtitle2">{L('Convert this page automatically', '自动转换这个页面')}</Typography>
                  <Typography variant="body2" color="text.secondary" sx={{ mb: 1 }}>
                    {L('Any survey page works, including ones that send results to their own server. The free model keeps the design and connects its questions and submission to the platform.', '任何问卷网页都可以，包括把结果发到自己服务器的。免费模型会保留原设计，把题目和提交接到平台上。')}
                  </Typography>
                  <TextField
                    fullWidth
                    size="small"
                    multiline
                    maxRows={3}
                    value={convertNotes}
                    onChange={(e) => setConvertNotes(e.target.value)}
                    placeholder={L('Optional: anything the model should know (which images are stimuli, the question wording if the page loads it from a server…). You can also drop config / CSV files with the page.', '可选：告诉模型需要注意的地方（哪些图是刺激图、页面从服务器加载的题目文字…）。也可以把配置 / CSV 文件和页面一起拖进来。')}
                    sx={{ mb: 1 }}
                  />
                  {upload?.dataFiles?.length ? (
                    <Typography variant="caption" color="text.secondary" sx={{ display: 'block', mb: 1 }}>
                      {L(`The model also reads: ${upload.dataFiles.map((f) => f.name).join(', ')}`, `模型还会读取：${upload.dataFiles.map((f) => f.name).join('、')}`)}
                    </Typography>
                  ) : null}
                  {converting ? (
                    <ConvertProgress state={converting} L={L} />
                  ) : (
                    <Button variant="contained" size="small" startIcon={<AutoFixHigh />} onClick={runConversion} data-testid="sp-scheme-convert">
                      {conversion ? L('Convert again', '重新转换') : L('Convert with the free model', '用免费模型自动转换')}
                    </Button>
                  )}
                </Box>
              ) : null}
              {report.errors.length && (summary || conversion) && !converting ? <Box><Typography variant="subtitle2" color="error">{L('Errors', '错误')}</Typography><IssueList items={report.errors} max={20} /></Box> : null}
              {report.warnings.length ? <Box><Typography variant="subtitle2" color="warning.main">{L('Warnings', '提醒')}</Typography><IssueList items={report.warnings} /></Box> : null}
              {summary ? (
                <Box sx={{ display: 'flex', gap: 0.5, flexWrap: 'wrap' }}>
                  {Object.entries(summary.types).map(([type, n]) => <Chip key={type} size="small" label={`${type} × ${n}`} />)}
                </Box>
              ) : null}
              {report.ok && hasQuestions ? (
                <Alert severity="warning">
                  {L('Importing replaces the current pages, questions and page design. Theme and logo are kept. Collected responses are not changed; publish only after reviewing.', '导入会替换当前的页面、题目和页面设计，主题和 Logo 保留。已收集的答卷不受影响；请检查后再发布。')}
                </Alert>
              ) : null}
            </Box>
          ) : null}
        </DialogContent>
        <DialogActions>
          <Button onClick={closeDialog} disabled={importing} color="inherit">{L('Cancel', '取消')}</Button>
          <Button variant="contained" onClick={doImport} disabled={!report?.ok || importing || Boolean(converting) || Boolean(mediaPlan && !canUploadMedia)}>
            {importing ? L('Importing…', '导入中…') : L('Import into Builder', '导入 Builder')}
          </Button>
        </DialogActions>
      </Dialog>
    </Paper>
  );
}
