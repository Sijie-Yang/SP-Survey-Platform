import React, { useState } from 'react';
import {
  Box, Button, Dialog, DialogActions, DialogContent, DialogTitle, Link, Tab, Tabs, Typography,
} from '@mui/material';
import { FormatQuote } from '@mui/icons-material';
import { uiPair } from '../../lib/uiLanguages';
import { platformCitations, PLATFORM_VERSION } from '../../lib/platformCitation';
import { SP_REPORT_URL } from '../../lib/spReport';
import { AdminActionButton } from './AdminPageLayout';

async function copyText(text) {
  try {
    await navigator.clipboard.writeText(text);
    return true;
  } catch {
    return false;
  }
}

/** "Cite" button for the Results toolbar: BibTeX, APA and a methods sentence, one click to copy. */
export default function CitePlatformButton({ language }) {
  const L = (en, zh) => uiPair(language, en, zh);
  const [open, setOpen] = useState(false);
  const [tab, setTab] = useState('bibtex');
  const [copied, setCopied] = useState('');
  const c = platformCitations();
  const formats = {
    bibtex: { label: 'BibTeX', text: `${c.bibtex}\n\n${c.software.bibtex}` },
    apa: { label: 'APA', text: `${c.apa.replace(/\*/g, '')}\n\n${c.software.apa.replace(/\*/g, '')}` },
    text: { label: L('Methods sentence', '方法段落'), text: c.text },
  };
  const current = formats[tab];

  const copy = async () => {
    const ok = await copyText(current.text);
    setCopied(ok ? tab : 'fail');
  };

  return (
    <>
      <AdminActionButton startIcon={<FormatQuote />} onClick={() => { setOpen(true); setCopied(''); }}>
        {L('Cite', '引用')}
      </AdminActionButton>
      <Dialog open={open} onClose={() => setOpen(false)} maxWidth="sm" fullWidth>
        <DialogTitle>{L('Cite SP-Survey', '引用 SP-Survey')}</DialogTitle>
        <DialogContent dividers>
          <Typography variant="body2" color="text.secondary" sx={{ mb: 1.5 }}>
            {L(
              `If these data appear in a paper, please cite the SP-Survey paper and the software version you used (${PLATFORM_VERSION}). Every export also carries references.bib and CITATION.cff.`,
              `数据用在论文里时，请引用 SP-Survey 论文和所用的软件版本（${PLATFORM_VERSION}）。每个导出包里也带 references.bib 和 CITATION.cff。`,
            )}
          </Typography>
          <Tabs value={tab} onChange={(_, v) => { setTab(v); setCopied(''); }} sx={{ mb: 1 }}>
            {Object.entries(formats).map(([id, f]) => <Tab key={id} value={id} label={f.label} />)}
          </Tabs>
          <Box component="pre" data-testid="citation-text" sx={{
            m: 0, p: 1.5, bgcolor: 'action.hover', borderRadius: 1, fontSize: 12.5, lineHeight: 1.55,
            whiteSpace: 'pre-wrap', wordBreak: 'break-word', fontFamily: tab === 'bibtex' ? 'monospace' : 'inherit',
          }}>
            {current.text}
          </Box>
          <Typography variant="caption" color="text.secondary" display="block" sx={{ mt: 1.5 }}>
            {L('Reporting a perception experiment? The export README includes the ', '写感知实验的论文？导出的 README 里附有 ')}
            <Link href={SP_REPORT_URL.replace('https://sp-survey.org', '')} target="_blank" rel="noopener">SP-Report</Link>
            {L(' checklist, already filled from your data where possible.', ' 报告清单，能从数据里填的已经填好。')}
          </Typography>
        </DialogContent>
        <DialogActions>
          {copied === 'fail' && <Typography variant="caption" color="error" sx={{ mr: 'auto', ml: 1 }}>{L('Copy failed; select the text instead.', '复制失败，请手动选中文本。')}</Typography>}
          <Button onClick={() => setOpen(false)}>{L('Close', '关闭')}</Button>
          <Button variant="contained" onClick={copy}>
            {copied === tab ? L('Copied', '已复制') : L(`Copy ${current.label}`, `复制 ${current.label}`)}
          </Button>
        </DialogActions>
      </Dialog>
    </>
  );
}
