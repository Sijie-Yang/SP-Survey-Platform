import React, { useCallback, useEffect, useMemo, useRef, useState, memo } from 'react';
import { useVirtualizer } from '@tanstack/react-virtual';
import {
  Alert, Box, Button, Checkbox, Chip, CircularProgress, Dialog, DialogActions,
  DialogContent, DialogTitle, FormControlLabel, IconButton, LinearProgress, Paper,
  Snackbar, Stack, Table, TableBody, TableCell, TableHead, TableRow, TextField,
  Tooltip, Typography,
} from '@mui/material';
import {
  OpenInNew, Refresh, AutoAwesome, UploadFile, Delete,
  ThumbUp, ThumbDown, Search, Clear, Link as LinkIcon, LinkOff,
} from '@mui/icons-material';
import { draftTemplateFromPaper } from '../../lib/researchSearch';
import {
  listAllResearchPapers,
  updateResearchPaper,
  upsertResearchCandidates,
  deleteResearchPaper,
} from '../../lib/researchPaperStore';
import { listAllTemplates, saveTemplateToSupabase } from '../../lib/templateManager';
import {
  matchPapersToTemplates,
  selectedMatchRows,
  suggestTemplatesForPaper,
  filterTemplatesByQuery,
  paperDoi,
} from '../../lib/researchTemplateMatch';

const ROW_H = 52;
const COLS = '48px minmax(0, 1fr) 52px 48px 72px 100px 72px 168px';

const FIT_TONE = {
  unknown: 'default',
  likely: 'success',
  unlikely: 'warning',
};

const CONF_LABEL = {
  doi: 'DOI',
  title_year: '标题+年',
  title: '标题',
  title_partial: '标题近似',
};

function sourceLabel(s) {
  if (s === 'semantic_scholar') return 'S2';
  if (s === 'scopus') return 'Scopus';
  return s;
}

/** Client-side stable sort: year desc → score desc → title asc → id */
function sortPapersStable(rows) {
  return [...(rows || [])].sort((a, b) => {
    const ya = a.year || 0;
    const yb = b.year || 0;
    if (ya !== yb) return yb - ya;
    const sa = Number(a.relevance_score) || 0;
    const sb = Number(b.relevance_score) || 0;
    if (sa !== sb) return sb - sa;
    const ta = String(a.title || '').localeCompare(String(b.title || ''), undefined, { sensitivity: 'base' });
    if (ta !== 0) return ta;
    return String(a.id || '').localeCompare(String(b.id || ''));
  });
}

function PaperActions({
  paper,
  onFit,
  onDraft,
  onDelete,
  onUnlink,
  onLink,
  draftingId,
}) {
  return (
    <Stack direction="row" spacing={0} justifyContent="flex-end" alignItems="center">
      <Tooltip title="Likely template">
        <IconButton size="small" color="success" onClick={() => onFit(paper, 'likely')}>
          <ThumbUp fontSize="small" />
        </IconButton>
      </Tooltip>
      <Tooltip title="Unlikely template">
        <IconButton size="small" color="warning" onClick={() => onFit(paper, 'unlikely')}>
          <ThumbDown fontSize="small" />
        </IconButton>
      </Tooltip>
      <Tooltip title={paper.template_id ? '更换关联模板' : '关联已有模板'}>
        <IconButton size="small" color="secondary" onClick={() => onLink(paper)}>
          <LinkIcon fontSize="small" />
        </IconButton>
      </Tooltip>
      <Tooltip title={paper.template_id ? `已关联 ${paper.template_id}` : '生成未发布模板'}>
        <span>
          <IconButton
            size="small"
            color="primary"
            disabled={!!draftingId || !!paper.template_id}
            onClick={() => onDraft(paper)}
          >
            {draftingId === paper.id
              ? <CircularProgress size={14} />
              : <AutoAwesome fontSize="small" />}
          </IconButton>
        </span>
      </Tooltip>
      {paper.template_id && (
        <Tooltip title={`取消关联 ${paper.template_id}`}>
          <IconButton size="small" onClick={() => onUnlink(paper)}>
            <LinkOff fontSize="small" />
          </IconButton>
        </Tooltip>
      )}
      {paper.paper_url && (
        <Tooltip title="打开论文">
          <IconButton size="small" component="a" href={paper.paper_url} target="_blank" rel="noreferrer">
            <OpenInNew fontSize="small" />
          </IconButton>
        </Tooltip>
      )}
      <Tooltip title="永久删除">
        <IconButton size="small" color="error" onClick={() => onDelete(paper)}>
          <Delete fontSize="small" />
        </IconButton>
      </Tooltip>
    </Stack>
  );
}

