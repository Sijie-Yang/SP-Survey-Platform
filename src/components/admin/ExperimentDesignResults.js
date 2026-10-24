import React, { useMemo, useState } from 'react';
import {
  Alert, Box, Button, Card, CardContent, Chip, Stack, Table, TableBody, TableCell, TableHead, TableRow, Typography,
} from '@mui/material';
import { isChineseLanguage, uiPair } from '../../lib/uiLanguages';
import { analyseDesign } from '../../lib/designAnalysis';
import { describeDesign, designMethodsText, designTypeName } from '../../lib/experimentDesign';
import { activeDesign } from '../../lib/experimentDesignRuntime';
import { mediaExposureSummary } from '../../lib/exposureStats';

const fmt = (v, d = 2) => (v == null || !Number.isFinite(v) ? '—' : Number(v).toFixed(d));
const pct = (v) => (v == null || !Number.isFinite(v) ? '—' : `${Math.round(v * 100)}%`);
const ci = (lo, hi, f = fmt) => (lo == null || hi == null ? '' : `（${f(lo)} – ${f(hi)}）`);
const short = (k) => String(k ?? '').split('/').pop();
const range = (r) => (r.min === r.max ? String(r.min) : `${r.min}–${r.max}`);

function Mini({ title, children, tone = null }) {
  return (
    <Box sx={{ border: 1, borderColor: tone === 'warn' ? 'warning.main' : 'divider', borderRadius: 1, p: 1.25, minWidth: 0 }}>
      <Typography variant="caption" color="text.secondary" display="block">{title}</Typography>
      <Typography variant="body2" component="div">{children}</Typography>
    </Box>
  );
}

const grid = { display: 'grid', gridTemplateColumns: { xs: '1fr', sm: 'repeat(auto-fit, minmax(240px, 1fr))' }, gap: 1 };

function why(design, q, language) {
  const zh = isChineseLanguage(language);
  if (q.kind === 'choice' && design.type === 'pool_pairs') {
    const k = q.main?.perTrial || 2;
    return zh
      ? `设计是"从图库里挑选"：每张图会和很多不同的图同屏，所以用 Bradley–Terry 模型算每张图的得分（越高越常被选中）${k > 2 ? `；每次 ${k} 选 1，选中的那张算赢了同屏其他 ${k - 1} 张（Luce 选择模型）` : ''}；区间是把参与者重新抽样得到的，同一个人的多次选择不会被当成互相独立。`
      : `The design is "choose from a library": each image appears alongside many others, so a Bradley–Terry model gives every image a score (higher = chosen more often)${k > 2 ? `; with ${k} on screen the chosen image counts as beating the other ${k - 1} (Luce choice model)` : ''}. Intervals come from resampling participants, so one person's choices are not treated as independent.`;
  }
  if (q.kind === 'multi') {
    return zh
      ? '这是多选多：每张图每次出现时要么被勾要么没被勾，所以按图报告"出现时被选的比例"和 Wilson 95% 区间，按比例排名次。'
      : 'This is pick-any: each time an image appears it is either selected or not, so the share of appearances in which it was selected is reported per image with a Wilson 95% interval, ranked by that share.';
  }
  if (q.kind === 'choice' && q.main?.kind === 'slot_share') {
    return zh
      ? `设计是"比较固定的几组图"，每组 ${q.main.slots.length} 张：每组是一次独立的选择，所以按组统计每个位置（${q.main.slots.join('、')}）被选中的比例和 95% 区间。`
      : `The design is "compare fixed sets" of ${q.main.slots.length}: each set is its own choice, so the share choosing each slot (${q.main.slots.join(', ')}) is reported per set with a 95% interval.`;
  }
  if (q.kind === 'choice') {
    const [a, b] = q.main?.slots || ['A', 'B'];
    return zh
      ? `设计是"比较固定的几组图"：每一对是一次独立的比较，所以按对统计 ${b} 被选中的比例和 95% 区间（相对 ${a}）；总体比例先按人算再平均。`
      : `The design is "compare fixed sets": each pair is its own comparison, so the share choosing ${b} (over ${a}) is reported per pair with a 95% interval; the overall share is averaged per person first.`;
  }
  if (q.kind === 'rating' || q.kind === 'yesno') {
    const base = zh
      ? `每张图由不同的人各看一次，所以按图求${q.kind === 'yesno' ? '"是"的比例' : '平均分'}和 95% 区间。`
      : `Each image is seen once by different people, so the ${q.kind === 'yesno' ? 'share answering yes' : 'mean score'} is reported per image with a 95% interval.`;
    if (design.type === 'fixed_pairs' && q.main?.slots) {
      const [a, ...rest] = q.main.slots;
      const diffWord = rest.map((b) => `${b} − ${a}`).join(zh ? '、' : ', ');
      return base + (zh ? `同一个人给一组里的图都打了分，所以再算每组"${diffWord}"的差，按人配对。` : ` The same person rated the images of a set, so the ${diffWord} difference${rest.length > 1 ? 's are' : ' is'} computed per person.`);
    }
    if (design.type === 'fixed_pairs' && design.slotMode === 'one') {
      return base + (zh ? '每人每组只看了一张，所以组内的差异是人与人之间的比较（看哪个版本的人分更高）。' : ' Each person saw one image per set, so differences within a set are between people (who saw which version).');
    }
    return base;
  }
  return zh ? '这类题的答案已按设计记录（导出里有每个试次的对子编号），平台暂不自动分析。' : 'Answers are recorded with the design (each trial\'s unit is in the export); the platform does not analyse this question type automatically yet.';
}

