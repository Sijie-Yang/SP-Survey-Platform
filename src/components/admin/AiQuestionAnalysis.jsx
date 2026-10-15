/**
 * "生成分析" for a question the platform does not analyse by itself. The
 * Assistant model writes analyze(records, helpers); it runs in a sandbox and
 * the platform's own algorithms draw the result like native analysis. The
 * code is saved with the project and reused for the view and the exports.
 */
import React, { useContext, useEffect, useMemo, useState } from 'react';
import { Alert, Box, Button, Chip, CircularProgress, Collapse, Table, TableBody, TableCell, TableContainer, TableHead, TableRow, TextField, Typography } from '@mui/material';
import { AutoAwesome } from '@mui/icons-material';
import { useRegion } from '../../contexts/RegionContext';
import { isChineseLanguage } from '../../lib/uiLanguages';
import { evaluateAnalysis, generateQuestionAnalysis } from '../../lib/aiQuestionAnalysis';
import { runAnalysisInSandbox } from '../../lib/aiAnalysisSandbox';
import { writeQuestionAnalysis } from '../../lib/agentApi';
import { ImageResolverContext } from './imageResolverContext';
import { DensityHistogramChart, DescriptiveStatsLine, WordFrequencyChart } from './analysisCharts';
import { RANKING_EXTRA_COLUMNS, TrueSkillBoardStack, TrueSkillMuChart, TrueSkillTable } from './trueSkillAnalysisUi';

const COLORS = ['#1976d2', '#2196f3', '#0288d1', '#0097a7', '#00838f', '#388e3c', '#689f38', '#f57c00', '#e64a19', '#7b1fa2'];
const fmt = (v, d = 2) => (v == null || !Number.isFinite(Number(v)) ? '–' : Number(v).toFixed(d));

function baseName(key) {
  const s = String(key || '').split(/[?#]/)[0];
  return s.slice(s.lastIndexOf('/') + 1);
}

/** Look images up by full key, then by file name, so model keys like "IMG1.jpg" find the media. */
function useLenientResolver() {
  const map = useContext(ImageResolverContext);
  return useMemo(() => {
    const byName = new Map();
    if (map && typeof map.forEach === 'function') map.forEach((url, key) => { const name = baseName(key); if (name && !byName.has(name)) byName.set(name, url); });
    // Pages often name an image without its extension ("IMG0395").
    const byStem = new Map();
    byName.forEach((url, name) => { const stem = name.replace(/\.[a-z0-9]+$/i, ''); if (!byStem.has(stem)) byStem.set(stem, url); });
    return { get: (key) => map?.get?.(key) || byName.get(baseName(key)) || byStem.get(baseName(key).replace(/\.[a-z0-9]+$/i, '')) || null };
  }, [map]);
}

function Bars({ items, total, unit = '', showCount = true }) {
  const max = Math.max(...items.map((i) => Math.abs(i.value)), 1e-9);
  return <Box>
    {items.map((item, idx) => <Box key={`${item.label}-${idx}`} sx={{ mb: 1 }}>
      <Box sx={{ display: 'flex', justifyContent: 'space-between', mb: 0.3, gap: 1 }}>
        <Typography variant="body2" noWrap title={item.label} sx={{ maxWidth: '60%' }}>{item.label}</Typography>
        <Typography variant="body2" color="text.secondary">
          {showCount ? item.value : fmt(item.value)}{unit ? ` ${unit}` : ''}{total ? ` (${Math.round(item.value / total * 100)}%)` : ''}{item.extra || ''}
        </Typography>
      </Box>
      <Box sx={{ height: 14, bgcolor: 'grey.100', borderRadius: 1, overflow: 'hidden' }}>
        <Box sx={{ width: `${Math.max(0, item.value) / max * 100}%`, height: '100%', bgcolor: COLORS[idx % COLORS.length] }} />
      </Box>
    </Box>)}
  </Box>;
}

function SimpleTable({ columns, rows, max = 200 }) {
  return <TableContainer sx={{ maxHeight: 420, border: '1px solid', borderColor: 'divider', borderRadius: 1 }}>
    <Table size="small" stickyHeader>
      <TableHead><TableRow>{columns.map((c) => <TableCell key={c} sx={{ fontWeight: 600 }}>{c}</TableCell>)}</TableRow></TableHead>
      <TableBody>
        {rows.slice(0, max).map((row, i) => <TableRow key={i}>{row.map((cell, j) => <TableCell key={j}>{typeof cell === 'number' ? fmt(cell, Number.isInteger(cell) ? 0 : 3) : String(cell ?? '')}</TableCell>)}</TableRow>)}
      </TableBody>
    </Table>
    {rows.length > max && <Typography variant="caption" color="text.secondary" sx={{ p: 1, display: 'block' }}>… {rows.length - max} more rows in the export</Typography>}
  </TableContainer>;
}

function ItemThumb({ item }) {
  const resolver = useContext(ImageResolverContext);
  const url = resolver?.get?.(item);
  return <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, minWidth: 0 }}>
    {url && <Box component="img" src={url} alt={baseName(item)} loading="lazy" sx={{ width: 40, height: 40, objectFit: 'cover', borderRadius: 0.5, flexShrink: 0 }} />}
    <Typography variant="caption" noWrap title={item} sx={{ maxWidth: 240 }}>{baseName(item) || item}</Typography>
  </Box>;
}