const PapersTable = memo(function PapersTable({ rows, emptyLabel, ...actionProps }) {
  const parentRef = useRef(null);
  const virtualizer = useVirtualizer({
    count: rows.length,
    getScrollElement: () => parentRef.current,
    estimateSize: () => ROW_H,
    overscan: 16,
  });

  if (!rows.length) {
    return (
      <Typography variant="body2" color="text.secondary" sx={{ py: 2, textAlign: 'center' }}>
        {emptyLabel}
      </Typography>
    );
  }

  return (
    <Paper variant="outlined" sx={{ overflow: 'hidden' }}>
      <Box
        sx={{
          display: 'grid',
          gridTemplateColumns: COLS,
          gap: 1,
          px: 1.5,
          py: 0.75,
          bgcolor: 'grey.50',
          borderBottom: 1,
          borderColor: 'divider',
          fontWeight: 700,
          typography: 'caption',
          color: 'text.secondary',
        }}
      >
        <Box textAlign="right">#</Box>
        <Box>标题</Box>
        <Box textAlign="center">年</Box>
        <Box textAlign="center">分</Box>
        <Box>Fit</Box>
        <Box>模板</Box>
        <Box>来源</Box>
        <Box textAlign="right">操作</Box>
      </Box>
      <Box ref={parentRef} sx={{ height: '70vh', overflow: 'auto', position: 'relative' }}>
        <Box sx={{ height: virtualizer.getTotalSize(), width: '100%', position: 'relative' }}>
          {virtualizer.getVirtualItems().map((vRow) => {
            const paper = rows[vRow.index];
            return (
              <Box
                key={paper.id || `${paper.doi}-${paper.title}`}
                sx={{
                  position: 'absolute',
                  top: 0,
                  left: 0,
                  width: '100%',
                  height: `${vRow.size}px`,
                  transform: `translateY(${vRow.start}px)`,
                  display: 'grid',
                  gridTemplateColumns: COLS,
                  gap: 1,
                  alignItems: 'center',
                  px: 1.5,
                  borderBottom: 1,
                  borderColor: 'divider',
                  '&:hover': { bgcolor: 'action.hover' },
                }}
              >
                <Typography variant="caption" color="text.secondary" textAlign="right">
                  {vRow.index + 1}
                </Typography>
                <Box sx={{ minWidth: 0 }}>
                  <Typography variant="body2" fontWeight={600} noWrap title={paper.title}>
                    {paper.title}
                  </Typography>
                  <Typography variant="caption" color="text.secondary" noWrap display="block" title={paper.abstract || ''}>
                    {(paper.authors || []).slice(0, 2).join(', ') || '—'}
                    {paper.venue ? ` · ${paper.venue}` : ''}
                    {paper.doi ? ` · ${paper.doi}` : ''}
                  </Typography>
                </Box>
                <Typography variant="body2" textAlign="center">{paper.year || '—'}</Typography>
                <Typography variant="body2" textAlign="center">{paper.relevance_score ?? '—'}</Typography>
                <Chip
                  size="small"
                  label={paper.template_fit}
                  color={FIT_TONE[paper.template_fit] || 'default'}
                  variant="outlined"
                />
                <Box sx={{ minWidth: 0 }}>
                  {paper.template_id ? (
                    <Chip
                      size="small"
                      color="success"
                      variant="outlined"
                      label={paper.template_id}
                      title={paper.template_id}
                      sx={{ maxWidth: '100%', '& .MuiChip-label': { overflow: 'hidden', textOverflow: 'ellipsis' } }}
                    />
                  ) : (
                    <Typography variant="caption" color="text.disabled">—</Typography>
                  )}
                </Box>
                <Typography variant="caption" color="text.secondary" noWrap>
                  {(paper.sources || []).map(sourceLabel).join(', ') || '—'}
                </Typography>
                <Box display="flex" justifyContent="flex-end">
                  <PaperActions paper={paper} {...actionProps} />
                </Box>
              </Box>
            );
          })}
        </Box>
      </Box>
    </Paper>
  );
});