function MainTable({ design, q, language }) {
  const [all, setAll] = useState(false);
  const m = q.main;
  if (!m) return null;
  const rows = m.rows;
  const shown = all ? rows : rows.slice(0, 8);
  const slots = m.slots || [];
  const head = m.kind === 'bt'
    ? [uiPair(language, 'Rank', '名次'), uiPair(language, 'Image', '图'), uiPair(language, 'Score (95% CI)', '得分（95% 区间）'), uiPair(language, 'Chosen / shown', '被选 / 出现')]
    : m.kind === 'select_share'
      ? [uiPair(language, 'Rank', '名次'), uiPair(language, 'Image', '图'), uiPair(language, 'Selected when shown (95% CI)', '出现时被选比例（95% 区间）'), uiPair(language, 'Selected / shown', '被选 / 出现')]
      : m.kind === 'pair_share'
        ? [uiPair(language, 'Pair', '对'), uiPair(language, `${slots[1] || 'B'} chosen (95% CI)`, `${slots[1] || 'B'} 被选比例（95% 区间）`), uiPair(language, 'n', '次数')]
        : m.kind === 'slot_share'
          ? [uiPair(language, 'Set', '组'), ...slots.map((s) => uiPair(language, `${s} chosen`, `${s} 被选`)), uiPair(language, 'n', '次数')]
          : [uiPair(language, 'Image', '图'), uiPair(language, 'Mean (95% CI)', '平均（95% 区间）'), uiPair(language, 'n', '人数')];
  return (
    <Box sx={{ overflowX: 'auto' }}>
      <Table size="small">
        <TableHead><TableRow>{head.map((h) => <TableCell key={h}>{h}</TableCell>)}</TableRow></TableHead>
        <TableBody>
          {shown.map((r) => (
            <TableRow key={r.unit}>
              {m.kind === 'bt' && <>
                <TableCell>{r.rank}</TableCell>
                <TableCell sx={{ fontFamily: 'monospace', fontSize: '0.8rem' }}>{short(r.unit)}</TableCell>
                <TableCell>{fmt(r.score)}{ci(r.low, r.high)}</TableCell>
                <TableCell>{r.wins} / {r.shown}</TableCell>
              </>}
              {m.kind === 'select_share' && <>
                <TableCell>{r.rank}</TableCell>
                <TableCell sx={{ fontFamily: 'monospace', fontSize: '0.8rem' }}>{short(r.unit)}</TableCell>
                <TableCell>{pct(r.share)}{ci(r.low, r.high, pct)}</TableCell>
                <TableCell>{r.selected} / {r.shown}</TableCell>
              </>}
              {m.kind === 'pair_share' && <>
                <TableCell sx={{ fontFamily: 'monospace', fontSize: '0.8rem' }}>{r.label !== r.unit ? `${r.unit} · ${r.label}` : r.unit}<br />{`${slots[0] || 'A'} ${short(r.a)} · ${slots[1] || 'B'} ${short(r.b)}`}</TableCell>
                <TableCell>{pct(r.share)}{ci(r.low, r.high, pct)}</TableCell>
                <TableCell>{r.n}</TableCell>
              </>}
              {m.kind === 'slot_share' && <>
                <TableCell sx={{ fontFamily: 'monospace', fontSize: '0.8rem' }}>{r.label !== r.unit ? `${r.unit} · ${r.label}` : r.unit}<br />{slots.map((s) => `${s} ${short(r[`media_${s}`])}`).join(' · ')}</TableCell>
                {slots.map((s) => <TableCell key={s}>{pct(r.shares[s].share)}{ci(r.shares[s].low, r.shares[s].high, pct)}</TableCell>)}
                <TableCell>{r.n}</TableCell>
              </>}
              {m.kind === 'item_means' && <>
                <TableCell sx={{ fontFamily: 'monospace', fontSize: '0.8rem' }}>{short(r.unit)}</TableCell>
                <TableCell>{q.kind === 'yesno' ? pct(r.mean) : fmt(r.mean)}{ci(r.low, r.high, q.kind === 'yesno' ? pct : fmt)}</TableCell>
                <TableCell>{r.n}</TableCell>
              </>}
            </TableRow>
          ))}
        </TableBody>
      </Table>
      {rows.length > 8 && (
        <Button size="small" onClick={() => setAll(!all)}>
          {all ? uiPair(language, 'Show fewer', '收起') : uiPair(language, `Show all ${rows.length}`, `显示全部 ${rows.length} 个`)}
        </Button>
      )}
    </Box>
  );
}