function PerItemView({ block, zh, head }) {
  const [showAll, setShowAll] = useState(false);
  const category = block.measure === 'category';
  const list = showAll ? block.items : block.items.slice(0, 15);
  const label = (c) => (block.labels?.[c] ? `${c} · ${block.labels[c]}` : c);
  return <Box sx={{ mb: 3 }}>
    {head}
    <Typography variant="caption" color="text.secondary" sx={{ display: 'block', mb: 1 }}>
      {zh ? `${block.itemCount} 张图 · ${block.raterCount || '?'} 位作答者 · ${block.values.length} 条作答` : `${block.itemCount} images · ${block.raterCount || '?'} raters · ${block.values.length} answers`}
      {block.raterCount >= 2 ? ` · Krippendorff α = ${block.alpha == null ? '–' : fmt(block.alpha, 3)} (${block.alphaText})` : ''}
    </Typography>
    {category && <Box sx={{ mb: 2 }}>
      <Typography variant="body2" sx={{ fontWeight: 600, mb: 1 }}>{zh ? '总体分布' : 'Overall distribution'}</Typography>
      <Bars items={block.overall.map((o) => ({ label: o.label, value: o.count, extra: ` · 95% CI ${fmt(o.low, 1)}–${fmt(o.high, 1)}%` }))} total={block.values.length} />
    </Box>}
    {!category && <DescriptiveStatsLine nums={block.values.map((v) => v.value)} />}
    {!category && block.items.length > 2 && <DensityHistogramChart scores={block.items.map((i) => i.mean)} domainMin={Math.min(...block.items.map((i) => i.mean))} domainMax={Math.max(...block.items.map((i) => i.mean))} title={zh ? '每张图的均值分布' : 'Distribution of per-image means'} xLabel={zh ? '均值' : 'mean'} padB={36} />}
    <TableContainer sx={{ border: '1px solid', borderColor: 'divider', borderRadius: 1 }}>
      <Table size="small">
        <TableHead><TableRow>
          <TableCell sx={{ fontWeight: 600 }}>{zh ? '图片' : 'Image'}</TableCell>
          <TableCell align="right" sx={{ fontWeight: 600 }}>n</TableCell>
          {category ? <>
            <TableCell sx={{ fontWeight: 600 }}>{zh ? '多数答案' : 'Majority'}</TableCell>
            <TableCell align="right" sx={{ fontWeight: 600 }}>{zh ? '一致比例' : 'Share'}</TableCell>
            <TableCell sx={{ fontWeight: 600 }}>{zh ? '各选项' : 'Counts'}</TableCell>
          </> : <>
            <TableCell align="right" sx={{ fontWeight: 600 }}>mean</TableCell>
            <TableCell align="right" sx={{ fontWeight: 600 }}>SD</TableCell>
          </>}
        </TableRow></TableHead>
        <TableBody>
          {list.map((r) => <TableRow key={r.item}>
            <TableCell><ItemThumb item={r.item} /></TableCell>
            <TableCell align="right">{r.n}</TableCell>
            {category ? <>
              <TableCell>{label(r.mode)}</TableCell>
              <TableCell align="right">{Math.round(r.agreement * 100)}%</TableCell>
              <TableCell><Typography variant="caption" color="text.secondary">{block.categories.map((c) => `${c}: ${r.counts[c] || 0}`).join(' · ')}</Typography></TableCell>
            </> : <>
              <TableCell align="right">{fmt(r.mean)}</TableCell>
              <TableCell align="right">{fmt(r.sd)}</TableCell>
            </>}
          </TableRow>)}
        </TableBody>
      </Table>
    </TableContainer>
    {block.items.length > 15 && <Button size="small" sx={{ mt: 0.5 }} onClick={() => setShowAll((v) => !v)}>
      {showAll ? (zh ? '收起' : 'Show fewer') : (zh ? `显示全部 ${block.items.length} 张` : `Show all ${block.items.length}`)}
    </Button>}
  </Box>;
}

