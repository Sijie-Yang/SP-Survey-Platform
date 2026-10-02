import React, { useMemo, useState } from 'react';
import {
  Accordion, AccordionDetails, AccordionSummary, Alert, Box, Button, Chip, FormControl, FormControlLabel,
  InputLabel, MenuItem, Select, Stack, Switch, Table, TableBody, TableCell, TableHead, TableRow, TextField, Typography,
} from '@mui/material';
import { ExpandMore } from '@mui/icons-material';
import { useRegion } from '../../contexts/RegionContext';
import { mediaDisplayName, stimulusUnitLabel } from '../../lib/mediaIdentity';
import { objectsToCsv } from '../../lib/csvUtil';
import { downloadPerceptionFile } from '../../lib/imagePerceptionJoin';
import {
  COVERAGE_THRESHOLDS, aggregateByParam, annotationBaseImage, annotationNotes, choiceRetestKappa, comparisonCounts, coverageSummary,
  evaluativeMap, imageChoiceShares, longFormatRows, pairChoiceShares, pairwiseGroupComparison, pairwiseOutcomes,
  participantGroupMap, perStimulusStats, qScores, raterAgreement, ratingGroupComparison, ratingRetestKappa,
  responseGroups, robustStimulusStats, samePositionParticipants, scaleScores, splitHalfReliability,
  stimulusObservations, thresholdLabels, trueSkillScores, BFI10_KEY,
} from '../../lib/paperMethods';
import { isReverseCoded, pooledQuestions, recommendationsForQuestion } from '../../lib/analysisRecommendation';

const PAIRWISE = new Set(['imagepicker', 'mediapicker']);
const NUMERIC = new Set(['rating', 'imagerating', 'mediarating', 'slidergroup', 'imageslidergroup', 'mediaslidergroup',
  'matrix', 'imagematrix', 'mediamatrix', 'boolean', 'imageboolean', 'mediaboolean', 'number']);
const GROUPABLE = new Set(['radiogroup', 'dropdown', 'boolean', 'rating', 'text']);

const fmt = (v, d = 2) => (v == null || !Number.isFinite(v) ? '—' : Number(v).toFixed(d));
const nameOf = (key) => (String(key).startsWith('[') ? stimulusUnitLabel(key) : mediaDisplayName(key) || key);
const csv = (rows, file) => {
  if (!rows.length) return;
  downloadPerceptionFile(objectsToCsv(Object.keys(rows[0]), rows), file, 'text/csv;charset=utf-8');
};

function flatQuestions(config) {
  const out = [];
  const walk = (els) => (els || []).forEach((e) => { out.push(e); if (e.elements) walk(e.elements); });
  (config?.pages || []).forEach((p) => walk(p.elements));
  return out;
}

function ScoreTable({ rows, columns, limit = 30 }) {
  if (!rows.length) return null;
  return (
    <Box sx={{ overflowX: 'auto', mb: 1 }}>
      <Table size="small">
        <TableHead><TableRow>{columns.map((c) => <TableCell key={c.key}>{c.label}</TableCell>)}</TableRow></TableHead>
        <TableBody>
          {rows.slice(0, limit).map((r, i) => (
            <TableRow key={i}>{columns.map((c) => <TableCell key={c.key} sx={{ maxWidth: 260, overflowWrap: 'anywhere' }}>{c.render ? c.render(r) : r[c.key]}</TableCell>)}</TableRow>
          ))}
        </TableBody>
      </Table>
      {rows.length > limit && <Typography variant="caption">{rows.length - limit} more rows in the CSV export.</Typography>}
    </Box>
  );
}

function useGroupOptions(surveyConfig, responses, zh) {
  return useMemo(() => {
    const opts = [];
    if (Array.isArray(surveyConfig?.conditions) && surveyConfig.conditions.length > 1) opts.push({ id: 'condition', label: zh ? '被试间条件' : 'Condition', groupBy: { type: 'condition' } });
    const params = [...new Set((responses || []).flatMap((r) => Object.keys(r?.survey_metadata?.url_params || {})))];
    params.forEach((p) => opts.push({ id: `url:${p}`, label: `URL: ${p}`, groupBy: { type: 'urlParam', name: p } }));
    const qs = flatQuestions(surveyConfig);
    qs.filter((q) => GROUPABLE.has(q.type) && !q.isAttentionCheck).forEach((q) => opts.push({
      id: `q:${q.name}`, label: q.title || q.name,
      groupBy: q.type === 'rating' ? { type: 'numeric', name: q.name, split: 'median' } : { type: 'question', name: q.name },
    }));
    const bfi = qs.filter((q) => /^personality_\d+$/.test(q.name)).sort((a, b) => Number(a.name.split('_')[1]) - Number(b.name.split('_')[1]));
    if (bfi.length === 10) Object.keys(BFI10_KEY).forEach((trait) => opts.push({ id: `bfi:${trait}`, label: `BFI-10 ${trait} (median split)`, groupBy: { type: 'bfi', trait, items: bfi, split: 'median' } }));
    return opts;
  }, [surveyConfig, responses, zh]);
}