function QuestionBlock({ design, q, language }) {
  const m = q.main;
  const minis = [];
  if (m?.kind === 'pair_share') {
    const b = m.slots?.[1] || 'B';
    minis.push([uiPair(language, `Overall, ${b} chosen`, `总体 ${b} 被选`), `${pct(m.overall.mean)}${ci(m.overall.low, m.overall.high, pct)} · ${uiPair(language, `${m.overall.n} people`, `${m.overall.n} 人`)}`]);
  }
  if (m?.kind === 'slot_share') {
    minis.push([uiPair(language, 'Overall, chosen', '总体各位置被选'), m.slots.map((s) => `${s} ${pct(m.overallShares[s].share)}`).join(' · ')]);
  }
  if (m?.kind === 'select_share') {
    minis.push([uiPair(language, 'Selected per screen', '每屏平均勾了几张'), `${fmt(m.meanSelected, 1)} · ${uiPair(language, `${m.answered} screens`, `${m.answered} 屏`)}`]);
  }
  if (m?.position) {
    const k = m.position.k || 2;
    const biased = !!m.position.biased;
    const modelled = m.position.model === 'bt';
    const expectedWord = modelled ? uiPair(language, 'expected from the scores', '按得分应为') : uiPair(language, 'expected', '期望');
    const text = k === 2
      ? `${uiPair(language, 'Left chosen', '左侧被选')} ${pct(m.position.share)}${ci(m.position.low, m.position.high, pct)} (${expectedWord} ${pct(m.position.expected)})`
      : `${uiPair(language, 'By position', '按位置')} ${m.position.shares.map((s, i) => `${i + 1}: ${pct(s.share)}`).join(' · ')} (${expectedWord} ${modelled ? m.position.shares.map((s) => pct(s.expected)).join(' · ') : pct(1 / k)})`;
    minis.push([uiPair(language, 'Position bias', '位置偏差'), `${text} ${biased ? uiPair(language, '· people favour a position', '· 有明显偏向') : '✓'}`, biased ? 'warn' : null]);
  }
  if (m?.ties) minis.push([uiPair(language, 'No preference', '无偏好'), `${m.ties}`]);
  (m?.diffs || []).filter((d) => d.n).forEach((d) => minis.push([uiPair(language, `${d.slot} − ${d.vs} rating, all sets`, `所有组的评分差 ${d.slot} − ${d.vs}`), `${fmt(d.mean)}${ci(d.low, d.high)}`]));
  if (q.repeats?.kind === 'agreement') minis.push([uiPair(language, 'Same choice when repeated', '重复时选择一致'), `${pct(q.repeats.share)} · n=${q.repeats.n}`]);
  if (q.repeats?.kind === 'retest') minis.push([uiPair(language, 'Test–retest', '重测一致性'), `r = ${fmt(q.repeats.r)} · ${uiPair(language, 'mean |Δ|', '平均差')} ${fmt(q.repeats.meanAbsDiff)} · n=${q.repeats.n}`]);
  (q.conditions?.contrasts || []).forEach((c) => {
    const isShare = q.kind === 'choice' || q.kind === 'yesno' || q.kind === 'multi';
    minis.push([
      uiPair(language, `${c.label} − ${c.vs}`, `${c.label} − ${c.vs}`),
      `${isShare ? pct(c.diff) : fmt(c.diff)}${ci(c.low, c.high, isShare ? pct : fmt)}${c.d != null ? ` · d = ${fmt(c.d)}` : ''}${c.p != null ? (c.p < 0.001 ? ' · p < 0.001' : ` · p = ${fmt(c.p, 3)}`) : ''} · n ${c.na}/${c.nb}`,
    ]);
  });
  (q.anchors || []).slice(0, 3).forEach((a) => {
    minis.push([uiPair(language, `Anchor ${short(a.unit)}`, `锚点 ${short(a.unit)}`), a.top ? `${short(a.top)} ${pct(a.share)} · n=${a.n}` : `${fmt(a.mean)}${ci(a.low, a.high)} · n=${a.n}`]);
  });
  return (
    <Box sx={{ mt: 2 }}>
      <Typography variant="subtitle2" sx={{ fontWeight: 600 }}>{q.title}</Typography>
      <Box sx={{ borderLeft: 3, borderColor: 'primary.main', pl: 1.5, my: 1 }}>
        <Typography variant="body2"><b>{uiPair(language, 'Why this analysis: ', '为什么用这个分析：')}</b>{why(design, q, language)}</Typography>
      </Box>
      {minis.length > 0 && <Box sx={{ ...grid, mb: 1 }}>{minis.map(([t, v, tone]) => <Mini key={t} title={t} tone={tone}>{v}</Mini>)}</Box>}
      {m && (m.rows?.length ? <MainTable design={design} q={q} language={language} /> : <Alert severity="info">{uiPair(language, 'No answers yet.', '还没有回答。')}</Alert>)}
      {m?.pairRows?.length > 0 && (
        <Typography variant="caption" color="text.secondary">{uiPair(language, 'Per-set rating differences are in the export.', '每组的评分差值在导出文件里。')}</Typography>
      )}
    </Box>
  );
}

