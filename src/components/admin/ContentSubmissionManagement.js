import React, { useCallback, useEffect, useState } from 'react';
import { Alert, Box, Button, CircularProgress, Dialog, DialogContent, DialogTitle, MenuItem, Stack, TextField, Typography } from '@mui/material';
import { getWikiPage, listSubmissions, reviewSubmission, submissionHistory } from '../../lib/contentSubmissionStore';
import { builtinWikiSource, sameWikiContent } from '../../lib/wikiSource';
import WikiMarkdown from '../docs/WikiMarkdown';

const statuses = { pending: '待审核', changes_requested: '待作者修改', rejected: '未通过', approved: '已发布' };
export default function ContentSubmissionManagement() {
  const [rows, setRows] = useState([]); const [filter, setFilter] = useState('pending');
  const [selected, setSelected] = useState(null); const [current, setCurrent] = useState(null); const [events, setEvents] = useState([]);
  const [note, setNote] = useState(''); const [busy, setBusy] = useState(false); const [loading, setLoading] = useState(false);
  const [error, setError] = useState(''); const [detailError, setDetailError] = useState(''); const [detailLoading, setDetailLoading] = useState(false);
  const load = useCallback(async () => { setLoading(true); setError(''); try { setRows(await listSubmissions({ status: filter })); } catch (e) { setError(e.missingSchema ? '投稿数据库尚未初始化。请按 docs/sp-wiki.md 应用 supabase/wiki_submissions.sql。' : e.message); } finally { setLoading(false); } }, [filter]);
  useEffect(() => { load(); }, [load]);
  useEffect(() => {
    if (!selected) return undefined;
    let active = true; setDetailLoading(true); setDetailError(''); setCurrent(null); setEvents([]);
    Promise.all([selected.kind === 'doc_edit' ? getWikiPage(selected.target_key, selected.language).then(p => p || builtinWikiSource(selected.target_key, selected.language)) : Promise.resolve(null), submissionHistory(selected.id)])
      .then(([page, history]) => { if (active) { setCurrent(page); setEvents(history); } })
      .catch(e => { if (active) setDetailError(e.message); }).finally(() => { if (active) setDetailLoading(false); });
    return () => { active = false; };
  }, [selected]);
  const stale = selected?.kind === 'doc_edit' && (!current || current.revision !== selected.base_revision || (selected.base_revision === 0 && !sameWikiContent(current, selected.base_content)));
  const decide = async decision => {
    setBusy(true); setDetailError('');
    try { await reviewSubmission(selected, decision, note); setSelected(null); await load(); } catch (e) { setDetailError(e.code === '40001' ? '申请或文档版本已改变，请关闭后刷新。文档冲突时应退回作者合并修改。' : e.message); } finally { setBusy(false); }
  };
  return <Box>
    <Typography variant="h5" fontWeight={700}>SP-Wiki · Doc / News 审核</Typography>
    <Typography color="text.secondary" sx={{ my: 1 }}>审核通过会直接发布对应语言的文档版本或新闻。普通用户只能提交申请；原始稿件和审核操作保留在记录中。</Typography>
    <Stack direction="row" gap={2} sx={{ my: 2 }}><TextField size="small" select label="审核状态" value={filter} onChange={e => setFilter(e.target.value)} sx={{ minWidth: 180 }}><MenuItem value="all">全部（最近 200 条）</MenuItem>{Object.entries(statuses).map(([value,label]) => <MenuItem key={value} value={value}>{label}</MenuItem>)}</TextField><Button onClick={load}>刷新</Button></Stack>
    {error && <Alert severity="error">{error}</Alert>}{loading && <CircularProgress />}{!loading && !rows.length && !error && <Typography>暂无投稿。</Typography>}
    {rows.map(row => <Box key={row.id} sx={{ p: 2, border: 1, borderColor: 'divider', borderRadius: 2, mb: 2 }}><Typography fontWeight={700}>{row.title}</Typography><Typography variant="body2">{row.kind} · {row.language.toUpperCase()} · {row.contributor_name} · {statuses[row.status]} · {new Date(row.updated_at).toLocaleString()}</Typography><Button onClick={() => { setSelected(row); setNote(''); }}>查看内容与审核</Button></Box>)}
    {selected && <Dialog open onClose={() => { if (!busy) setSelected(null); }} fullWidth maxWidth="xl"><DialogTitle>{selected.title}<Button disabled={busy} sx={{ float: 'right' }} onClick={() => setSelected(null)}>关闭</Button></DialogTitle><DialogContent>
      <Typography variant="body2">{selected.contributor_name} · {selected.language.toUpperCase()} · {selected.kind} · 申请版本 {selected.version}</Typography>
      <Typography sx={{ my: 1, whiteSpace: 'pre-wrap' }}>投稿说明：{selected.change_reason}</Typography><Typography sx={{ mb: 2, whiteSpace: 'pre-wrap' }}>来源与授权：{selected.source_notes || '未填写'} · 作者已确认发布授权</Typography>
      {detailLoading && <CircularProgress />}{detailError && <Alert severity="error" sx={{ my: 2 }}>{detailError}</Alert>}
      {!detailLoading && stale && <Alert severity="warning" sx={{ my: 2 }}>原文已更新或无法确认。请退回修改，要求作者载入最新原文并合并；当前申请不能直接发布。</Alert>}
      {selected.kind === 'doc_edit' && <Box component="details" sx={{ my: 2 }}><summary>作者开始修改时的原文（社区版本 {selected.base_revision}）</summary><Typography fontWeight={700}>{selected.base_content?.title}</Typography><Typography>{selected.base_content?.summary}</Typography><WikiMarkdown body={selected.base_content?.body} /></Box>}
      <Box sx={{ display: 'grid', gridTemplateColumns: { xs: '1fr', md: selected.kind === 'doc_edit' ? '1fr 1fr' : '1fr' }, gap: 2, my: 2 }}>
        {selected.kind === 'doc_edit' && <Box sx={{ p: 2, border: 1, borderColor: 'divider', minWidth: 0, maxHeight: '55vh', overflow: 'auto' }}><Typography variant="h6">当前公开原文</Typography><Typography fontWeight={700}>{current?.title}</Typography><Typography>{current?.summary}</Typography><WikiMarkdown body={current?.body} /></Box>}
        <Box sx={{ p: 2, border: 1, borderColor: 'divider', minWidth: 0, maxHeight: '55vh', overflow: 'auto' }}><Typography variant="h6">拟发布内容</Typography><Typography fontWeight={700}>{selected.title}</Typography><Typography>{selected.summary}</Typography><WikiMarkdown body={selected.body} /></Box>
      </Box>
      {selected.status === 'pending' ? <><TextField fullWidth multiline minRows={2} label="审核反馈（退回或拒绝时必填，作者可见）" value={note} onChange={e => setNote(e.target.value)} inputProps={{ maxLength: 4000 }} disabled={busy} /><Stack direction="row" gap={1} flexWrap="wrap" sx={{ mt: 2 }}><Button variant="contained" disabled={busy || detailLoading || !!detailError || stale} onClick={() => decide('approved')}>审核通过并发布</Button><Button disabled={busy || note.trim().length < 3} onClick={() => decide('changes_requested')}>退回修改</Button><Button color="error" disabled={busy || note.trim().length < 3} onClick={() => decide('rejected')}>拒绝</Button></Stack></> : <Alert severity="info">{statuses[selected.status]} · {selected.review_note || '无附加反馈'}</Alert>}
      {selected.published_url && <Button href={selected.published_url} target="_blank" rel="noopener noreferrer">查看发布结果</Button>}
      <Box component="details" sx={{ mt: 3 }}><summary>投稿与审核记录（{events.length}）</summary>{events.map((event,i) => <Box key={i} component="details" sx={{ my: 1 }}><summary>{new Date(event.created_at).toLocaleString()} · {event.action} · v{event.snapshot.version}</summary><Typography>{event.snapshot.review_note}</Typography><Typography>{event.snapshot.title}</Typography><WikiMarkdown body={event.snapshot.body} /></Box>)}</Box>
    </DialogContent></Dialog>}
  </Box>;
}