function GroupComparison({ result, zh }) {
  if (!result?.boards?.length) return <Typography variant="caption">{zh ? '没有可分组的回答。' : 'No responses in these groups.'}</Typography>;
  const t = result.test || {};
  return (
    <Box>
      <Stack direction="row" gap={1} flexWrap="wrap" sx={{ mb: 1 }}>
        {result.boards.map((b) => <Chip key={b.group} size="small" color={b.lowCoverage ? 'warning' : 'default'} label={`${b.group}: ${b.participants} ${zh ? '人' : 'participants'}`} />)}
      </Stack>
      {result.correlations.map((c) => (
        <Typography key={`${c.a}-${c.b}`} variant="body2">{`${c.a} vs ${c.b}: Spearman ρ = ${fmt(c.rho)} (${c.n} ${zh ? '张图' : 'images'})`}</Typography>
      ))}
      {t.p != null && (
        <Typography variant="body2">
          {t.kind === 'welch_t' ? `Welch t(${fmt(t.df, 1)}) = ${fmt(t.t)}, p = ${fmt(t.p, 3)}` : `Welch F(${fmt(t.df1, 0)}, ${fmt(t.df2, 1)}) = ${fmt(t.F)}, p = ${fmt(t.p, 3)}`}
        </Typography>
      )}
      <Typography variant="caption" display="block">
        {zh ? '检验对象：每位参与者与总体排名一致的比例（两两比较），或参与者平均评分（评分题）。仅供探索。'
          : 'Tested on participant-level agreement with the pooled ranking (pairwise) or participant mean ratings (ratings). Exploratory.'}
      </Typography>
    </Box>
  );
}