/** Results card for a survey with an experiment design: did it run as planned, then each question's main result. */
export default function ExperimentDesignResults({ surveyConfig, responses, language }) {
  const design = useMemo(() => activeDesign(surveyConfig), [surveyConfig]);
  const analysis = useMemo(() => (design ? analyseDesign(design, responses || [], surveyConfig) : null), [design, responses, surveyConfig]);
  const [copied, setCopied] = useState(false);
  if (!design || !analysis) return null;
  const zh = isChineseLanguage(language);
  const ex = analysis.execution;
  const conditions = (surveyConfig?.conditions || []).map((c) => (typeof c === 'string' ? { id: c, label: c } : c));
  const methods = designMethodsText(design, { zh, conditions });
  const unitWord = design.type === 'fixed_pairs' ? (design.units[0] && Object.keys(design.units[0].slots || {}).length > 2 ? uiPair(language, 'set', '组') : uiPair(language, 'pair', '对')) : uiPair(language, 'image', '张图');
  const onPlan = ex.actual.min === ex.planned.min && ex.actual.max === ex.planned.max;
  const copy = async () => {
    try { await navigator.clipboard.writeText(methods); setCopied(true); setTimeout(() => setCopied(false), 1500); } catch { setCopied(false); }
  };
  return (
    <Card variant="outlined" sx={{ mb: 3 }}>
      <CardContent>
        <Stack direction="row" gap={1} alignItems="baseline" flexWrap="wrap" justifyContent="space-between">
          <Typography variant="h6">{uiPair(language, 'Experiment design', '实验设计')}: {designTypeName(design.type, zh)}</Typography>
          <Chip size="small" label={`${design.id} · ${uiPair(language, 'seed', '种子')} ${design.seed}`} />
        </Stack>
        <Typography variant="body2" color="text.secondary" sx={{ mt: 0.5 }}>
          {describeDesign(design, { zh, conditions, questionTitles: Object.fromEntries(analysis.perQuestion.map((q) => [q.name, q.title])) })}
        </Typography>

        <Typography variant="subtitle2" sx={{ fontWeight: 600, mt: 2, mb: 1 }}>{uiPair(language, '1. Did the design run as planned?', '1. 设计是否按计划执行')}</Typography>
        <Box sx={grid}>
          <Mini title={uiPair(language, 'Participants in this design', '按这个设计完成的人')}>
            {uiPair(language, `${ex.participants} people · ${ex.versionsUsed} of ${ex.versionsTotal} versions used`, `${ex.participants} 人 · 用到 ${ex.versionsUsed} / ${ex.versionsTotal} 个版本`)}
            {ex.outsideDesign > 0 && <><br />{uiPair(language, `${ex.outsideDesign} response(s) from before this design are not counted here.`, `另有 ${ex.outsideDesign} 份是在这个设计之前收集的，不计入这里。`)}</>}
          </Mini>
          <Mini title={uiPair(language, `Times each ${unitWord} was seen`, `每${unitWord}被看的次数`)} tone={onPlan ? null : 'warn'}>
            {uiPair(language, 'planned', '计划')} {range(ex.planned)} · {uiPair(language, 'answered', '实际答了')} {range(ex.actual)} {onPlan ? '✓' : ''}
            {!onPlan && ex.short.length > 0 && <><br />{uiPair(language, `${ex.short.length} with unanswered trials (people skipped or left).`, `${ex.short.length} 个有没答完的试次（中途跳过或离开）。`)}</>}
          </Mini>
          <Mini title={uiPair(language, 'How versions were handed out', '版本怎么分配的')} tone={ex.localClaims ? 'warn' : null}>
            {ex.localClaims
              ? uiPair(language, `${ex.localClaims} participant(s) got a random version in the browser because the database function is not installed (run supabase/experiment_design.sql).`, `${ex.localClaims} 人是在浏览器里随机领的版本，因为数据库函数还没装（运行 supabase/experiment_design.sql）。`)
              : uiPair(language, 'Every participant got the version done least often ✓', '每个人都领到当时完成最少的版本 ✓')}
          </Mini>
          {ex.leftRight && (
            <Mini title={uiPair(language, 'Position balance', '位置平衡')}>
              {uiPair(language, `${ex.leftRight.slot} first in ${pct(ex.leftRight.shareAB)} of trials`, `${ex.leftRight.slot} 在最前面占 ${pct(ex.leftRight.shareAB)}`)} {design.position === 'fixed' ? uiPair(language, '(fixed by design)', '（设计固定）') : Math.abs(ex.leftRight.shareAB - 0.5) < 0.05 ? '✓' : ''}
            </Mini>
          )}
          {ex.catches && (
            <Mini title={uiPair(language, 'Catch trials', '检查题')} tone={ex.catches.failedParticipants.length ? 'warn' : null}>
              {uiPair(language, `${pct(ex.catches.share)} answered as expected (${ex.catches.correct}/${ex.catches.trials})`, `${pct(ex.catches.share)} 答对（${ex.catches.correct}/${ex.catches.trials}）`)}
              {ex.catches.failedParticipants.length > 0 && <><br />{uiPair(language, `${ex.catches.failedParticipants.length} participant(s) missed at least one: ${ex.catches.failedParticipants.slice(0, 5).join(', ')}${ex.catches.failedParticipants.length > 5 ? '…' : ''}`, `${ex.catches.failedParticipants.length} 人至少错一道：${ex.catches.failedParticipants.slice(0, 5).join('、')}${ex.catches.failedParticipants.length > 5 ? '…' : ''}`)}</>}
            </Mini>
          )}
        </Box>

        <Typography variant="subtitle2" sx={{ fontWeight: 600, mt: 2 }}>{uiPair(language, '2. Results by question', '2. 各题结果')}</Typography>
        {analysis.perQuestion.map((q) => <QuestionBlock key={q.name} design={design} q={q} language={language} />)}
        {analysis.consistency && (
          <Alert severity="info" sx={{ mt: 2 }}>
            {uiPair(language,
              `Across questions: when someone rated the two images differently, they chose the higher-rated one in ${pct(analysis.consistency.share)} of ${analysis.consistency.n} cases ("${analysis.consistency.choice}" vs "${analysis.consistency.rating}").`,
              `跨题一致性：同一个人给两张图打分不同时，有 ${pct(analysis.consistency.share)} 的情况选了分高的那张（共 ${analysis.consistency.n} 次，"${analysis.consistency.choice}"对照"${analysis.consistency.rating}"）。`)}
          </Alert>
        )}

        <Typography variant="subtitle2" sx={{ fontWeight: 600, mt: 2, mb: 0.5 }}>{uiPair(language, 'Methods text', 'Methods 文字')}</Typography>
        <Typography variant="body2" color="text.secondary">{methods}</Typography>
        <Stack direction="row" gap={1} sx={{ mt: 1 }} alignItems="center" flexWrap="wrap">
          <Button size="small" variant="outlined" onClick={copy}>{copied ? uiPair(language, 'Copied', '已复制') : uiPair(language, 'Copy', '复制')}</Button>
          <Typography variant="caption" color="text.secondary">{uiPair(language, 'The full export includes the design table and every result above (folder experiment_design/).', '完整导出里附有设计表和以上全部结果（experiment_design/ 文件夹）。')}</Typography>
        </Stack>
      </CardContent>
    </Card>
  );
}

