import React, { useState } from 'react';
import { Box, Button, Chip, Stack, Typography } from '@mui/material';
import WikiMarkdown from './WikiMarkdown';
import { wikiHistory } from '../../lib/contentSubmissionStore';

export default function WikiPublishedArticle({ page, language, lead }) {
  const zh = language === 'zh';
  const [history, setHistory] = useState(null);
  const [error, setError] = useState('');
  const loadHistory = async () => { try { setHistory(await wikiHistory(page.page_key, page.language)); } catch { setError(zh ? '版本记录暂时无法加载。' : 'Revision history is unavailable.'); } };
  return <>
    <Typography variant="overline">SP-WIKI</Typography>
    <Typography component="h1" variant="h3" sx={{ fontSize: { xs: 30, md: 44 }, fontWeight: 800, my: 2 }}>{page.title}</Typography>
    {lead}
    <Typography sx={{ fontSize: 18, color: 'text.secondary', lineHeight: 1.8 }}>{page.summary}</Typography>
    <Stack direction="row" gap={1} flexWrap="wrap" sx={{ my: 2 }}><Chip size="small" label={zh ? `已审核 · 版本 ${page.revision}` : `Reviewed · Revision ${page.revision}`} /><Chip size="small" label={page.language.toUpperCase()} /><Typography variant="body2" sx={{ alignSelf: 'center' }}>{zh ? '贡献者：' : 'Contributor: '}{page.contributor_name}</Typography></Stack>
    <WikiMarkdown body={page.body} />
    <Box sx={{ mt: 3 }}><Button onClick={loadHistory}>{zh ? '查看版本记录' : 'View revision history'}</Button>{error && <Typography color="error">{error}</Typography>}{history?.map(row => <Typography key={row.revision} variant="body2" sx={{ py: 0.5 }}>v{row.revision} · {row.contributor_name} · {new Date(row.published_at).toLocaleDateString()} · {row.title}</Typography>)}</Box>
  </>;
}