function BlockView({ block, zh }) {
  const title = block.title || '';
  const head = <>
    {title && <Typography variant="subtitle2" sx={{ fontWeight: 700, mb: 0.5 }}>{title}</Typography>}
    {block.note && <Typography variant="caption" color="text.secondary" sx={{ display: 'block', mb: 1 }}>{block.note}</Typography>}
  </>;
  if (block.type === 'per_item') return <PerItemView block={block} zh={zh} head={head} />;
  if (block.type === 'pairwise' || block.type === 'ranking') {
    const ranking = block.type === 'ranking';
    const borda = new Map((block.table?.rows || []).map((row) => [`${row[0]}|${row[2]}`, { borda: row[9], avgRank: row[10] }]));
    return <Box sx={{ mb: 3 }}>
      {head}
      <Typography variant="caption" color="text.secondary" sx={{ display: 'block', mb: 1 }}>
        {zh ? `${block.matchCount} 次两两比较 · TrueSkill（平台算法）` : `${block.matchCount} pairwise comparisons · TrueSkill (platform algorithm)`}
        {ranking && block.kendall ? ` · Kendall W = ${block.kendall.w == null ? '–' : fmt(block.kendall.w, 3)} (${block.kendall.interpretation})` : ''}
      </Typography>
      <TrueSkillBoardStack boards={block.boards} renderBoard={(board) => {
        const rankings = ranking ? board.rankings.map((r) => ({ ...r, ...(borda.get(`${board.label || ''}|${r.imageKey}`) || {}) })) : board.rankings;
        return <Box>
          <TrueSkillMuChart rankings={rankings} />
          <TrueSkillTable rankings={rankings} title={zh ? 'TrueSkill 排序' : 'TrueSkill ranking'} columns={ranking ? [...TrueSkillTableColumns(), ...RANKING_EXTRA_COLUMNS.filter((c) => ['avgRank', 'borda'].includes(c.id))] : undefined} />
        </Box>;
      }} />
    </Box>;
  }
  if (block.type === 'choice') {
    const items = block.table.rows.map((row) => ({ label: row[0], value: row[1], extra: ` · 95% CI ${fmt(row[3], 1)}–${fmt(row[4], 1)}%` }));
    return <Box sx={{ mb: 3 }}>{head}
      <Typography variant="caption" color="text.secondary" sx={{ display: 'block', mb: 1 }}>n={block.n}</Typography>
      <Bars items={items} total={block.n} />
    </Box>;
  }
  if (block.type === 'rating') {
    if (block.series.length === 1) {
      const nums = block.series[0].values;
      const min = block.min ?? Math.min(...nums);
      const max = block.max ?? Math.max(...nums);
      return <Box sx={{ mb: 3 }}>{head}
        <DescriptiveStatsLine nums={nums} />
        {max > min && <DensityHistogramChart scores={nums} domainMin={min} domainMax={max} title={title || 'Distribution'} xLabel={title || 'value'} padB={36} />}
      </Box>;
    }
    const items = block.table.rows.map((row) => ({ label: row[0], value: row[2] ?? 0, extra: ` · SD ${fmt(row[3])} · n=${row[1]}` }));
    return <Box sx={{ mb: 3 }}>{head}<Bars items={items} showCount={false} /></Box>;
  }
  if (block.type === 'text') {
    return <Box sx={{ mb: 3 }}>{head}
      <Typography variant="caption" color="text.secondary" sx={{ display: 'block', mb: 1 }}>
        n={block.lengths.n} · {zh ? '平均长度' : 'mean length'} {fmt(block.lengths.mean, 0)}
      </Typography>
      <WordFrequencyChart words={block.words.slice(0, 20)} totalResponses={block.values.length} />
    </Box>;
  }
  if (block.type === 'bar') return <Box sx={{ mb: 3 }}>{head}<Bars items={block.items} unit={block.unit} showCount={false} /></Box>;
  if (block.type === 'table') return <Box sx={{ mb: 3 }}>{head}<SimpleTable columns={block.columns} rows={block.rows} /></Box>;
  if (block.type === 'note') return <Typography variant="body2" color="text.secondary" sx={{ mb: 2 }}>{block.text}</Typography>;
  return null;
}