function PairwiseMethods({ question, responses, surveyConfig, zh }) {
  const rec = recommendationsForQuestion(surveyConfig, question.name)[0] || {};
  const defaultMethod = rec.method === 'qscore_pairwise' ? 'qscore' : rec.method === 'choice_share' ? 'share' : 'trueskill';
  const [method, setMethod] = useState(defaultMethod);
  const [tieHandling, setTieHandling] = useState(rec.tieHandling || 'exclude');
  const [runs, setRuns] = useState(rec.runs || 1);
  const [scale, setScale] = useState(rec.scale || 'none');
  const [minComparisons, setMinComparisons] = useState(rec.minPerImage ?? (defaultMethod === 'qscore' ? 4 : 0));
  const [threshold, setThreshold] = useState(rec.threshold || 3);
  const [coverageMin, setCoverageMin] = useState(rec.minPerImage || (defaultMethod === 'qscore' ? COVERAGE_THRESHOLDS.qscore : COVERAGE_THRESHOLDS.trueskill));
  const pool = pooledQuestions(surveyConfig, question.name);
  const [pooled, setPooled] = useState(pool.length > 1);
  const [groupId, setGroupId] = useState('');
  const [split, setSplit] = useState(null);
  const groupOptions = useGroupOptions(surveyConfig, responses, zh);
  const questionsByName = useMemo(() => Object.fromEntries(flatQuestions(surveyConfig).map((q) => [q.name, q])), [surveyConfig]);

  const outcomes = useMemo(() => {
    const names = pooled ? pool : [question.name];
    return names.flatMap((name) => pairwiseOutcomes(responses, name, { reverseCoded: isReverseCoded(surveyConfig, questionsByName[name] || { name }) }));
  }, [responses, pooled, pool, question.name, surveyConfig, questionsByName]);

  const options = useMemo(() => (method === 'qscore' ? { minComparisons } : { tieHandling, runs, seed: 1 }), [method, minComparisons, tieHandling, runs]);
  const scored = useMemo(() => {
    if (method === 'qscore') return qScores(outcomes, options).map((r) => ({ ...r, score: r.qScore }));
    if (method === 'share') {
      const names = pooled ? pool : [question.name];
      const merged = new Map();
      names.forEach((name) => imageChoiceShares(responses, name, { reverseCoded: isReverseCoded(surveyConfig, questionsByName[name] || { name }) }).forEach((r) => {
        const m = merged.get(r.imageKey) || { imageKey: r.imageKey, shown: 0, chosen: 0 };
        m.shown += r.shown; m.chosen += r.chosen; merged.set(r.imageKey, m);
      }));
      return thresholdLabels([...merged.values()].map((r) => ({ ...r, share: r.shown ? r.chosen / r.shown : null, score: r.shown ? r.chosen / r.shown : null })), threshold)
        .sort((a, b) => (b.score ?? -1) - (a.score ?? -1));
    }
    return trueSkillScores(outcomes, options).rows.map((r) => ({ ...r, score: r.mu }));
  }, [method, outcomes, options, responses, pooled, pool, question.name, threshold, surveyConfig, questionsByName]);
  const rows = useMemo(() => (scale === 'none' ? scored : scaleScores(scored, 'score', scale)), [scored, scale]);
  const coverage = useMemo(() => coverageSummary(comparisonCounts(outcomes), Number(coverageMin) || 0), [outcomes, coverageMin]);
  const retest = useMemo(() => choiceRetestKappa(outcomes), [outcomes]);
  const samePos = useMemo(() => samePositionParticipants(outcomes), [outcomes]);
  const pairs = useMemo(() => pairChoiceShares(outcomes), [outcomes]);
  const fixedPairs = pairs.length > 0 && pairs.length <= Math.max(1, outcomes.length / 3);
  const groupResult = useMemo(() => {
    const opt = groupOptions.find((o) => o.id === groupId);
    if (!opt) return null;
    const map = participantGroupMap(responses, responseGroups(responses, opt.groupBy, questionsByName));
    return pairwiseGroupComparison(outcomes, map, { method, options, minPerImage: Number(coverageMin) || 0 });
  }, [groupId, groupOptions, responses, outcomes, method, options, questionsByName, coverageMin]);

  const scoreLabel = method === 'qscore' ? 'Q-score (0–10)' : method === 'share' ? (zh ? '选择比例' : 'Choice share') : 'TrueSkill μ';
  const exportScores = () => csv(rows.map((r) => ({
    image: r.imageKey, score: r.score, scaled: r.scaled ?? '', wins: r.wins ?? '', losses: r.losses ?? '', ties: r.ties ?? '',
    comparisons: r.comparisons ?? r.shown ?? '', mu_sd_across_runs: r.muSd ?? '', sigma: r.sigma ?? '', sufficient: r.sufficient ?? '', label: r.label ?? '',
  })), `${question.name}_${method}_scores.csv`);
  const exportLong = () => csv((pooled ? pool : [question.name]).flatMap((name) => longFormatRows(responses, surveyConfig, name, { reverseCoded: isReverseCoded(surveyConfig, questionsByName[name] || { name }) })), `${question.name}_long_format.csv`);

  return (
    <Stack gap={2}>
      <Stack direction="row" gap={1.5} flexWrap="wrap" alignItems="center">
        <FormControl size="small" sx={{ minWidth: 170 }}>
          <InputLabel>{zh ? '计分方法' : 'Score'}</InputLabel>
          <Select label={zh ? '计分方法' : 'Score'} value={method} onChange={(e) => setMethod(e.target.value)}>
            <MenuItem value="trueskill">TrueSkill</MenuItem>
            <MenuItem value="qscore">Q-score (Salesses 2013)</MenuItem>
            <MenuItem value="share">{zh ? '选择比例' : 'Choice share'}</MenuItem>
          </Select>
        </FormControl>
        {method === 'trueskill' && <>
          <FormControl size="small" sx={{ minWidth: 150 }}>
            <InputLabel>{zh ? '平局' : 'Ties'}</InputLabel>
            <Select label={zh ? '平局' : 'Ties'} value={tieHandling} onChange={(e) => setTieHandling(e.target.value)}>
              <MenuItem value="exclude">{zh ? '排除（默认）' : 'Exclude (default)'}</MenuItem>
              <MenuItem value="draw">{zh ? '视为打平' : 'Treat as draws'}</MenuItem>
            </Select>
          </FormControl>
          <TextField size="small" type="number" label={zh ? '重排次数' : 'Runs'} value={runs} onChange={(e) => setRuns(Math.max(1, Math.min(200, Number(e.target.value) || 1)))} sx={{ width: 100 }} />
        </>}
        {method === 'qscore' && <TextField size="small" type="number" label={zh ? '最少比较次数' : 'Min comparisons'} value={minComparisons} onChange={(e) => setMinComparisons(Math.max(0, Number(e.target.value) || 0))} sx={{ width: 150 }} />}
        {method === 'share' && <TextField size="small" type="number" label={zh ? '标签阈值 k' : 'Label threshold k'} value={threshold} onChange={(e) => setThreshold(Math.max(1, Number(e.target.value) || 1))} sx={{ width: 140 }} />}
        <FormControl size="small" sx={{ minWidth: 120 }}>
          <InputLabel>{zh ? '缩放' : 'Scale'}</InputLabel>
          <Select label={zh ? '缩放' : 'Scale'} value={scale} onChange={(e) => setScale(e.target.value)}>
            <MenuItem value="none">{zh ? '不缩放' : 'None'}</MenuItem>
            <MenuItem value="0-10">0–10</MenuItem><MenuItem value="0-5">0–5</MenuItem><MenuItem value="0-1">0–1</MenuItem>
          </Select>
        </FormControl>
        {pool.length > 1 && <FormControlLabel control={<Switch checked={pooled} onChange={(e) => setPooled(e.target.checked)} />} label={`${zh ? '合并' : 'Pool'} ${pool.join(' + ')}`} />}
      </Stack>
      {isReverseCoded(surveyConfig, question) && <Alert severity="info">{zh ? '本题为反向措辞：被选中的图计为输家。' : 'Reverse-coded wording: the chosen image counts as the loser.'}</Alert>}
      {scale !== 'none' && <Typography variant="caption">{zh ? '最小–最大缩放只相对于当前样本，不能跨研究比较。' : 'Min–max scaling is relative to this sample and not comparable across studies.'}</Typography>}

      <ScoreTable rows={rows} columns={[
        { key: 'rank', label: '#', render: (r) => rows.indexOf(r) + 1 },
        { key: 'imageKey', label: zh ? '图片' : 'Image', render: (r) => nameOf(r.imageKey) },
        { key: 'score', label: scoreLabel, render: (r) => fmt(r.score, method === 'share' ? 3 : 2) },
        ...(scale !== 'none' ? [{ key: 'scaled', label: scale, render: (r) => fmt(r.scaled) }] : []),
        { key: 'n', label: zh ? '比较/出现' : 'Comparisons', render: (r) => r.comparisons ?? r.shown },
        ...(method !== 'share' ? [{ key: 'ties', label: zh ? '平局' : 'Ties', render: (r) => r.ties ?? 0 }] : [{ key: 'label', label: `≥${threshold}`, render: (r) => r.label }]),
        ...(method === 'trueskill' && runs > 1 ? [{ key: 'muSd', label: 'SD(μ)', render: (r) => fmt(r.muSd, 3) }] : []),
        ...(method === 'qscore' ? [{ key: 'sufficient', label: zh ? '足够' : 'Enough', render: (r) => (r.sufficient ? '✓' : '—') }] : []),
      ]} />
      <Stack direction="row" gap={1} flexWrap="wrap">
        <Button size="small" variant="outlined" onClick={exportScores}>{zh ? '导出分数 CSV' : 'Export scores CSV'}</Button>
        <Button size="small" variant="outlined" onClick={exportLong}>{zh ? '导出长表（每次选择一行）' : 'Export long format (one row per choice)'}</Button>
        {fixedPairs && <Button size="small" variant="outlined" onClick={() => csv(pairs.map((p) => ({ group: p.group, first: p.first, second: p.second, first_chosen: p.firstChosen, second_chosen: p.secondChosen, ties: p.ties, share_first: p.share, wilson_low: p.low, wilson_high: p.high })), `${question.name}_pair_shares.csv`)}>{zh ? '导出配对选择比例' : 'Export pair shares'}</Button>}
      </Stack>

      <Box>
        <Typography variant="subtitle2">{zh ? '覆盖度与可靠性' : 'Coverage and reliability'}</Typography>
        <Stack direction="row" gap={1.5} alignItems="center" flexWrap="wrap" sx={{ my: 1 }}>
          <TextField size="small" type="number" label={zh ? '每图最少比较' : 'Min per image'} value={coverageMin} onChange={(e) => setCoverageMin(Number(e.target.value) || 0)} sx={{ width: 140 }} />
          <Typography variant="caption">{zh ? 'Gu 2025 建议：Q-score 22，TrueSkill 29。' : 'Gu 2025: 22 for Q-score, 29 for TrueSkill.'}</Typography>
        </Stack>
        <Typography variant="body2">
          {`${coverage.images} ${zh ? '张图；每图比较次数' : 'images; comparisons per image'} ${coverage.min ?? '—'} / ${fmt(coverage.median, 1)} / ${coverage.max ?? '—'} (min / median / max); `}
          {`${coverage.below} ${zh ? '张低于阈值' : 'below threshold'} (${fmt((coverage.shareBelow || 0) * 100, 0)}%)`}
        </Typography>
        {retest.pairs > 0 && <Typography variant="body2">{`${zh ? '重复配对一致性' : 'Repeated-pair agreement'}: Cohen κ = ${fmt(retest.kappa)} (${retest.pairs})`}</Typography>}
        {samePos.length > 0 && <Typography variant="body2" color="warning.main">{`${samePos.length} ${zh ? '位参与者始终选同一侧（≥5 次）' : 'participant(s) always chose the same side (≥5 trials)'}`}</Typography>}
        <Button size="small" sx={{ mt: 1 }} onClick={() => setSplit(splitHalfReliability(outcomes, { method, options, splits: 100, seed: 1 }))}>{zh ? '计算折半信度（100 次）' : 'Compute split-half reliability (100 splits)'}</Button>
        {split && <Typography variant="body2">{split.mean == null ? (zh ? '参与者太少。' : 'Too few participants.') : `Spearman–Brown ρ = ${fmt(split.mean)} [${fmt(split.low)}, ${fmt(split.high)}] (${split.valid} splits)`}</Typography>}
      </Box>

      {groupOptions.length > 0 && (
        <Box>
          <Typography variant="subtitle2" sx={{ mb: 1 }}>{zh ? '分组比较' : 'Group comparison'}</Typography>
          <FormControl size="small" sx={{ minWidth: 240, mb: 1 }}>
            <InputLabel>{zh ? '分组依据' : 'Group by'}</InputLabel>
            <Select label={zh ? '分组依据' : 'Group by'} value={groupId} onChange={(e) => setGroupId(e.target.value)}>
              <MenuItem value="">{zh ? '不分组' : 'None'}</MenuItem>
              {groupOptions.map((o) => <MenuItem key={o.id} value={o.id}>{o.label}</MenuItem>)}
            </Select>
          </FormControl>
          {groupResult && <GroupComparison result={groupResult} zh={zh} />}
        </Box>
      )}
    </Stack>
  );
}

