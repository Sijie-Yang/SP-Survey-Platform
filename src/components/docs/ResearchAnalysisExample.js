import React, { useMemo, useState } from 'react';
import { Box, Button, Stack, Table, TableBody, TableCell, TableHead, TableRow, Typography } from '@mui/material';
import { qScores, trueSkillScores, scaleScores, iccTwoWay, sharesFromOutcomes } from '../../lib/paperMethods';
import { wilsonCI } from '../../lib/stats';
import NasarLikedDemo from './NasarLikedDemo';

const initialVotes = [
  { winner: 'A', loser: 'B' }, { winner: 'A', loser: 'C' }, { winner: 'B', loser: 'C' },
  { winner: 'A', loser: 'B' }, { winner: 'C', loser: 'A' }, { winner: 'B', loser: 'C' },
];
const ratings = [[2, 2, 3], [4, 4, 5], [1, 2, 1], [3, 3, 4]];
export default function ResearchAnalysisExample({ id, language }) {
  const zh = language === 'zh';
  const [votes, setVotes] = useState(initialVotes);
  const thermal = id === '2025-yang-thermal';
  const trueskill = id === '2014-naik-streetscore' || id === '2016-dubey-place';
  const shareStudy = id === '2014-quercia-aesthetic';
  const pairwise = thermal || trueskill || id === '2013-salesses-collaborative' || shareStudy;
  const rows = useMemo(() => thermal
    ? scaleScores(trueSkillScores(votes, { runs: 20, seed: 1 }).rows, 'mu', '0-5')
    : trueskill
      ? scaleScores(trueSkillScores(votes, { runs: 1, seed: 1 }).rows, 'mu', '0-10')
      : qScores(votes, { minComparisons: 1 }), [thermal, trueskill, votes]);
  const shares = useMemo(() => sharesFromOutcomes(votes.map(vote => (
    vote.tie ? { a: vote.a, b: vote.b, tie: true } : { a: vote.winner, b: vote.loser, winner: vote.winner }
  ))).map(row => ({ ...row, ...wilsonCI(row.chosen, row.shown) })), [votes]);
  const agreement = useMemo(() => iccTwoWay(ratings), []);
  const facadeRatings = [[2, 2, 3], [4, 3, 4], [1, 1, 2], [3, 3, 3]];
  return <Box id="worked-example" sx={{ p: { xs: 2, md: 3 }, border: 1, borderColor: 'divider', bgcolor: 'background.paper', borderRadius: 3, my: 3, scrollMarginTop: 90 }}>
    <Typography variant="overline" color="primary.main">{zh ? '算一遍 · 教学数据' : 'WORKED EXAMPLE · SYNTHETIC DATA'}</Typography>
    <Typography component="h3" variant="h6" sx={{ mb: 1 }}>{pairwise ? (zh ? '增加一次选择，看看分数怎样变化' : 'Add a choice and see the scores change') : (zh ? '从原始回答读懂汇总' : 'Read the summary from the raw answers')}</Typography>
    <Typography variant="body2" sx={{ mb: 2 }}>{zh ? '以下数据专为讲解构造，不是论文数据或平台收集的研究结果。' : 'These small examples are constructed for teaching. They are not paper data or collected research results.'}</Typography>
    {pairwise ? <>
      <Typography variant="body2">{zh ? '初始六次选择：A＞B、A＞C、B＞C、A＞B、C＞A、B＞C。A/B/C 是三张示例图片的 ID。' : 'Six initial choices: A > B, A > C, B > C, A > B, C > A, B > C. A/B/C identify three example images.'}</Typography>
      <Stack direction="row" flexWrap="wrap" gap={1} sx={{ my: 2 }}>
        <Button variant="outlined" onClick={() => setVotes(v => [...v, { winner: 'A', loser: 'B' }])}>{zh ? '增加 A 胜 B' : 'Add A beats B'}</Button>
        <Button variant="outlined" onClick={() => setVotes(v => [...v, { winner: 'B', loser: 'A' }])}>{zh ? '增加 B 胜 A' : 'Add B beats A'}</Button>
        {id === '2013-salesses-collaborative' && <Button onClick={() => setVotes(v => [...v, { tie: true, a: 'A', b: 'B' }])}>{zh ? '增加平局' : 'Add a tie'}</Button>}
        <Button onClick={() => setVotes(initialVotes)}>{zh ? '重置示例' : 'Reset example'}</Button>
      </Stack>
      <Box role="status" aria-live="polite"><Typography variant="caption">{zh ? `共 ${votes.length} 次比较；使用平台实际计分函数。` : `${votes.length} comparisons; computed with the platform’s scoring functions.`}</Typography></Box>
      <Box sx={{ overflowX: 'auto' }}><Table size="small" aria-label={zh ? '教学计分结果' : 'Teaching score results'}>
        <TableHead><TableRow>{(shareStudy
          ? [zh ? '图片' : 'Image', zh ? '选中／展示' : 'Chosen / shown', zh ? '选择比例' : 'Choice share', 'Wilson 95%']
          : [zh ? '图片' : 'Image', zh ? '胜／负／平' : 'W / L / T', (thermal || trueskill) ? 'TrueSkill μ' : 'Q-score', thermal ? (zh ? '缩放至 0–5' : 'Scaled 0–5') : trueskill ? (zh ? '缩放至 0–10' : 'Scaled 0–10') : (zh ? '比较次数' : 'Comparisons')]).map(h => <TableCell key={h}>{h}</TableCell>)}</TableRow></TableHead>
        <TableBody>{(shareStudy ? shares : rows).map(row => <TableRow key={row.imageKey}>{shareStudy
          ? <><TableCell>{row.imageKey}</TableCell><TableCell>{row.chosen} / {row.shown}</TableCell><TableCell>{(row.share * 100).toFixed(0)}%</TableCell><TableCell>{(row.low * 100).toFixed(0)}–{(row.high * 100).toFixed(0)}%</TableCell></>
          : <><TableCell>{row.imageKey}</TableCell><TableCell>{row.wins} / {row.losses} / {row.ties}</TableCell><TableCell>{((thermal || trueskill) ? row.mu : row.qScore).toFixed(2)}</TableCell><TableCell>{(thermal || trueskill) ? row.scaled.toFixed(2) : row.comparisons}</TableCell></>}</TableRow>)}</TableBody>
      </Table></Box>
      <Typography variant="caption" component="p" sx={{ mt: 2 }}>{thermal
        ? (zh ? '20 次固定种子顺序、指标内部最小—最大缩放。示例分数不表示真实热舒适。' : '20 seeded orderings and within-indicator min–max scaling. These scores do not indicate actual thermal comfort.')
        : shareStudy
          ? (zh ? '选择比例是被选中次数除以被展示次数，区间用平台的 Wilson 函数。示例比例不是伦敦场景的研究结果。' : 'Choice share is times chosen divided by times shown. Intervals use the platform’s Wilson function. These shares are not results for London scenes.')
          : trueskill
            ? (zh ? '一次运行，并在本示例内部最小—最大缩放到 0–10。示例分数不表示真实的街道安全感。' : 'One run, then min–max scaled to 0–10 inside this example. These scores do not indicate actual perceived safety.')
            : (zh ? '为展示计算，本示例最低比较次数设为 1；正式分析默认值为 4，研究所需覆盖量需另行评估。' : 'For illustration, the minimum count is 1. The analysis default is 4; adequate research coverage requires a separate assessment.')}</Typography>
    </> : id === '2009-ewing-measuring' ? <>
      <Typography variant="body2">{zh ? '只看一个品质：4 段视频由相同的 3 位专家评分，形成完整矩阵。' : 'One quality: four clips rated by the same three experts form a complete matrix.'}</Typography>
      <Box sx={{ overflowX: 'auto' }}><Table size="small" aria-label={zh ? '专家评分教学矩阵' : 'Example expert rating matrix'}><TableHead><TableRow>{['Clip', 'R1', 'R2', 'R3', zh ? '均值' : 'Mean'].map(h => <TableCell key={h}>{h}</TableCell>)}</TableRow></TableHead><TableBody>{ratings.map((row, i) => <TableRow key={i}><TableCell>{i + 1}</TableCell>{row.map((v, j) => <TableCell key={j}>{v}</TableCell>)}<TableCell>{(row.reduce((a, b) => a + b, 0) / row.length).toFixed(2)}</TableCell></TableRow>)}</TableBody></Table></Box>
      <Typography sx={{ mt: 2 }}>ICC(2,1) = {agreement.icc1.toFixed(3)} · ICC(2,k) = {agreement.iccK.toFixed(3)}</Typography>
      <Typography variant="caption">{zh ? '使用平台 ICC 函数计算；分别表示单个评分者与这组评分者平均评分的一致性估计。小示例仅演示读数。' : 'Calculated with the platform ICC function: estimates for a single rating and the average of these raters. This tiny matrix only demonstrates interpretation.'}</Typography>
    </> : id === '2017-liu-machine' ? <>
      <Typography variant="body2">{zh ? '立面品质：4 张图片由相同的 3 位评分者打 1–4 分。街墙连续性另计，不并进这个均值。' : 'Facade quality: four images rated 1–4 by the same three raters. Street-wall continuity is counted separately and is not folded into this mean.'}</Typography>
      <Box sx={{ overflowX: 'auto' }}><Table size="small" aria-label={zh ? '立面评分教学表' : 'Example facade ratings'}><TableHead><TableRow>{[zh ? '图片' : 'Image', 'R1', 'R2', 'R3', zh ? '均值' : 'Mean'].map(h => <TableCell key={h}>{h}</TableCell>)}</TableRow></TableHead><TableBody>{facadeRatings.map((row, i) => <TableRow key={i}><TableCell>{i + 1}</TableCell>{row.map((v, j) => <TableCell key={j}>{v}</TableCell>)}<TableCell>{(row.reduce((a, b) => a + b, 0) / row.length).toFixed(2)}</TableCell></TableRow>)}</TableBody></Table></Box>
      <Typography sx={{ mt: 2 }}>{zh ? '街墙连续：图片 1–3 为是，图片 4 为否，连续比例 3/4。' : 'Street wall continuous: yes for images 1–3, no for image 4, so the continuous share is 3/4.'}</Typography>
      <Typography variant="caption">{zh ? '均值和是／否比例用这份教学表直接算出。它们不是北京的专家标注，也不是论文里的模型误差。' : 'The means and the yes/no share are read directly from this teaching table. They are not the Beijing expert labels or the paper’s model error.'}</Typography>
    </> : id === '1990-nasar-evaluative' ? <NasarLikedDemo language={language} /> : <>
      <Typography variant="body2" sx={{ mb: 2 }}>{zh ? '假设 10 人两道地图题都有明确完成状态：画出区域，或确认“没有区域”。未回答和不熟悉不进入这 10 人。某个网格有 6 人的喜欢区域覆盖、2 人的不喜欢区域覆盖，净值为 0.6 − 0.2 = +0.4。同一个人的重叠区域只计一次。' : 'Suppose 10 people completed both map questions, either by drawing or by confirming “no area”. Unanswered and unfamiliar responses stay outside that 10. Six people’s liked areas cover a cell and two people’s disliked areas cover it: 0.6 − 0.2 = +0.4. Overlapping areas from one person count once.'}</Typography>
      <Stack direction={{ xs: 'column', sm: 'row' }} gap={1.5}>
        {[[6, 2], [4, 4], [0, 0]].map(([liked, disliked], i) => <Box key={i} sx={{ flex: 1, p: 2, bgcolor: i === 0 ? 'action.selected' : 'background.paper', border: 1, borderColor: 'divider', borderRadius: 2 }}>
          <Typography variant="h5">{((liked - disliked) / 10).toFixed(1)}</Typography>
          <Typography variant="body2">{zh ? `${liked} 人喜欢 · ${disliked} 人不喜欢` : `${liked} liked · ${disliked} disliked`}</Typography>
          <Typography variant="caption">{i === 0 ? (zh ? '正评价更多' : 'More positive coverage') : i === 1 ? (zh ? '正负评价抵消' : 'Opposing coverage cancels') : (zh ? '无人标注' : 'No marks')}</Typography>
        </Box>)}
      </Stack>
      <Typography variant="caption" component="p" sx={{ mt: 2 }}>{zh ? '后两格的差值同为零，却有完全不同的含义。结果页把这些格子画在地图上，不逐格打印坐标；当前筛选里只有一组人时，也不会把同一张图再列一遍。' : 'The last two cells both have zero differences but mean different things. The results page paints these cells on the map and does not print a coordinate for each one. It also does not repeat the map when the current filter contains only one group.'}</Typography>
    </>}
  </Box>;
}
