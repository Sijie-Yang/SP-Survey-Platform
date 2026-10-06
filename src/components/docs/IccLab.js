import React, { useMemo, useState } from 'react';
import { Box, Button, Stack, Table, TableBody, TableCell, TableHead, TableRow, Typography } from '@mui/material';
import { iccTwoWay } from '../../lib/paperMethods';

export const ICC_LAB_MATRIX = [[2, 2, 3], [4, 4, 5], [1, 2, 1], [3, 3, 4]];
const fmt = (n) => Number.isFinite(n) ? n.toFixed(3) : '—';
const interval = (low, high) => `[${fmt(low)}, ${fmt(high)}]`;

export default function IccLab({ language }) {
  const zh = language === 'zh';
  const [matrix, setMatrix] = useState(ICC_LAB_MATRIX);
  const agreement = useMemo(() => iccTwoWay(matrix), [matrix]);
  const raise = () => setMatrix((rows) => rows.map((row, i) => i === 0 ? row.map((value, j) => j === 2 ? Math.min(5, value + 1) : value) : row));
  return <Box component="section" id="scoring-lab" sx={{ mt: 4, p: { xs: 2, md: 3 }, border: 1, borderColor: 'divider', bgcolor: 'background.paper', borderRadius: 2, scrollMarginTop: 96 }}>
    <Typography variant="overline" color="primary.main">{zh ? '交互实验台 · 构造数据' : 'INTERACTIVE LAB · SYNTHETIC DATA'}</Typography>
    <Typography component="h2" variant="h5" fontWeight={700} sx={{ mb: 2 }}>{zh ? '同一张评分矩阵，两个 ICC' : 'One rating matrix, two ICC coefficients'}</Typography>
    <Typography sx={{ mb: 2, lineHeight: 1.8 }}>{zh ? '四段示例视频、三位评分者、一个品质。下面直接调用平台的 ICC 函数，没有使用论文数据，也不会保存回答。' : 'Four example clips, three raters and one quality. This lab calls the platform ICC function. It does not use paper data or save answers.'}</Typography>
    <Stack direction="row" flexWrap="wrap" gap={1} sx={{ mb: 2 }}>
      <Button variant="outlined" onClick={raise}>{zh ? '把视频 1、评分者 3 的分数加 1' : 'Raise clip 1, rater 3 by 1'}</Button>
      <Button onClick={() => setMatrix(ICC_LAB_MATRIX)}>{zh ? '重置实验' : 'Reset lab'}</Button>
    </Stack>
    <Box sx={{ overflowX: 'auto' }}><Table size="small" aria-label={zh ? 'ICC 教学矩阵' : 'ICC teaching matrix'}>
      <TableHead><TableRow>{[zh ? '视频' : 'Clip', 'R1', 'R2', 'R3'].map((header) => <TableCell key={header}>{header}</TableCell>)}</TableRow></TableHead>
      <TableBody>{matrix.map((row, i) => <TableRow key={i}><TableCell>{i + 1}</TableCell>{row.map((value, j) => <TableCell key={j}>{value}</TableCell>)}</TableRow>)}</TableBody>
    </Table></Box>
    <Typography role="status" aria-live="polite" sx={{ mt: 2 }}>ICC(2,1) = {fmt(agreement?.icc1)} {interval(agreement?.icc1Low, agreement?.icc1High)} · ICC(2,k) = {fmt(agreement?.iccK)} {interval(agreement?.iccKLow, agreement?.iccKHigh)}</Typography>
    <Typography variant="caption" component="p" color="text.secondary" sx={{ mt: 1 }}>{zh ? `${agreement?.n || 0} 个刺激材料 × ${agreement?.k || 0} 位评分者。ICC(2,1) 估计一位评分者的绝对一致性，ICC(2,k) 估计这 k 位评分者平均分的绝对一致性。方括号是平台给出的 95% 区间。` : `${agreement?.n || 0} stimuli × ${agreement?.k || 0} raters. ICC(2,1) estimates absolute agreement for one rater; ICC(2,k) estimates it for the average of these k raters. Brackets are the platform’s 95% intervals.`}</Typography>
  </Box>;
}