function NumericMethods({ question, responses, surveyConfig, zh }) {
  const rec = recommendationsForQuestion(surveyConfig, question.name)[0] || {};
  const dims = ['slidergroup', 'imageslidergroup', 'mediaslidergroup'].includes(question.type) ? (question.dimensions || []).map((d) => ({ id: d.id, label: d.label || d.name || d.id })) : [];
  const rows = ['matrix', 'imagematrix', 'mediamatrix'].includes(question.type) ? (question.rows || []).map((r) => (typeof r === 'object' ? { id: r.value, label: r.text || r.value } : { id: r, label: r })) : [];
  const parts = dims.length ? dims : rows;
  const [part, setPart] = useState(parts[0]?.id ?? '');
  const [robust, setRobust] = useState(rec.method === 'robust_median');
  const [madK, setMadK] = useState(rec.madThreshold || 3);
  const [minRatings, setMinRatings] = useState(rec.minPerImage || COVERAGE_THRESHOLDS.likert);
  const qs = useMemo(() => flatQuestions(surveyConfig), [surveyConfig]);
  const raterCandidates = qs.filter((q) => q.type === 'text' && /rater|coder|expert|id/i.test(`${q.name} ${q.title || ''}`));
  const [rater, setRater] = useState(rec.raterQuestion || raterCandidates[0]?.name || '');
  const [groupId, setGroupId] = useState('');
  const groupOptions = useGroupOptions(surveyConfig, responses, zh);
  const questionsByName = useMemo(() => Object.fromEntries(qs.map((q) => [q.name, q])), [qs]);
  const params = useMemo(() => [...new Set((responses || []).flatMap((r) => Object.keys(r?.survey_metadata?.url_params || {})))], [responses]);
  const [param, setParam] = useState(rec.param || '');

  const opts = dims.length ? { dimension: part } : rows.length ? { row: part } : {};
  const obs = useMemo(() => stimulusObservations(responses, question, opts), [responses, question, part]); // eslint-disable-line react-hooks/exhaustive-deps
  const stats = useMemo(() => (robust ? robustStimulusStats(obs, { threshold: madK }) : perStimulusStats(obs)), [obs, robust, madK]);
  const below = stats.filter((s) => (s.n ?? s.nAfter) < minRatings).length;
  const agreement = useMemo(() => {
    const raterOf = rater ? (o) => { const v = o.row?.responses?.[rater]; const x = v && typeof v === 'object' && 'answer' in v ? v.answer : v; return x ? String(x).trim() : null; } : undefined;
    return raterAgreement(obs, { raterOf, categorical: ['boolean', 'imageboolean', 'mediaboolean'].includes(question.type) });
  }, [obs, rater, question.type]);
  const retest = useMemo(() => ratingRetestKappa(obs), [obs]);
  const byParam = useMemo(() => (param ? aggregateByParam(obs, param) : []), [obs, param]);
  const groupResult = useMemo(() => {
    const opt = groupOptions.find((o) => o.id === groupId);
    if (!opt) return null;
    return ratingGroupComparison(obs, participantGroupMap(responses, responseGroups(responses, opt.groupBy, questionsByName)));
  }, [groupId, groupOptions, obs, responses, questionsByName]);

  if (!obs.length) return <Typography variant="caption">{zh ? '没有数值型回答。' : 'No numeric answers.'}</Typography>;
  return (
    <Stack gap={2}>
      <Stack direction="row" gap={1.5} flexWrap="wrap" alignItems="center">
        {parts.length > 0 && (
          <FormControl size="small" sx={{ minWidth: 200 }}>
            <InputLabel>{dims.length ? (zh ? '维度' : 'Dimension') : (zh ? '行' : 'Row')}</InputLabel>
            <Select label={dims.length ? (zh ? '维度' : 'Dimension') : (zh ? '行' : 'Row')} value={part} onChange={(e) => setPart(e.target.value)}>
              {parts.map((p) => <MenuItem key={p.id} value={p.id}>{p.label}</MenuItem>)}
            </Select>
          </FormControl>
        )}
        <FormControlLabel control={<Switch checked={robust} onChange={(e) => setRobust(e.target.checked)} />} label={zh ? '中位数 + MAD 剔除' : 'Median with MAD screening'} />
        {robust && <TextField size="small" type="number" label="k × MAD" value={madK} onChange={(e) => setMadK(Math.max(0.5, Number(e.target.value) || 3))} sx={{ width: 100 }} />}
        <TextField size="small" type="number" label={zh ? '每图最少评分' : 'Min ratings'} value={minRatings} onChange={(e) => setMinRatings(Number(e.target.value) || 0)} sx={{ width: 130 }} />
      </Stack>
      <Typography variant="body2">{`${stats.length} ${zh ? '个刺激物' : 'stimuli'}; ${below} ${zh ? '个低于最少评分数' : 'below the minimum number of ratings'}`}</Typography>
      <ScoreTable rows={stats} columns={robust ? [
        { key: 'stimulus', label: zh ? '刺激物' : 'Stimulus', render: (r) => nameOf(r.stimulus) },
        { key: 'median', label: zh ? '中位数' : 'Median', render: (r) => fmt(r.median) },
        { key: 'nBefore', label: zh ? '剔除前' : 'n before' }, { key: 'nAfter', label: zh ? '剔除后' : 'n after' },
        { key: 'mad', label: 'MAD', render: (r) => fmt(r.mad) },
      ] : [
        { key: 'stimulus', label: zh ? '刺激物' : 'Stimulus', render: (r) => nameOf(r.stimulus) },
        { key: 'mean', label: zh ? '均值' : 'Mean', render: (r) => fmt(r.mean) },
        { key: 'sd', label: 'SD', render: (r) => fmt(r.sd) },
        { key: 'median', label: zh ? '中位数' : 'Median', render: (r) => fmt(r.median) },
        { key: 'n', label: 'n' },
      ]} />
      <Button size="small" variant="outlined" sx={{ alignSelf: 'flex-start' }} onClick={() => csv(stats.map((s) => ({ ...s, stimulus: s.stimulus, name: nameOf(s.stimulus) })), `${question.name}${part ? `_${part}` : ''}_per_stimulus.csv`)}>{zh ? '导出每图统计 CSV' : 'Export per-stimulus CSV'}</Button>

      <Box>
        <Typography variant="subtitle2" sx={{ mb: 1 }}>{zh ? '评分者一致性' : 'Rater agreement'}</Typography>
        <FormControl size="small" sx={{ minWidth: 220, mb: 1 }}>
          <InputLabel>{zh ? '评分者' : 'Rater'}</InputLabel>
          <Select label={zh ? '评分者' : 'Rater'} value={rater} onChange={(e) => setRater(e.target.value)}>
            <MenuItem value="">{zh ? '参与者 ID' : 'Participant ID'}</MenuItem>
            {qs.filter((q) => q.type === 'text').map((q) => <MenuItem key={q.name} value={q.name}>{q.title || q.name}</MenuItem>)}
          </Select>
        </FormControl>
        <Typography variant="body2">
          {agreement.icc
            ? `ICC(2,1) = ${fmt(agreement.icc.icc1)} [${fmt(agreement.icc.icc1Low)}, ${fmt(agreement.icc.icc1High)}]; ICC(2,k) = ${fmt(agreement.icc.iccK)} [${fmt(agreement.icc.iccKLow)}, ${fmt(agreement.icc.iccKHigh)}]; ${agreement.raters} ${zh ? '位评分者' : 'raters'} × ${agreement.stimuli}/${agreement.totalStimuli} ${zh ? '个完整刺激物' : 'complete stimuli'}`
            : agreement.fleissKappa != null ? `Fleiss κ = ${fmt(agreement.fleissKappa)}`
              : (zh ? '需要至少 2 位评分者共同评过至少 2 个刺激物。' : 'Needs at least 2 raters who rated the same 2+ stimuli.')}
        </Typography>
        {agreement.weightedKappa != null && <Typography variant="body2">{`${zh ? '加权' : 'Weighted'} κ = ${fmt(agreement.weightedKappa)}`}</Typography>}
        {retest.pairs > 0 && <Typography variant="body2">{`${zh ? '重测一致性' : 'Test–retest'}: ${zh ? '加权' : 'weighted'} κ = ${fmt(retest.kappa)} (${retest.pairs})`}</Typography>}
      </Box>

      {params.length > 0 && (
        <Box>
          <Typography variant="subtitle2" sx={{ mb: 1 }}>{zh ? '按链接参数汇总' : 'By URL parameter'}</Typography>
          <FormControl size="small" sx={{ minWidth: 160, mb: 1 }}>
            <InputLabel>{zh ? '参数' : 'Parameter'}</InputLabel>
            <Select label={zh ? '参数' : 'Parameter'} value={param} onChange={(e) => setParam(e.target.value)}>
              <MenuItem value="">{zh ? '不汇总' : 'None'}</MenuItem>
              {params.map((p) => <MenuItem key={p} value={p}>{p}</MenuItem>)}
            </Select>
          </FormControl>
          <ScoreTable rows={byParam} columns={[
            { key: 'value', label: param }, { key: 'n', label: 'n' },
            { key: 'mean', label: zh ? '均值' : 'Mean', render: (r) => fmt(r.mean) }, { key: 'sd', label: 'SD', render: (r) => fmt(r.sd) },
            { key: 'ci', label: '95% CI', render: (r) => (r.low == null ? '—' : `[${fmt(r.low)}, ${fmt(r.high)}]`) },
          ]} />
          {byParam.length > 0 && <Button size="small" variant="outlined" onClick={() => csv(byParam, `${question.name}_by_${param}.csv`)}>{zh ? '导出 CSV' : 'Export CSV'}</Button>}
        </Box>
      )}

      {groupOptions.length > 0 && (
        <Box>
          <Typography variant="subtitle2" sx={{ mb: 1 }}>{zh ? '分组比较' : 'Group comparison'}</Typography>
          <FormControl size="small" sx={{ minWidth: 240, mb: 1 }}>
            <InputLabel>{zh ? '分组依据' : 'Group by'}</InputLabel>
            <Select label={zh ? '分组依据' : 'Group by'} value={groupId} onChange={(e) => setGroupId(e.target.value)}>
              <MenuItem value="">{zh ? '不分组' : 'None'}</MenuItem>
              {groupOptions.map((o) => <MenuItem key={o.id} value={o.id}>{o.label}</MenuItem>)}
            </Select>
          </FormControl>
          {groupResult && <GroupComparison result={groupResult} zh={zh} />}
        </Box>
      )}
    </Stack>
  );
}