/** For questions not in a design: how evenly each file was actually shown. */
export function MediaExposureCard({ questions, responses, surveyConfig, language }) {
  const design = useMemo(() => activeDesign(surveyConfig), [surveyConfig]);
  const rows = useMemo(() => mediaExposureSummary(questions, responses, { skip: new Set(design?.questions || []) }), [questions, responses, design]);
  if (!rows.length) return null;
  return (
    <Card variant="outlined" sx={{ mb: 3 }}>
      <CardContent>
        <Typography variant="h6">{uiPair(language, 'How often each file was shown', '每个文件被看了几次')}</Typography>
        <Typography variant="body2" color="text.secondary" sx={{ mb: 1 }}>
          {uiPair(language,
            'Counts answered trials per file. Uneven counts mean some images rest on few answers; an experiment design (Builder → Experiment design) keeps them equal.',
            '按回答过的试次统计。次数相差大说明有些图只靠很少几个回答；用实验设计（问卷编辑 → 实验设计）可以让次数保持一致。')}
        </Typography>
        <Box sx={{ overflowX: 'auto' }}>
          <Table size="small">
            <TableHead>
              <TableRow>
                <TableCell>{uiPair(language, 'Question', '题目')}</TableCell>
                <TableCell>{uiPair(language, 'Files', '文件数')}</TableCell>
                <TableCell>{uiPair(language, 'Fewest / median / most', '最少 / 中位 / 最多')}</TableCell>
                <TableCell>{uiPair(language, 'Least shown', '最少的几个')}</TableCell>
              </TableRow>
            </TableHead>
            <TableBody>
              {rows.map((r) => (
                <TableRow key={r.name}>
                  <TableCell>{r.title}</TableCell>
                  <TableCell>{r.files}</TableCell>
                  <TableCell>
                    {r.min} / {r.median} / {r.max}
                    {r.uneven && <Chip size="small" color="warning" variant="outlined" sx={{ ml: 1 }} label={uiPair(language, 'uneven', '不均匀')} />}
                  </TableCell>
                  <TableCell sx={{ fontFamily: 'monospace', fontSize: '0.78rem' }}>{r.least.map((x) => `${short(x.name)} (${x.n})`).join(', ')}</TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </Box>
      </CardContent>
    </Card>
  );
}