function TrueSkillTableColumns() {
  return [
    { id: 'mu', label: 'μ', align: 'right' },
    { id: 'muStd5', label: 'Relative μ (0–5)', align: 'right' },
    { id: 'sigma', label: 'σ', align: 'right' },
    { id: 'games', label: 'Games', align: 'right' },
  ];
}

export function AiAnalysisBlocks({ blocks }) {
  const { language } = useRegion();
  const zh = isChineseLanguage(language);
  const resolver = useLenientResolver();
  return <ImageResolverContext.Provider value={resolver}>
    {(blocks || []).map((block, i) => <BlockView key={i} block={block} zh={zh} />)}
  </ImageResolverContext.Provider>;
}

/**
 * records: buildAnalysisRecords(...) for this question.
 * saved: the stored analysis or null. onSave(entry|null) persists it.
 */
export default function AiQuestionAnalysis({ question, records, otherQuestions = [], saved, onSave, children }) {
  const { language } = useRegion();
  const zh = isChineseLanguage(language);
  const [state, setState] = useState({ status: saved ? 'running' : 'idle', blocks: [], error: '' });
  const [busy, setBusy] = useState(false);
  const [notes, setNotes] = useState(saved?.instructions || '');
  const [showCode, setShowCode] = useState(false);
  const [editing, setEditing] = useState(false);
  const [failedCode, setFailedCode] = useState('');

  // Re-run the saved code whenever the records change (filters, new responses).
  useEffect(() => {
    if (!saved?.code) {
      setState({ status: 'idle', blocks: [], error: '' });
      return undefined;
    }
    let cancelled = false;
    setState((prev) => ({ ...prev, status: 'running' }));
    evaluateAnalysis(saved.code, records, runAnalysisInSandbox).then((result) => {
      if (cancelled) return;
      setState(result.ok ? { status: 'done', blocks: result.blocks, error: '' } : { status: 'error', blocks: [], error: result.error });
    });
    return () => { cancelled = true; };
  }, [saved?.code, records]);

  const generate = async () => {
    setBusy(true);
    setFailedCode('');
    setState({ status: 'running', blocks: [], error: '' });
    try {
      const result = await generateQuestionAnalysis({
        question,
        records,
        otherQuestions,
        instructions: notes.trim(),
        request: (body) => writeQuestionAnalysis(body),
        runner: runAnalysisInSandbox,
      });
      if (!result.ok) {
        setFailedCode(result.code || '');
        setState({ status: 'error', blocks: [], error: result.error });
        return;
      }
      await onSave(result.saved);
      setEditing(false);
      setState({ status: 'done', blocks: result.blocks, error: '' });
    } catch (err) {
      setState({ status: 'error', blocks: [], error: err?.message || String(err) });
    } finally {
      setBusy(false);
    }
  };

  const remove = async () => {
    setBusy(true);
    try {
      await onSave(null);
      setNotes('');
    } catch (err) {
      setState((prev) => ({ ...prev, error: err?.message || String(err) }));
    } finally {
      setBusy(false);
    }
  };

  const notesField = <TextField size="small" fullWidth multiline minRows={1} maxRows={4} value={notes} disabled={busy}
    onChange={(e) => setNotes(e.target.value)}
    placeholder={zh ? '补充说明（可选），例如：左右两张图选一张，按“更安全”排序；忽略练习题' : 'Notes (optional), e.g. "pick one of two images, rank by safety; skip practice trials"'}
    sx={{ mb: 1 }} />;

  if (!saved && !busy && state.status !== 'error') {
    return <Box data-testid="ai-analysis-empty">
      <Box sx={{ p: 1.5, mb: 2, border: '1px dashed', borderColor: 'primary.light', borderRadius: 1, bgcolor: 'background.paper' }}>
        <Typography variant="body2" sx={{ mb: 1 }}>
          {zh
            ? `平台不认识这道题的格式。点“生成分析”，助手模型会读题目和 ${records.length} 条记录里的几条，写一段分析代码，在隔离环境里跑；TrueSkill、均值和置信区间等统计用平台自己的算法。生成后会保存，结果页和导出都会用它。`
            : `The platform does not know this question's format. "Generate analysis" has the Assistant model read the question and a few of the ${records.length} records and write analysis code, which runs in a sandbox; TrueSkill, means and confidence intervals use the platform's own algorithms. It is saved and used here and in exports.`}
        </Typography>
        {notesField}
        <Button size="small" variant="contained" startIcon={<AutoAwesome />} onClick={generate} disabled={!records.length} data-testid="ai-analysis-generate">
          {zh ? '生成分析' : 'Generate analysis'}
        </Button>
      </Box>
      {children}
    </Box>;
  }

  return <Box data-testid="ai-analysis">
    <Box sx={{ display: 'flex', alignItems: 'center', flexWrap: 'wrap', gap: 1, mb: 1.5 }}>
      <Chip size="small" color="secondary" variant="outlined" icon={<AutoAwesome />} label={zh ? 'AI 生成的分析' : 'AI-written analysis'} />
      <Typography variant="caption" color="text.secondary" sx={{ flex: 1, minWidth: 200 }}>
        {zh ? '题型和字段由模型推断，请核对代码；统计是平台算法。' : 'The question type and fields were inferred by the model, so check the code; the statistics are the platform\'s.'}
        {saved?.model ? ` · ${saved.model}` : ''}
      </Typography>
      {(saved?.code || failedCode) && <Button size="small" onClick={() => setShowCode((v) => !v)}>{showCode ? (zh ? '收起代码' : 'Hide code') : (zh ? '查看代码' : 'View code')}</Button>}
      {saved && <Button size="small" onClick={() => setEditing((v) => !v)} disabled={busy}>{zh ? '重新生成' : 'Regenerate'}</Button>}
      {saved && <Button size="small" color="error" onClick={remove} disabled={busy}>{zh ? '删除分析' : 'Remove'}</Button>}
    </Box>
    <Collapse in={editing || (!saved && state.status === 'error')}>
      <Box sx={{ mb: 2 }}>
        {notesField}
        <Button size="small" variant="contained" startIcon={<AutoAwesome />} onClick={generate} disabled={busy || !records.length}>
          {saved ? (zh ? '按说明重新生成' : 'Regenerate with these notes') : (zh ? '再生成一次' : 'Generate again')}
        </Button>
      </Box>
    </Collapse>
    <Collapse in={showCode}>
      <Box component="pre" sx={{ m: 0, mb: 2, p: 1, maxHeight: 360, overflow: 'auto', fontSize: 12, bgcolor: 'grey.50', border: '1px solid', borderColor: 'divider', borderRadius: 1, whiteSpace: 'pre-wrap' }}>
        {saved?.code || failedCode}
      </Box>
    </Collapse>
    {state.status === 'running' && <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, mb: 2 }}>
      <CircularProgress size={18} />
      <Typography variant="body2" color="text.secondary">
        {busy ? (zh ? '模型正在写分析代码，并在全部记录上试运行…' : 'The model is writing the analysis and trying it on every record…') : (zh ? '正在运行分析…' : 'Running the analysis…')}
      </Typography>
    </Box>}
    {state.status === 'error' && <Alert severity="warning" sx={{ mb: 2 }}>
      {zh ? `分析没有跑通（已自动让模型修过一次）：${state.error}。可以在说明里写清答案在哪个字段、表示什么，再生成一次。` : `The analysis did not run (the model already had one automatic fix): ${state.error}. Say in the notes where the answer is and what it means, then generate again.`}
    </Alert>}
    {state.status === 'done' && <AiAnalysisBlocks blocks={state.blocks} />}
    {children}
  </Box>;
}