function AnnotationMethods({ question, responses, surveyConfig, zh }) {
  const rec = recommendationsForQuestion(surveyConfig, question.name).find((r) => r.method === 'evaluative_map') || {};
  const others = flatQuestions(surveyConfig).filter((q) => q.type === 'imageannotation' && q.name !== question.name);
  const [other, setOther] = useState(rec.dislikedQuestion && rec.dislikedQuestion !== question.name ? rec.dislikedQuestion : (rec.likedQuestion && rec.likedQuestion !== question.name ? rec.likedQuestion : others[0]?.name || ''));
  const thisIsLiked = rec.dislikedQuestion ? rec.dislikedQuestion !== question.name : true;
  const grid = 40;
  const map = useMemo(() => (other ? evaluativeMap(responses, thisIsLiked ? question.name : other, thisIsLiked ? other : question.name, { grid }) : null), [responses, other, question.name, thisIsLiked]);
  const notes = useMemo(() => annotationNotes(responses, question.name), [responses, question.name]);
  const base = useMemo(() => question.annotationImageUrl || annotationBaseImage(responses, question.name), [question.annotationImageUrl, question.name, responses]);
  const maxAbs = map ? Math.max(1e-9, ...map.cells.map((c) => Math.abs(c.diff))) : 1;
  return (
    <Stack gap={2}>
      {others.length > 0 ? (
        <>
          <FormControl size="small" sx={{ minWidth: 260 }}>
            <InputLabel>{thisIsLiked ? (zh ? '"不喜欢"标注题' : '"Disliked" question') : (zh ? '"喜欢"标注题' : '"Liked" question')}</InputLabel>
            <Select label="pair" value={other} onChange={(e) => setOther(e.target.value)}>
              {others.map((q) => <MenuItem key={q.name} value={q.name}>{q.title || q.name}</MenuItem>)}
            </Select>
          </FormControl>
          {map && (
            <Box>
              <Typography variant="body2" sx={{ mb: 1 }}>{zh ? `综合评价地图：红色 = 喜欢多于不喜欢，蓝色 = 相反（${map.likedUnits} / ${map.dislikedUnits} 份标注）。` : `Evaluative map: red = more liked than disliked, blue = the reverse (${map.likedUnits} / ${map.dislikedUnits} annotation sets).`}</Typography>
              <Box sx={{ position: 'relative', width: '100%', maxWidth: 640, aspectRatio: '4 / 3', bgcolor: 'grey.100', backgroundImage: base ? `url("${base}")` : undefined, backgroundSize: '100% 100%' }}>
                {map.cells.map((c) => (
                  <Box key={`${c.row}-${c.col}`} sx={{
                    position: 'absolute', left: `${(c.col / grid) * 100}%`, top: `${(c.row / grid) * 100}%`, width: `${100 / grid}%`, height: `${100 / grid}%`,
                    bgcolor: c.diff >= 0 ? 'rgba(211,47,47,1)' : 'rgba(25,118,210,1)', opacity: 0.15 + 0.6 * (Math.abs(c.diff) / maxAbs),
                  }} />
                ))}
              </Box>
              <Button size="small" variant="outlined" sx={{ mt: 1 }} onClick={() => csv(map.cells, `${question.name}_evaluative_map.csv`)}>{zh ? '导出网格 CSV' : 'Export grid CSV'}</Button>
            </Box>
          )}
        </>
      ) : <Typography variant="caption">{zh ? '需要另一道标注题（如"不喜欢"）才能生成综合评价地图。' : 'Add a second annotation question (e.g. "disliked") to build an evaluative map.'}</Typography>}
      {notes.length > 0 && (
        <Box>
          <Typography variant="subtitle2">{zh ? `标注理由（${notes.length}）` : `Annotation notes (${notes.length})`}</Typography>
          {notes.slice(0, 8).map((n, i) => <Typography key={i} variant="body2">{`${n.label ? `[${n.label}] ` : ''}${n.note}`}</Typography>)}
          <Button size="small" variant="outlined" sx={{ mt: 1 }} onClick={() => csv(notes, `${question.name}_notes.csv`)}>{zh ? '导出理由 CSV' : 'Export notes CSV'}</Button>
        </Box>
      )}
    </Stack>
  );
}