/** Admin paper library (coarse import lands here as approved). */
export default function ResearchDeepSearch() {
  const [listLoading, setListLoading] = useState(false);
  const [importing, setImporting] = useState(false);
  const [importProgress, setImportProgress] = useState(null);
  const [matching, setMatching] = useState(false);
  const [applyingMatch, setApplyingMatch] = useState(false);
  const [snack, setSnack] = useState({ open: false, msg: '', sev: 'success' });
  const [library, setLibrary] = useState([]);
  const [activeFilter, setActiveFilter] = useState('');
  const searchRef = useRef(null);
  const [draftingId, setDraftingId] = useState(null);
  const [draftDialog, setDraftDialog] = useState(null);
  const [matchDialog, setMatchDialog] = useState(null);
  const [matchOverrides, setMatchOverrides] = useState({});
  const [templates, setTemplates] = useState([]);
  const [linkPaper, setLinkPaper] = useState(null);
  const [linkQuery, setLinkQuery] = useState('');
  const [linkSaving, setLinkSaving] = useState(false);
  const [linkFilter, setLinkFilter] = useState('all'); // all | linked | unlinked

  const showSnack = (msg, sev = 'success') => setSnack({ open: true, msg, sev });

  const linkedCount = useMemo(
    () => library.filter((p) => !!p.template_id).length,
    [library],
  );

  const ensureTemplates = useCallback(async () => {
    if (templates.length) return templates;
    const rows = await listAllTemplates();
    setTemplates(rows);
    return rows;
  }, [templates]);

  const loadLists = useCallback(async () => {
    setListLoading(true);
    try {
      const approved = await listAllResearchPapers({ status: 'approved' });
      setLibrary(sortPapersStable(approved));
    } catch (err) {
      showSnack(err.message || String(err), 'error');
    } finally {
      setListLoading(false);
    }
  }, []);

  useEffect(() => {
    loadLists();
  }, [loadLists]);

  const filteredLibrary = useMemo(() => {
    let rows = library;
    if (linkFilter === 'linked') rows = rows.filter((p) => !!p.template_id);
    if (linkFilter === 'unlinked') rows = rows.filter((p) => !p.template_id);
    const q = activeFilter.trim().toLowerCase();
    if (!q) return rows;
    return rows.filter((p) => {
      const title = String(p.title || '').toLowerCase();
      const doi = String(p.doi || '').toLowerCase();
      const venue = String(p.venue || '').toLowerCase();
      const tpl = String(p.template_id || '').toLowerCase();
      const authors = Array.isArray(p.authors)
        ? p.authors.join(' ').toLowerCase()
        : '';
      return (
        title.includes(q)
        || doi.includes(q)
        || venue.includes(q)
        || authors.includes(q)
        || tpl.includes(q)
      );
    });
  }, [library, activeFilter, linkFilter]);

  const runSearch = useCallback(() => {
    const q = (searchRef.current?.value || '').trim();
    setActiveFilter(q);
  }, []);

  const clearSearch = useCallback(() => {
    if (searchRef.current) searchRef.current.value = '';
    setActiveFilter('');
  }, []);

  const importShortlist = async () => {
    setImporting(true);
    setImportProgress({ current: 0, total: 0, inserted: 0, updated: 0, skipped: 0 });
    try {
      const res = await fetch('/research/scopus-shortlist.json');
      if (!res.ok) throw new Error(`Could not load shortlist (${res.status})`);
      const payload = await res.json();
      const papers = payload.papers || [];
      if (!papers.length) throw new Error('Shortlist is empty');
      setImportProgress({ current: 0, total: papers.length, inserted: 0, updated: 0, skipped: 0 });
      const result = await upsertResearchCandidates(papers, {
        defaultStatus: 'approved',
        onProgress: (p) => setImportProgress({ ...p }),
      });
      showSnack(
        `粗筛入库：+${result.inserted} 新 / ${result.updated} 已存在去重`
        + (result.skipped ? ` / ${result.skipped} 跳过` : '')
        + ` · 共 ${papers.length} 条`,
      );
      if (result.errors?.length) showSnack(result.errors.slice(0, 2).join(' · '), 'error');
      await loadLists();
    } catch (err) {
      showSnack(err.message || String(err), 'error');
    } finally {
      setImporting(false);
      setImportProgress(null);
    }
  };

  const runTemplateMatch = async () => {
    setMatching(true);
    try {
      const tplRows = await ensureTemplates();
      if (!tplRows.length) throw new Error('模板库为空，或无管理员权限读取模板');
      const result = matchPapersToTemplates(library, tplRows);
      setMatchOverrides({});
      setMatchDialog(result);
      const n = (result.doiMatches?.length || 0) + (result.titleMatches?.length || 0);
      if (!n && !(result.alreadyLinked?.length) && !(result.conflicts?.length)) {
        showSnack(`未找到可匹配项（模板 ${result.templatesTotal}，含 DOI ${result.templatesWithDoi}）`, 'info');
      }
    } catch (err) {
      showSnack(err.message || String(err), 'error');
    } finally {
      setMatching(false);
    }
  };

  const openLinkDialog = useCallback(async (paper) => {
    setLinkPaper(paper);
    setLinkQuery('');
    try {
      await ensureTemplates();
    } catch (err) {
      showSnack(err.message || String(err), 'error');
    }
  }, [ensureTemplates]);

  const linkSuggestions = useMemo(() => {
    if (!linkPaper) return [];
    return suggestTemplatesForPaper(linkPaper, templates);
  }, [linkPaper, templates]);

  const linkSearchResults = useMemo(() => {
    if (!linkPaper) return [];
    const suggestedIds = new Set(linkSuggestions.map((s) => s.templateId));
    return filterTemplatesByQuery(templates, linkQuery)
      .filter((t) => !suggestedIds.has(t.id));
  }, [linkPaper, templates, linkQuery, linkSuggestions]);

  const applyPaperTemplateLink = async (templateId) => {
    if (!linkPaper?.id || !templateId) return;
    setLinkSaving(true);
    try {
      await updateResearchPaper(linkPaper.id, {
        template_id: templateId,
        template_fit: 'likely',
      });
      setLibrary((prev) => prev.map((p) => (
        p.id === linkPaper.id ? { ...p, template_id: templateId, template_fit: 'likely' } : p
      )));
      showSnack(`已关联模板：${templateId}`);
      setLinkPaper(null);
    } catch (err) {
      showSnack(err.message || String(err), 'error');
    } finally {
      setLinkSaving(false);
    }
  };

  const toggleMatchRow = (paperId, checked) => {
    setMatchOverrides((prev) => ({ ...prev, [paperId]: checked }));
  };

  const applyTemplateMatches = async () => {
    if (!matchDialog) return;
    const rows = selectedMatchRows(matchDialog, matchOverrides);
    if (!rows.length) {
      showSnack('未勾选任何匹配', 'warning');
      return;
    }
    setApplyingMatch(true);
    let ok = 0;
    const errors = [];
    try {
      for (const row of rows) {
        try {
          await updateResearchPaper(row.paperId, {
            template_id: row.templateId,
            template_fit: 'likely',
          });
          ok += 1;
        } catch (err) {
          errors.push(`${row.paperTitle}: ${err.message || err}`);
        }
      }
      showSnack(`已关联 ${ok} 篇论文 ↔ 模板${errors.length ? ` · ${errors.length} 失败` : ''}`);
      if (errors.length) showSnack(errors.slice(0, 2).join(' · '), 'error');
      setMatchDialog(null);
      await loadLists();
    } finally {
      setApplyingMatch(false);
    }
  };

  const onDelete = useCallback(async (paper) => {
    if (!window.confirm(`永久删除？\n\n${paper.title}`)) return;
    try {
      await deleteResearchPaper(paper.id);
      setLibrary((prev) => prev.filter((p) => p.id !== paper.id));
      showSnack(`已删除：${paper.title}`);
    } catch (err) {
      showSnack(err.message, 'error');
    }
  }, []);

  const onFit = useCallback(async (paper, fit) => {
    try {
      await updateResearchPaper(paper.id, { template_fit: fit });
      setLibrary((prev) => prev.map((p) => (p.id === paper.id ? { ...p, template_fit: fit } : p)));
      showSnack(`Fit → ${fit}`);
    } catch (err) {
      showSnack(err.message, 'error');
    }
  }, []);

  const onUnlink = useCallback(async (paper) => {
    if (!window.confirm(`取消与模板的关联？\n\n${paper.title}\n→ ${paper.template_id}`)) return;
    try {
      await updateResearchPaper(paper.id, { template_id: null });
      setLibrary((prev) => prev.map((p) => (p.id === paper.id ? { ...p, template_id: null } : p)));
      showSnack('已取消模板关联');
    } catch (err) {
      showSnack(err.message, 'error');
    }
  }, []);

  const onDraft = useCallback((paper) => setDraftDialog(paper), []);

  const confirmDraft = async () => {
    const paper = draftDialog;
    if (!paper) return;
    // Platform: Worker uses encrypted BYOK via Authorization. Self-host may still pass a local key.
    let apiKey = localStorage.getItem('openaiApiKey') || sessionStorage.getItem('openai_api_key') || '';
    try {
      const { getCredentialStatus } = await import('../../lib/agentApi');
      const status = await getCredentialStatus();
      if (status?.openai?.configured) apiKey = ''; // force server-stored path
      else if (!apiKey) {
        showSnack('请先在 AI & Integrations 中保存 OpenAI / OpenRouter API key', 'error');
        setDraftDialog(null);
        return;
      }
    } catch {
      if (!apiKey) {
        showSnack('请先在 AI & Integrations 中保存 OpenAI / OpenRouter API key', 'error');
        setDraftDialog(null);
        return;
      }
    }
    setDraftingId(paper.id);
    try {
      const { surveyConfig, templateMeta } = await draftTemplateFromPaper(paper, apiKey);
      const saved = await saveTemplateToSupabase({
        name: templateMeta.name,
        description: templateMeta.description,
        author: templateMeta.author,
        year: templateMeta.year,
        category: templateMeta.category,
        tags: templateMeta.tags,
        website: templateMeta.website,
        config: surveyConfig,
        preloadedImages: [],
      });
      const templateId = saved?.template?.id;
      if (templateId) {
        await updateResearchPaper(paper.id, {
          template_id: templateId,
          template_fit: paper.template_fit === 'unlikely' ? 'likely' : (paper.template_fit || 'likely'),
        });
        setLibrary((prev) => prev.map((p) => (
          p.id === paper.id
            ? { ...p, template_id: templateId, template_fit: p.template_fit === 'unlikely' ? 'likely' : (p.template_fit || 'likely') }
            : p
        )));
      }
      showSnack(`未发布模板已保存：${templateId || '(unknown)'}（去模板管理审批）`);
      setDraftDialog(null);
    } catch (err) {
      showSnack(err.message || String(err), 'error');
    } finally {
      setDraftingId(null);
    }
  };

  const busy = listLoading || importing || matching || applyingMatch || linkSaving;

  const matchRowsPreview = useMemo(() => {
    if (!matchDialog) return [];
    return [
      ...(matchDialog.doiMatches || []),
      ...(matchDialog.titleMatches || []),
    ];
  }, [matchDialog]);

  const selectedCount = useMemo(
    () => (matchDialog ? selectedMatchRows(matchDialog, matchOverrides).length : 0),
    [matchDialog, matchOverrides],
  );

  const onLink = useCallback((paper) => { openLinkDialog(paper); }, [openLinkDialog]);

  return (
    <Box>
      <Stack direction="row" spacing={2} sx={{ mb: 1 }} alignItems="center" flexWrap="wrap">
        <Typography variant="h6">论文库</Typography>
        <Chip size="small" label={`共 ${library.length} 篇`} color="primary" variant="outlined" />
        <Chip size="small" label={`已关联模板 ${linkedCount}`} color={linkedCount ? 'success' : 'default'} variant="outlined" />
        <TextField
          size="small"
          placeholder="标题 / DOI / venue / 作者 / 模板ID"
          inputRef={searchRef}
          defaultValue=""
          onKeyDown={(e) => {
            if (e.key === 'Enter') runSearch();
          }}
          sx={{ width: 280 }}
          inputProps={{ autoComplete: 'off' }}
        />
        <Button size="small" variant="contained" startIcon={<Search />} onClick={runSearch} disabled={listLoading}>
          搜索
        </Button>
        {activeFilter ? (
          <Button size="small" startIcon={<Clear />} onClick={clearSearch}>
            清除
          </Button>
        ) : null}
        <Box flex={1} />
        <Button
          size="small"
          variant="contained"
          color="secondary"
          startIcon={matching ? <CircularProgress size={14} color="inherit" /> : <LinkIcon />}
          onClick={runTemplateMatch}
          disabled={busy || !library.length}
        >
          批量匹配模板
        </Button>
        <Button
          size="small"
          variant="outlined"
          startIcon={importing ? <CircularProgress size={14} color="inherit" /> : <UploadFile />}
          onClick={importShortlist}
          disabled={busy}
        >
          导入粗筛进论文库
        </Button>
        <Button
          size="small"
          startIcon={<Refresh />}
          onClick={loadLists}
          disabled={busy}
        >
          刷新
        </Button>
      </Stack>

      <Stack direction="row" spacing={1} alignItems="center" flexWrap="wrap" useFlexGap sx={{ mb: 1 }}>
        <Chip
          size="small"
          label="全部"
          color={linkFilter === 'all' ? 'primary' : 'default'}
          variant={linkFilter === 'all' ? 'filled' : 'outlined'}
          onClick={() => setLinkFilter('all')}
        />
        <Chip
          size="small"
          label={`未关联 ${library.length - linkedCount}`}
          color={linkFilter === 'unlinked' ? 'primary' : 'default'}
          variant={linkFilter === 'unlinked' ? 'filled' : 'outlined'}
          onClick={() => setLinkFilter('unlinked')}
        />
        <Chip
          size="small"
          label={`已关联 ${linkedCount}`}
          color={linkFilter === 'linked' ? 'primary' : 'default'}
          variant={linkFilter === 'linked' ? 'filled' : 'outlined'}
          onClick={() => setLinkFilter('linked')}
        />
      </Stack>

      <Typography variant="caption" color="text.secondary" display="block" sx={{ mb: 1.5 }}>
        论文库自带模板匹配：点行内链接图标可搜索/更换模板；「批量匹配模板」按 DOI / 标题+年自动提案。Fit 标记是否适合做成模板。模板本身按读完论文后手搓进 `public/project_templates/`，不从摘要自动生成。
      </Typography>

      {importing && importProgress && (
        <Alert severity="info" sx={{ mb: 2 }} icon={false}>
          <Typography variant="body2" fontWeight={600} sx={{ mb: 0.75 }}>
            正在导入粗筛…
            {' '}
            {importProgress.total
              ? `${importProgress.current} / ${importProgress.total}`
              : '准备中…'}
            {importProgress.total > 0 && (
              <Typography component="span" variant="caption" color="text.secondary" sx={{ ml: 1 }}>
                +{importProgress.inserted} 新 · {importProgress.updated} 去重
                {importProgress.skipped ? ` · ${importProgress.skipped} 跳过` : ''}
              </Typography>
            )}
          </Typography>
          <LinearProgress
            variant={importProgress.total ? 'determinate' : 'indeterminate'}
            value={importProgress.total
              ? Math.min(100, (100 * importProgress.current) / importProgress.total)
              : 0}
            sx={{ height: 8, borderRadius: 1 }}
          />
          <Typography variant="caption" color="text.secondary" display="block" sx={{ mt: 0.75 }}>
            请保持本页打开。中断后可再导（DOI 去重）。
          </Typography>
        </Alert>
      )}

      {listLoading ? (
        <Box sx={{ display: 'flex', justifyContent: 'center', py: 6 }}>
          <CircularProgress />
        </Box>
      ) : (
        <>
          <Typography variant="subtitle2" fontWeight={700} sx={{ mb: 0.75 }}>
            {activeFilter
              ? `搜索「${activeFilter}」：${filteredLibrary.length} / 共 ${library.length} 篇`
              : `共 ${library.length} 篇`}
          </Typography>
          <PapersTable
            rows={filteredLibrary}
            emptyLabel={activeFilter || linkFilter !== 'all' ? '无匹配结果' : '暂无论文 — 可点「导入粗筛进论文库」'}
            onFit={onFit}
            onDraft={onDraft}
            onDelete={onDelete}
            onUnlink={onUnlink}
            onLink={onLink}
            draftingId={draftingId}
          />
        </>
      )}

      <Dialog open={!!draftDialog} onClose={() => !draftingId && setDraftDialog(null)} maxWidth="sm" fullWidth>
        <DialogTitle>生成未发布问卷模板？</DialogTitle>
        <DialogContent>
          <Typography variant="body2" sx={{ mb: 1 }}>
            使用 BYOK 密钥根据标题/摘要生成草稿（is_approved=false）。
          </Typography>
          <Typography variant="subtitle2">{draftDialog?.title}</Typography>
          <Typography variant="caption" color="text.secondary">
            {draftDialog?.doi || draftDialog?.paper_url || 'No DOI/URL'}
          </Typography>
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setDraftDialog(null)} disabled={!!draftingId}>取消</Button>
          <Button variant="contained" onClick={confirmDraft} disabled={!!draftingId}>
            {draftingId ? '生成中…' : '确认生成'}
          </Button>
        </DialogActions>
      </Dialog>

      <Dialog
        open={!!linkPaper}
        onClose={() => !linkSaving && setLinkPaper(null)}
        maxWidth="sm"
        fullWidth
      >
        <DialogTitle>{linkPaper?.template_id ? '更换关联模板' : '关联已有模板'}</DialogTitle>
        <DialogContent dividers>
          <Typography variant="subtitle2" sx={{ mb: 0.5 }}>{linkPaper?.title}</Typography>
          <Typography variant="caption" color="text.secondary" display="block" sx={{ mb: 1.5 }}>
            {paperDoi(linkPaper) || linkPaper?.paper_url || 'No DOI'}
            {linkPaper?.template_id ? ` · 当前：${linkPaper.template_id}` : ''}
          </Typography>

          {linkSuggestions.length > 0 && (
            <Box sx={{ mb: 2 }}>
              <Typography variant="caption" color="text.secondary" fontWeight={700}>推荐匹配</Typography>
              <Stack spacing={0.75} sx={{ mt: 0.75 }}>
                {linkSuggestions.map((s) => (
                  <Paper key={s.templateId} variant="outlined" sx={{ p: 1 }}>
                    <Stack direction="row" spacing={1} alignItems="center">
                      <Box sx={{ flex: 1, minWidth: 0 }}>
                        <Typography variant="body2" fontWeight={600} noWrap>{s.templateName}</Typography>
                        <Typography variant="caption" color="text.secondary">
                          {CONF_LABEL[s.confidence] || s.confidence} · {s.templateId}
                          {s.templateApproved ? ' · approved' : ' · pending'}
                        </Typography>
                      </Box>
                      <Button
                        size="small"
                        variant="contained"
                        disabled={linkSaving || linkPaper?.template_id === s.templateId}
                        onClick={() => applyPaperTemplateLink(s.templateId)}
                      >
                        {linkPaper?.template_id === s.templateId ? '当前' : '关联'}
                      </Button>
                    </Stack>
                  </Paper>
                ))}
              </Stack>
            </Box>
          )}

          <TextField
            size="small"
            fullWidth
            placeholder="搜索模板 ID / 名称 / DOI"
            value={linkQuery}
            onChange={(e) => setLinkQuery(e.target.value)}
            sx={{ mb: 1 }}
          />
          <Stack spacing={0.75} sx={{ maxHeight: 280, overflow: 'auto' }}>
            {linkSearchResults.length === 0 ? (
              <Typography variant="body2" color="text.secondary">
                {templates.length ? '无搜索结果（可换关键词）' : '正在加载模板库…'}
              </Typography>
            ) : linkSearchResults.map((t) => (
              <Paper key={t.id} variant="outlined" sx={{ p: 1 }}>
                <Stack direction="row" spacing={1} alignItems="center">
                  <Box sx={{ flex: 1, minWidth: 0 }}>
                    <Typography variant="body2" fontWeight={600} noWrap>{t.name}</Typography>
                    <Typography variant="caption" color="text.secondary">
                      {t.id}{t.year ? ` · ${t.year}` : ''}{t.is_approved ? ' · approved' : ' · pending'}
                    </Typography>
                  </Box>
                  <Button
                    size="small"
                    variant="outlined"
                    disabled={linkSaving || linkPaper?.template_id === t.id}
                    onClick={() => applyPaperTemplateLink(t.id)}
                  >
                    {linkPaper?.template_id === t.id ? '当前' : '关联'}
                  </Button>
                </Stack>
              </Paper>
            ))}
          </Stack>
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setLinkPaper(null)} disabled={linkSaving}>关闭</Button>
        </DialogActions>
      </Dialog>

      <Dialog
        open={!!matchDialog}
        onClose={() => !applyingMatch && setMatchDialog(null)}
        maxWidth="md"
        fullWidth
      >
        <DialogTitle>批量匹配已有模板</DialogTitle>
        <DialogContent dividers>
          {matchDialog && (
            <>
              <Typography variant="body2" color="text.secondary" sx={{ mb: 1.5 }}>
                模板共 {matchDialog.templatesTotal}（含 DOI {matchDialog.templatesWithDoi}）。
                DOI 与「标题+年」默认勾选；仅标题匹配需手动勾选。不会覆盖已有 template_id。
              </Typography>
              <Stack direction="row" spacing={1} flexWrap="wrap" useFlexGap sx={{ mb: 1.5 }}>
                <Chip size="small" label={`DOI ${matchDialog.doiMatches?.length || 0}`} color="success" variant="outlined" />
                <Chip size="small" label={`标题候选 ${matchDialog.titleMatches?.length || 0}`} variant="outlined" />
                <Chip size="small" label={`已关联 ${matchDialog.alreadyLinked?.length || 0}`} variant="outlined" />
                <Chip size="small" label={`冲突 ${matchDialog.conflicts?.length || 0}`} color={matchDialog.conflicts?.length ? 'warning' : 'default'} variant="outlined" />
                <Chip size="small" color="primary" label={`将写入 ${selectedCount}`} />
              </Stack>

              {matchRowsPreview.length === 0 ? (
                <Alert severity="info">没有新的可写入匹配。可先给模板填上 paper_url / DOI。</Alert>
              ) : (
                <Table size="small">
                  <TableHead>
                    <TableRow>
                      <TableCell padding="checkbox">选</TableCell>
                      <TableCell>置信</TableCell>
                      <TableCell>论文</TableCell>
                      <TableCell>模板</TableCell>
                    </TableRow>
                  </TableHead>
                  <TableBody>
                    {matchRowsPreview.map((row) => {
                      const checked = Object.prototype.hasOwnProperty.call(matchOverrides, row.paperId)
                        ? !!matchOverrides[row.paperId]
                        : !!row.selected;
                      return (
                        <TableRow key={`${row.paperId}-${row.templateId}`} hover>
                          <TableCell padding="checkbox">
                            <Checkbox
                              size="small"
                              checked={checked}
                              onChange={(e) => toggleMatchRow(row.paperId, e.target.checked)}
                              disabled={applyingMatch}
                            />
                          </TableCell>
                          <TableCell>
                            <Chip size="small" label={CONF_LABEL[row.confidence] || row.confidence} />
                          </TableCell>
                          <TableCell>
                            <Typography variant="body2" fontWeight={600}>{row.paperTitle}</Typography>
                            <Typography variant="caption" color="text.secondary">
                              {row.paperYear || '—'} · {row.paperDoi || 'no DOI'}
                            </Typography>
                          </TableCell>
                          <TableCell>
                            <Typography variant="body2">{row.templateName}</Typography>
                            <Typography variant="caption" color="text.secondary">
                              {row.templateId}
                              {row.templateApproved ? ' · approved' : ' · pending'}
                            </Typography>
                          </TableCell>
                        </TableRow>
                      );
                    })}
                  </TableBody>
                </Table>
              )}

              {!!matchDialog.conflicts?.length && (
                <Alert severity="warning" sx={{ mt: 2 }}>
                  {matchDialog.conflicts.length} 条冲突（论文已关联其他模板），已跳过。例如：
                  {' '}
                  {matchDialog.conflicts.slice(0, 2).map((c) => `${c.paperTitle}→${c.existingTemplateId}`).join('；')}
                </Alert>
              )}
            </>
          )}
        </DialogContent>
        <DialogActions>
          <FormControlLabel
            sx={{ mr: 'auto', ml: 1 }}
            control={(
              <Checkbox
                size="small"
                checked={matchRowsPreview.length > 0 && selectedCount === matchRowsPreview.length}
                indeterminate={selectedCount > 0 && selectedCount < matchRowsPreview.length}
                onChange={(e) => {
                  const next = {};
                  matchRowsPreview.forEach((r) => { next[r.paperId] = e.target.checked; });
                  setMatchOverrides(next);
                }}
                disabled={applyingMatch || !matchRowsPreview.length}
              />
            )}
            label="全选"
          />
          <Button onClick={() => setMatchDialog(null)} disabled={applyingMatch}>取消</Button>
          <Button
            variant="contained"
            onClick={applyTemplateMatches}
            disabled={applyingMatch || selectedCount === 0}
          >
            {applyingMatch ? '写入中…' : `确认关联 ${selectedCount}`}
          </Button>
        </DialogActions>
      </Dialog>

      <Snackbar
        open={snack.open}
        autoHideDuration={4000}
        onClose={() => setSnack((s) => ({ ...s, open: false }))}
        anchorOrigin={{ vertical: 'bottom', horizontal: 'center' }}
      >
        <Alert
          severity={snack.sev}
          variant="filled"
          onClose={() => setSnack((s) => ({ ...s, open: false }))}
          sx={{ width: '100%' }}
        >
          {snack.msg}
        </Alert>
      </Snackbar>
    </Box>
  );
}
