import React, { useMemo, useRef, useState } from 'react';
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
import { AutoAwesome, AutoFixHigh, ContentCopy, Download, FactCheck, FolderZip, UploadFile, Web } from '@mui/icons-material';
import { strToU8 } from 'fflate';
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
import { externalHostsIn } from '../../lib/spSite';
import { convertSurveyPage } from '../../lib/agentApi';
import { convertSurveyHtml } from '../../lib/spSchemeConvert';

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

/**
 * SP-Scheme: copy the platform contract to any external LLM, then upload the
 * page it builds. Nothing changes until the researcher confirms import.
 */
export default function SpSchemePanel({ config, onChange }) {
  const { language } = useRegion();
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

  const runConversion = async () => {
    const source = upload?.originalHtml || upload?.siteHtml;
    if (!source) return;
    setParseError('');
    setConverting({ round: 0 });
    try {
      const out = await convertSurveyHtml(source, {
        request: convertSurveyPage,
        notes: convertNotes,
        onProgress: (p) => setConverting(p),
      });
      const ticked = out.hosts.filter((h) => h.needed).map((h) => h.host);
      setConversion({
        ok: out.ok,
        rounds: out.rounds,
        problems: out.problems,
        notes: out.result?.notes || [],
        originalImages: out.result?.originalImages || [],
        model: out.model,
      });
      setHosts(out.hosts);
      setAllowed(ticked);
      setUpload((prev) => ({ ...prev, originalHtml: source, siteHtml: out.html, pkg: out.pkg, converted: true }));
      revalidate(out.pkg, out.html, ticked);
    } catch (err) {
      setParseError(err?.message || String(err));
    } finally {
      setConverting(null);
    }
  };

  const onFile = (event) => {
    const file = event.target.files?.[0];
    event.target.value = '';
    if (!file) return;
    const reader = new FileReader();
    reader.onload = (e) => {
      const bytes = new Uint8Array(e.target.result);
      setPasted('');
      setOpen(true);
      check(bytes, file.name);
    };
    reader.readAsArrayBuffer(file);
  };

  const closeDialog = () => {
    if (importing || converting) return;
    setOpen(false);
  };

  const doImport = async () => {
    setImporting(true);
    try {
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
      sx={{
        mb: 2,
        p: { xs: 2, sm: 2.5 },
        borderRadius: 2,
        borderWidth: 2,
        borderColor: 'primary.main',
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
        <input ref={fileRef} type="file" accept=".html,.htm,.zip,.json,.txt,.md,text/html,application/zip,application/json" hidden onChange={onFile} data-testid="sp-scheme-file" />
        <Button variant="contained" color="secondary" startIcon={<UploadFile />} onClick={() => fileRef.current?.click()}>
          {L('Upload index.html / zip', '上传 index.html / zip')}
        </Button>
        <Button variant="text" startIcon={<FolderZip />} onClick={() => downloadBytes('sp-scheme-example.zip', buildExampleZip(), 'application/zip')}>
          {L('Example', '示例')}
        </Button>
        <Button variant="text" startIcon={<FactCheck />} onClick={() => { setUpload(null); setReport(null); setParseError(''); setConversion(null); setHosts([]); setAllowed([]); setOpen(true); }}>
          {L('Paste code', '粘贴代码')}
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
        <DialogContent dividers>
          {upload?.name ? (
            <Alert severity="info" sx={{ mb: 2 }}>
              {upload.name}
              {upload.fromZip ? ` · ${L(`${upload.files.length} file(s) read.`, `已读取 ${upload.files.length} 个文件。`)}` : ''}
            </Alert>
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
              <Alert severity={report.ok ? 'success' : 'error'}>
                <Typography variant="subtitle2">
                  {report.ok
                    ? L('Format aligned with the platform. Ready to import.', '格式与平台对齐，可以导入。')
                    : L(`${report.errors.length} problem(s) must be fixed. Send this list back to the model and ask it to correct the package.`, `有 ${report.errors.length} 个问题需要修正。可以把下面的列表发回给大模型，让它修改问卷包。`)}
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
                    placeholder={L('Optional: anything the model should know (which images are stimuli, which fields to keep…)', '可选：告诉模型需要注意的地方（哪些图是刺激图、哪些字段要保留…）')}
                    sx={{ mb: 1 }}
                  />
                  {converting ? (
                    <Box>
                      <LinearProgress />
                      <Typography variant="caption" color="text.secondary">
                        {converting.fixing
                          ? L(`Fixing ${converting.feedback?.length || 0} problem(s), round ${converting.round + 1}…`, `正在修正 ${converting.feedback?.length || 0} 个问题，第 ${converting.round + 1} 轮…`)
                          : L('Converting with the free model; this can take a minute…', '正在用免费模型转换，可能需要一分钟左右…')}
                      </Typography>
                    </Box>
                  ) : (
                    <Button variant="contained" size="small" startIcon={<AutoFixHigh />} onClick={runConversion} data-testid="sp-scheme-convert">
                      {conversion ? L('Convert again', '重新转换') : L('Convert with the free model', '用免费模型自动转换')}
                    </Button>
                  )}
                </Box>
              ) : null}
              {report.errors.length ? <Box><Typography variant="subtitle2" color="error">{L('Errors', '错误')}</Typography><IssueList items={report.errors} max={20} /></Box> : null}
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
          <Button variant="contained" onClick={doImport} disabled={!report?.ok || importing || Boolean(converting)}>
            {importing ? L('Importing…', '导入中…') : L('Import into Builder', '导入 Builder')}
          </Button>
        </DialogActions>
      </Dialog>
    </Paper>
  );
}