/** Opt-in paper methods under each question's analysis (collapsed by default). */
export default function PaperMethodsPanel({ question, allResponses, surveyConfig }) {
  const { language } = useRegion();
  const zh = language === 'zh';
  const type = question?.type;
  const kind = PAIRWISE.has(type) ? 'pairwise' : NUMERIC.has(type) ? 'numeric' : type === 'imageannotation' ? 'annotation' : null;
  if (!kind || !allResponses?.length) return null;
  const hasRec = recommendationsForQuestion(surveyConfig, question.name).length > 0;
  return (
    <Accordion disableGutters variant="outlined" sx={{ mt: 2 }} TransitionProps={{ unmountOnExit: true }}>
      <AccordionSummary expandIcon={<ExpandMore />}>
        <Typography variant="subtitle2">{zh ? '论文方法（可选）' : 'Paper methods (optional)'}</Typography>
        {hasRec && <Chip size="small" color="primary" variant="outlined" label={zh ? '模板推荐' : 'Template recommendation'} sx={{ ml: 1 }} />}
      </AccordionSummary>
      <AccordionDetails>
        {kind === 'pairwise' && <PairwiseMethods question={question} responses={allResponses} surveyConfig={surveyConfig} zh={zh} />}
        {kind === 'numeric' && <NumericMethods question={question} responses={allResponses} surveyConfig={surveyConfig} zh={zh} />}
        {kind === 'annotation' && <AnnotationMethods question={question} responses={allResponses} surveyConfig={surveyConfig} zh={zh} />}
      </AccordionDetails>
    </Accordion>
  );
}
