import React, { useEffect, useState } from 'react';
import {
  Alert, Box, Button, Chip, CircularProgress, Container, Link, Paper, Stack, Tab, Tabs, Typography,
} from '@mui/material';
import { ContentCopy, OpenInNew } from '@mui/icons-material';
import { Link as RouterLink } from 'react-router-dom';
import PublicHeader, { PublicFooter } from '../components/layout/PublicHeader';
import { useRegion } from '../contexts/RegionContext';
import { uiPair } from '../lib/uiLanguages';
import { platformCitations, PLATFORM_REPOSITORY } from '../lib/platformCitation';

export const PUBLICATIONS_URL = '/research/sp-survey-publications.json';
const ADD_PAPER_URL = 'https://github.com/Sijie-Yang/SP-Survey-Platform/blob/main/public/research/sp-survey-publications.json';

export function sortPublications(list) {
  return [...(list || [])]
    .filter((p) => p && p.title)
    .sort((a, b) => (Number(b.year) || 0) - (Number(a.year) || 0) || String(a.title).localeCompare(String(b.title)));
}

function CiteBox({ L }) {
  const c = platformCitations();
  const [tab, setTab] = useState('apa');
  const [copied, setCopied] = useState(false);
  const text = tab === 'bibtex' ? c.all.bibtex : c.all.apa.replace(/\*/g, '');
  return (
    <Paper variant="outlined" sx={{ p: { xs: 2, sm: 2.5 }, mb: 4 }}>
      <Typography variant="h6" sx={{ mb: 0.5 }}>{L('How to cite SP-Survey', '如何引用 SP-Survey')}</Typography>
      <Typography variant="body2" color="text.secondary" sx={{ mb: 1 }}>
        {L('Please cite SP-Survey with the version you used, for reproducibility. Exports from the platform include this as references.bib and CITATION.cff.',
          '请引用 SP-Survey 并注明所用版本，便于复现。平台的导出包里已带 references.bib 和 CITATION.cff。')}
      </Typography>
      <Tabs value={tab} onChange={(_, v) => { setTab(v); setCopied(false); }} sx={{ minHeight: 36, '& .MuiTab-root': { minHeight: 36 } }}>
        <Tab value="apa" label="APA" />
        <Tab value="bibtex" label="BibTeX" />
      </Tabs>
      <Box component="pre" data-testid="publications-citation" sx={{
        m: 0, mt: 1, p: 1.5, bgcolor: 'action.hover', borderRadius: 1, fontSize: 13, lineHeight: 1.55,
        whiteSpace: 'pre-wrap', wordBreak: 'break-word', fontFamily: tab === 'bibtex' ? 'monospace' : 'inherit',
      }}>{text}</Box>
      <Button size="small" startIcon={<ContentCopy />} sx={{ mt: 1 }}
        onClick={() => navigator.clipboard?.writeText(text).then(() => setCopied(true)).catch(() => setCopied(false))}>
        {copied ? L('Copied', '已复制') : L('Copy', '复制')}
      </Button>
      <Typography variant="caption" color="text.secondary" display="block" sx={{ mt: 1 }}>
        {L('Writing up a perception experiment? Use the ', '在写感知实验的论文？请参考 ')}
        <Link component={RouterLink} to="/docs/sp-report">SP-Report</Link>
        {L(' reporting checklist.', ' 报告清单。')}
      </Typography>
    </Paper>
  );
}

/** Papers that used SP-Survey, plus how to cite the platform. */
export default function PublicationsPage() {
  const { language } = useRegion();
  const L = (en, zh) => uiPair(language, en, zh);
  const [state, setState] = useState({ loading: true, items: [], error: '' });

  useEffect(() => {
    let cancelled = false;
    fetch(PUBLICATIONS_URL)
      .then((res) => (res.ok ? res.json() : Promise.reject(new Error(`HTTP ${res.status}`))))
      .then((data) => { if (!cancelled) setState({ loading: false, items: sortPublications(data.publications), error: '' }); })
      .catch((err) => { if (!cancelled) setState({ loading: false, items: [], error: err?.message || String(err) }); });
    return () => { cancelled = true; };
  }, []);

  const statusLabel = (s) => ({ published: L('Published', '已发表'), 'under review': L('Under review', '审稿中'), preprint: L('Preprint', '预印本') }[s] || s);

  return (
    <Box sx={{ minHeight: '100vh', bgcolor: 'background.default', display: 'flex', flexDirection: 'column' }}>
      <PublicHeader />
      <Container maxWidth="md" sx={{ py: 4, flex: 1 }}>
        <Typography variant="h4" component="h1" fontWeight={800} sx={{ mb: 1 }}>{L('Research using SP-Survey', '用 SP-Survey 完成的研究')}</Typography>
        <Typography color="text.secondary" sx={{ mb: 3 }}>
          {L('Papers whose data were collected or analysed with SP-Survey. Published one? Add it with a pull request, and it appears here.',
            '数据用 SP-Survey 收集或分析的论文。你发表了？提交一个 pull request 加进来，就会出现在这里。')}
        </Typography>
        <CiteBox L={L} />
        <Stack direction="row" alignItems="center" spacing={1} sx={{ mb: 1.5 }}>
          <Typography variant="h6" sx={{ flex: 1 }}>{L('Papers', '论文')}{state.items.length ? ` · ${state.items.length}` : ''}</Typography>
          <Button size="small" href={ADD_PAPER_URL} target="_blank" rel="noopener" endIcon={<OpenInNew fontSize="small" />}>
            {L('Add your paper', '添加你的论文')}
          </Button>
        </Stack>
        {state.loading && <CircularProgress size={24} />}
        {state.error && <Alert severity="warning">{L('Could not load the list.', '列表加载失败。')}</Alert>}
        <Stack spacing={1.5}>
          {state.items.map((p) => {
            const href = p.doi ? `https://doi.org/${p.doi}` : p.url || '';
            return (
              <Paper key={`${p.title}-${p.year}`} variant="outlined" sx={{ p: 2 }} data-testid="publication">
                <Typography variant="subtitle1" sx={{ fontWeight: 600, lineHeight: 1.4 }}>
                  {href ? <Link href={href} target="_blank" rel="noopener" underline="hover">{p.title}</Link> : p.title}
                </Typography>
                <Typography variant="body2" color="text.secondary">{p.authors}</Typography>
                <Stack direction="row" spacing={1} alignItems="center" sx={{ mt: 0.75, flexWrap: 'wrap', rowGap: 0.5 }}>
                  <Typography variant="body2"><em>{p.venue}</em>{p.year ? `, ${p.year}` : ''}</Typography>
                  {p.status && p.status !== 'published' && <Chip size="small" label={statusLabel(p.status)} />}
                  {p.kind === 'method' && <Chip size="small" variant="outlined" label={L('Platform paper', '平台论文')} />}
                  {p.kind === 'dataset' && <Chip size="small" variant="outlined" label={L('Dataset', '数据集')} />}
                </Stack>
              </Paper>
            );
          })}
        </Stack>
        <Typography variant="caption" color="text.secondary" display="block" sx={{ mt: 3 }}>
          {L('Source code: ', '源代码：')}<Link href={PLATFORM_REPOSITORY} target="_blank" rel="noopener">{PLATFORM_REPOSITORY.replace('https://', '')}</Link>
        </Typography>
      </Container>
      <PublicFooter />
    </Box>
  );
}
