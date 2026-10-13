import React, { useMemo, useRef, useState } from 'react';
import {
  Alert,
  Box,
  Button,
  Chip,
  Dialog,
  DialogActions,
  DialogContent,
  DialogTitle,
  Paper,
  TextField,
  Typography,
} from '@mui/material';
import { AutoAwesome, ContentCopy, Download, FactCheck, UploadFile } from '@mui/icons-material';
import { useRegion } from '../../contexts/RegionContext';
import { uiPair } from '../../lib/uiLanguages';
import {
  SP_SCHEME_VERSION,
  applySpSchemePackage,
  buildSpSchemeText,
  parseSpSchemePackage,
  validateSpSchemePackage,
} from '../../lib/spScheme';

function downloadText(filename, text, type) {
  const blob = new Blob([text], { type });
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

/**
 * SP-Scheme: copy the platform contract to any external LLM, then upload the
 * package it produces. Nothing is saved until the researcher confirms import.
 */
export default function SpSchemePanel({ config, onChange, saveSkill }) {
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

  const copyScheme = async () => {
    try {
      await navigator.clipboard.writeText(schemeText);
      setNotice({ severity: 'success', text: L('SP-Scheme copied. Paste it into any LLM together with your study idea.', 'SP-Scheme 已复制。把它和你的研究想法一起发给任意大模型。') });
    } catch {
      downloadText(`sp-scheme-${SP_SCHEME_VERSION}.md`, schemeText, 'text/markdown');
      setNotice({ severity: 'info', text: L('Clipboard unavailable; downloaded the file instead.', '无法写入剪贴板，已改为下载文件。') });
    }
  };

  const check = (text) => {
    setReport(null);
    setParseError('');
    try {
      setReport(validateSpSchemePackage(parseSpSchemePackage(text)));
    } catch (err) {
      setParseError(err.message);
    }
  };

  const onFile = (event) => {
    const file = event.target.files?.[0];
    event.target.value = '';
    if (!file) return;
    const reader = new FileReader();
    reader.onload = (e) => {
      const text = String(e.target.result || '');
      setPasted(text);
      setOpen(true);
      check(text);
    };
    reader.readAsText(file);
  };

  const closeDialog = () => {
    if (importing) return;
    setOpen(false);
  };

  const doImport = async () => {
    setImporting(true);
    try {
      const next = await applySpSchemePackage(report, { saveSkill, baseConfig: config });
      onChange(next);
      setOpen(false);
      setReport(null);
      setPasted('');
      setNotice({ severity: 'success', text: L('Imported into the Builder. Review it, preview, then Save.', '已导入 Builder。检查并预览后再点保存。') });
    } catch (err) {
      setParseError(err.message || String(err));
    } finally {
      setImporting(false);
    }
  };

  const hasQuestions = (config?.pages || []).some((p) => (p.elements || []).length);
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
          {L('Copy SP-Scheme. It tells the model how media is randomised, how questions are described and how answers are recorded.', '复制 SP-Scheme。它告诉大模型平台如何随机抽图、如何描述题目、如何记录答案。')}
        </Typography>
        <Typography component="li" variant="body2">
          {L('Paste it into ChatGPT, Claude, Gemini or any model with your study idea. Interfaces and interactions are up to the model.', '连同你的研究想法发给 ChatGPT、Claude、Gemini 等任意模型。界面和交互由模型自由发挥。')}
        </Typography>
        <Typography component="li" variant="body2">
          {L('Upload the JSON package it returns. The Builder checks it against the platform format before anything is imported.', '上传模型返回的 JSON 包。Builder 会先按平台格式检查，通过后才导入。')}
        </Typography>
      </Box>

      <Box sx={{ display: 'flex', gap: 1, flexWrap: 'wrap' }}>
        <Button variant="contained" startIcon={<ContentCopy />} onClick={copyScheme}>
          {L('Copy SP-Scheme', '复制 SP-Scheme')}
        </Button>
        <Button variant="outlined" startIcon={<Download />} onClick={() => downloadText(`sp-scheme-${SP_SCHEME_VERSION}.md`, schemeText, 'text/markdown')}>
          {L('Download .md', '下载 .md')}
        </Button>
        <input ref={fileRef} type="file" accept=".json,.txt,.md,application/json" hidden onChange={onFile} data-testid="sp-scheme-file" />
        <Button variant="outlined" startIcon={<UploadFile />} onClick={() => fileRef.current?.click()}>
          {L('Upload package', '上传问卷包')}
        </Button>
        <Button variant="text" startIcon={<FactCheck />} onClick={() => setOpen(true)}>
          {L('Paste and check', '粘贴并检查')}
        </Button>
      </Box>

      {notice ? <Alert severity={notice.severity} sx={{ mt: 1.5 }} onClose={() => setNotice(null)}>{notice.text}</Alert> : null}

      <Dialog open={open} onClose={closeDialog} fullWidth maxWidth="md">
        <DialogTitle>{L('Check an SP-Scheme package', '检查 SP-Scheme 问卷包')}</DialogTitle>
        <DialogContent dividers>
          <TextField
            fullWidth
            multiline
            minRows={6}
            maxRows={14}
            value={pasted}
            onChange={(e) => { setPasted(e.target.value); setReport(null); setParseError(''); }}
            placeholder={L('Paste the model\'s JSON (a ```json block is fine) or upload the file.', '粘贴大模型输出的 JSON（带 ```json 代码块也可以），或上传文件。')}
            inputProps={{ 'aria-label': 'SP-Scheme package', style: { fontFamily: 'monospace', fontSize: 12 } }}
          />
          <Box sx={{ mt: 1, display: 'flex', gap: 1 }}>
            <Button variant="outlined" size="small" startIcon={<FactCheck />} onClick={() => check(pasted)} disabled={!pasted.trim()}>
              {L('Check format', '检查格式')}
            </Button>
          </Box>

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
                    {L(`${summary.pageCount} pages · ${summary.questionCount} questions · ${summary.customInteractionCount} custom interactions`,
                      `${summary.pageCount} 页 · ${summary.questionCount} 题 · ${summary.customInteractionCount} 个自定义交互`)}
                  </Typography>
                ) : null}
              </Alert>
              {report.errors.length ? <Box><Typography variant="subtitle2" color="error">{L('Errors', '错误')}</Typography><IssueList items={report.errors} max={20} /></Box> : null}
              {report.warnings.length ? <Box><Typography variant="subtitle2" color="warning.main">{L('Warnings', '提醒')}</Typography><IssueList items={report.warnings} /></Box> : null}
              {summary ? (
                <Box sx={{ display: 'flex', gap: 0.5, flexWrap: 'wrap' }}>
                  {Object.entries(summary.types).map(([type, n]) => <Chip key={type} size="small" label={`${type} × ${n}`} />)}
                </Box>
              ) : null}
              {report.ok && hasQuestions ? (
                <Alert severity="warning">
                  {L('Importing replaces the current pages and questions. Theme and logo are kept. Collected responses are not changed; publish only after reviewing.', '导入会替换当前的页面和题目，主题和 Logo 保留。已收集的答卷不受影响；请检查后再发布。')}
                </Alert>
              ) : null}
            </Box>
          ) : null}
        </DialogContent>
        <DialogActions>
          <Button onClick={closeDialog} disabled={importing} color="inherit">{L('Cancel', '取消')}</Button>
          <Button variant="contained" onClick={doImport} disabled={!report?.ok || importing}>
            {importing ? L('Importing…', '导入中…') : L('Import into Builder', '导入 Builder')}
          </Button>
        </DialogActions>
      </Dialog>
    </Paper>
  );
}
