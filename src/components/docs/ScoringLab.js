import React, { useMemo, useState } from 'react';
import { Box, Button, MenuItem, Stack, Table, TableBody, TableCell, TableHead, TableRow, TextField, Typography } from '@mui/material';
import { qScores, trueSkillScores } from '../../lib/paperMethods';

export const LAB_OUTCOMES = [
  { winner: 'A', loser: 'B' }, { winner: 'A', loser: 'C' }, { winner: 'B', loser: 'C' },
  { winner: 'A', loser: 'B' }, { winner: 'C', loser: 'A' }, { winner: 'B', loser: 'C' },
];
export function labScores(outcomes, { tieHandling = 'exclude', runs = 1, minComparisons = 1 } = {}) {
  const q = qScores(outcomes, { minComparisons });
  const ts = new Map(trueSkillScores(outcomes, { tieHandling, runs, seed: 1 }).rows.map(row => [row.imageKey, row]));
  return q.map(row => ({ ...row, ...ts.get(row.imageKey) })).sort((a, b) => a.imageKey.localeCompare(b.imageKey));
}
const fmt = n => Number.isFinite(n) ? n.toFixed(2) : '—';
export default function ScoringLab({ language }) {
  const zh = language === 'zh';
  const [outcomes, setOutcomes] = useState(LAB_OUTCOMES);
  const [tieHandling, setTies] = useState('exclude');
  const [runs, setRuns] = useState(1);
  const [minimum, setMinimum] = useState(1);
  const rows = useMemo(() => labScores(outcomes, { tieHandling, runs, minComparisons: minimum }), [outcomes, tieHandling, runs, minimum]);
  const reset = () => { setOutcomes(LAB_OUTCOMES); setTies('exclude'); setRuns(1); setMinimum(1); };
  const low = Math.min(...rows.map(r => r.mu - r.sigma));
  const high = Math.max(...rows.map(r => r.mu + r.sigma));
  const x = n => 65 + (n - low) / Math.max(high - low, 1) * 420;
  return <Box component="section" id="scoring-lab" sx={{ mt: 4, p: { xs: 2, md: 3 }, border: 1, borderColor: 'divider', bgcolor: 'background.paper', borderRadius: 2, scrollMarginTop: 96 }}>
    <Typography variant="overline" color="primary.main">{zh ? '交互实验台 · 构造数据' : 'INTERACTIVE LAB · SYNTHETIC DATA'}</Typography>
    <Typography component="h2" variant="h5" fontWeight={700} sx={{ mb: 2 }}>{zh ? '同一组选择，两种计分方法' : 'One set of choices, two scoring methods'}</Typography>
    <Typography sx={{ mb: 2, lineHeight: 1.8 }}>{zh ? 'A、B、C 表示三张示例图片。初始顺序为 A＞B、A＞C、B＞C、A＞B、C＞A、B＞C。下面直接调用平台计分函数；没有使用论文数据或保存任何回答。' : 'A, B and C identify three example images. Initial order: A > B, A > C, B > C, A > B, C > A, B > C. This lab calls the platform scoring functions on constructed data. It does not use paper data or save answers.'}</Typography>
    <Stack direction="row" flexWrap="wrap" gap={1} sx={{ mb: 2 }}>
      <Button variant="outlined" onClick={() => setOutcomes(v => [...v, { winner: 'A', loser: 'B' }])}>{zh ? '增加 A 胜 B' : 'Add A beats B'}</Button>
      <Button variant="outlined" onClick={() => setOutcomes(v => [...v, { winner: 'B', loser: 'A' }])}>{zh ? '增加 B 胜 A' : 'Add B beats A'}</Button>
      <Button variant="outlined" onClick={() => setOutcomes(v => [...v, { tie: true, a: 'A', b: 'B' }])}>{zh ? '增加 A／B 平局' : 'Add A/B tie'}</Button>
      <Button onClick={reset}>{zh ? '重置实验' : 'Reset lab'}</Button>
    </Stack>
    <Stack direction={{ xs: 'column', sm: 'row' }} flexWrap="wrap" gap={1.5} sx={{ my: 2 }}>
      <TextField select size="small" label={zh ? 'TrueSkill 平局规则' : 'TrueSkill tie rule'} value={tieHandling} onChange={e => setTies(e.target.value)} sx={{ minWidth: 190 }}>
        <MenuItem value="exclude">{zh ? '排除平局' : 'Exclude ties'}</MenuItem><MenuItem value="draw">{zh ? '视为打平' : 'Treat as draws'}</MenuItem>
      </TextField>
      <TextField select size="small" label={zh ? 'TrueSkill 运行次数' : 'TrueSkill runs'} value={runs} onChange={e => setRuns(Number(e.target.value))} sx={{ minWidth: 180 }}><MenuItem value={1}>1</MenuItem><MenuItem value={20}>20</MenuItem></TextField>
      <TextField select size="small" label={zh ? 'Q-score 最低比较次数' : 'Q-score minimum count'} value={minimum} onChange={e => setMinimum(Number(e.target.value))} sx={{ minWidth: 200 }}><MenuItem value={1}>1</MenuItem><MenuItem value={4}>4</MenuItem><MenuItem value={8}>8</MenuItem></TextField>
    </Stack>
    <Typography role="status" aria-live="polite" variant="body2" sx={{ mb: 1 }}>{zh ? `当前 ${outcomes.length} 次比较。` : `${outcomes.length} comparisons in the current example.`}</Typography>
    <Box sx={{ overflowX: 'auto' }}><Table size="small" aria-label={zh ? 'Q-score 与 TrueSkill 对照' : 'Q-score and TrueSkill comparison'}>
      <TableHead><TableRow>{[zh ? '图片' : 'Image', zh ? '比较次数' : 'Comparisons', 'Q-score', 'TrueSkill μ', 'σ', 'μ − 3σ'].map(h => <TableCell key={h}>{h}</TableCell>)}</TableRow></TableHead>
      <TableBody>{rows.map(row => <TableRow key={row.imageKey}><TableCell>{row.imageKey}</TableCell><TableCell>{row.comparisons}</TableCell><TableCell>{fmt(row.qScore)}</TableCell><TableCell>{fmt(row.mu)}</TableCell><TableCell>{fmt(row.sigma)}</TableCell><TableCell>{fmt(row.conservative)}</TableCell></TableRow>)}</TableBody>
    </Table></Box>
    <Box component="svg" viewBox="0 0 550 185" role="img" aria-label={zh ? 'TrueSkill 均值与一个标准差范围' : 'TrueSkill means and one-sigma ranges'} sx={{ display: 'block', width: '100%', maxWidth: 600, mt: 2, color: 'text.secondary' }}>
      {rows.map((row, i) => <g key={row.imageKey}><text x="15" y={35 + i * 45} fill="currentColor" fontSize="15">{row.imageKey}</text><line x1={x(row.mu - row.sigma)} x2={x(row.mu + row.sigma)} y1={30 + i * 45} y2={30 + i * 45} stroke="currentColor" strokeWidth="3" /><circle cx={x(row.mu)} cy={30 + i * 45} r="6" fill="currentColor" /><text x={x(row.mu)} y={52 + i * 45} textAnchor="middle" fill="currentColor" fontSize="12">μ {fmt(row.mu)}</text></g>)}
      <text x="65" y="174" fill="currentColor" fontSize="12">{fmt(low)}</text><text x="485" y="174" fill="currentColor" textAnchor="end" fontSize="12">{fmt(high)}</text>
    </Box>
    <Typography variant="caption" component="p" color="text.secondary">{zh ? '点为 μ，横线为 μ ± σ；这是模型不确定性的示意，不是置信区间或显著性检验。Q-score 与 μ 的尺度不同，不直接比较数值大小。' : 'Dots show μ; lines show μ ± σ. These model-uncertainty ranges are not confidence intervals or significance tests. Q-score and μ have different scales; their magnitudes are not directly comparable.'}</Typography>
    <Typography variant="body2" sx={{ mt: 2, lineHeight: 1.8 }}>{zh ? '试一试：增加平局，观察 Q-score 改变而“排除平局”的 TrueSkill 保持不变；切换“视为打平”再比较。将最低次数改为 8，可看到“未计分”与零分的区别。' : 'Try adding a tie: Q-score changes while tie-excluding TrueSkill stays the same. Then select “Treat as draws”. Set the minimum count to 8 to see why “unscored” differs from a zero score.'}</Typography>
  </Box>;
}
