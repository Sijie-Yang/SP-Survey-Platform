import React, { useMemo, useState } from 'react';
import {
  Alert, Box, Button, Link, Paper, Stack, Table, TableBody, TableCell, TableHead, TableRow, TextField, Typography,
} from '@mui/material';
import { Download, UploadFile } from '@mui/icons-material';
import { uiPair } from '../../lib/uiLanguages';
import {
  SUBMISSIONS_NEW_FILE_URL,
  SUBMISSIONS_REPO_DIR,
  buildSubmission,
  leaderboard,
  parsePredictionsCsv,
  scoreSubmission,
  submissionFileName,
  taskTemplateCsv,
  validateSubmission,
} from '../../lib/benchHumanTrack';
import { downloadTextFile } from '../../lib/methodsExport';

function readText(file) {
  if (typeof file.text === 'function') return file.text();
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result || ''));
    reader.onerror = () => reject(reader.error);
    reader.readAsText(file);
  });
}

const fmt = (v, d = 3) => (v == null || !Number.isFinite(v) ? '—' : v.toFixed(d));
const MAX_TASK_COLUMNS = 6;

function taskName(task) {
  const attr = task.question?.attribute_label ? ` · ${task.question.attribute_label}` : '';
  return `${task.question?.title || task.question?.name}${attr}`;
}

function metricName(task, L) {
  return task.comparison === 'item_scores' ? L('Kendall τ', 'Kendall τ') : L('Spearman ρ', 'Spearman ρ');
}

function LeaderboardTable({ tasks, rows, L }) {
  const showTasks = tasks.length <= MAX_TASK_COLUMNS;
  return (
    <Box sx={{ overflowX: 'auto' }}>
      <Table size="small" data-testid="human-leaderboard">
        <TableHead>
          <TableRow>
            <TableCell>#</TableCell>
            <TableCell>{L('Model', '模型')}</TableCell>
            <TableCell align="right">{L('Overall', '总分')}</TableCell>
            {showTasks ? tasks.map((t, i) => (
              <TableCell key={t.task_id} align="right" title={taskName(t)}>{`T${i + 1}`}</TableCell>
            )) : <TableCell align="right">{L('Tasks', '任务')}</TableCell>}
            <TableCell>{L('Date', '日期')}</TableCell>
          </TableRow>
        </TableHead>
        <TableBody>
          {rows.map((r, idx) => (
            <TableRow key={`${r.model}-${r.date}-${idx}`}>
              <TableCell>{idx + 1}</TableCell>
              <TableCell>
                <Typography variant="body2" fontWeight={600} sx={{ minWidth: 120 }}>
                  {r.url ? <Link href={r.url} target="_blank" rel="noopener noreferrer">{r.model}</Link> : r.model}
                </Typography>
                {(r.organisation || r.kind === 'silicon') && (
                  <Typography variant="caption" color="text.secondary">
                    {[r.organisation, r.kind === 'silicon' ? L('silicon sample', '硅样本') : ''].filter(Boolean).join(' · ')}
                  </Typography>
                )}
              </TableCell>
              <TableCell align="right" sx={{ fontVariantNumeric: 'tabular-nums', fontWeight: 600 }}>{fmt(r.overall)}</TableCell>
              {showTasks ? tasks.map((t) => (
                <TableCell key={t.task_id} align="right" sx={{ fontVariantNumeric: 'tabular-nums' }}>{fmt(r.per_task[t.task_id]?.headline)}</TableCell>
              )) : <TableCell align="right">{`${r.tasks_scored}/${r.tasks_total}`}</TableCell>}
              <TableCell>{r.date}</TableCell>
            </TableRow>
          ))}
          {!rows.length && (
            <TableRow>
              <TableCell colSpan={4 + (showTasks ? tasks.length : 1)}>
                <Typography variant="body2" color="text.secondary">{L('No submissions yet. Be the first: score your model below.', '还没有提交。可以在下面给你的模型打分，成为第一个。')}</Typography>
              </TableCell>
            </TableRow>
          )}
        </TableBody>
      </Table>
    </Box>
  );
}

function TaskList({ tasks, L }) {
  const downloadJson = (task) => downloadTextFile(`${JSON.stringify(task, null, 2)}\n`, `${task.task_id}.json`);
  return (
    <Stack spacing={1.25}>
      {tasks.map((t, i) => (
        <Box key={t.task_id} data-testid={`human-task-${t.task_id}`} sx={{ p: 1.5, border: 1, borderColor: 'divider', borderRadius: 1 }}>
          <Stack direction={{ xs: 'column', sm: 'row' }} spacing={1} alignItems={{ sm: 'center' }}>
            <Box sx={{ flex: 1, minWidth: 0 }}>
              <Typography variant="body2" fontWeight={600}>{`T${i + 1} · ${taskName(t)}`}</Typography>
              <Typography variant="caption" color="text.secondary" display="block">
                {[
                  t.project?.name,
                  L(`${t.n_items} images`, `${t.n_items} 张图`),
                  L(`${t.n_human} responses`, `${t.n_human} 份回答`),
                  `${L('scored by', '指标')} ${metricName(t, L)}`,
                  `${L('frozen', '冻结于')} ${t.version}`,
                ].filter(Boolean).join(' · ')}
              </Typography>
              <Typography variant="caption" color="text.secondary" sx={{ fontFamily: 'monospace' }}>{t.task_id}</Typography>
              {t.dataset_doi && (
                <Typography variant="caption" display="block">
                  DOI <Link href={`https://doi.org/${t.dataset_doi}`} target="_blank" rel="noopener noreferrer">{t.dataset_doi}</Link>
                </Typography>
              )}
            </Box>
            <Stack direction="row" spacing={1}>
              <Button size="small" startIcon={<Download />} onClick={() => downloadJson(t)}>JSON</Button>
              <Button size="small" startIcon={<Download />} onClick={() => downloadTextFile(taskTemplateCsv(t), `${t.task_id}_template.csv`)}>CSV</Button>
            </Stack>
          </Stack>
        </Box>
      ))}
    </Stack>
  );
}

function ScoreYourModel({ tasks, submissions, L }) {
  const [predictions, setPredictions] = useState(null);
  const [errors, setErrors] = useState([]);
  const [fileLabel, setFileLabel] = useState('');
  const [meta, setMeta] = useState({ model: '', organisation: '', contact: '', url: '' });
  const [saved, setSaved] = useState('');

  const result = useMemo(() => (predictions ? scoreSubmission(tasks, predictions) : null), [tasks, predictions]);
  const preview = useMemo(() => {
    if (!predictions) return null;
    const mine = { ...buildSubmission({ model: meta.model || 'Your model', date: new Date().toISOString(), predictions }), file: '__yours__' };
    const rows = leaderboard(tasks, [...submissions, mine]);
    return { rows, rank: rows.findIndex((r) => r.file === '__yours__') + 1 };
  }, [predictions, tasks, submissions, meta.model]);

  const onFile = async (file) => {
    setSaved('');
    setErrors([]);
    setPredictions(null);
    if (!file) return;
    setFileLabel(file.name);
    const text = await readText(file);
    if (/\.json$/i.test(file.name) || text.trim().startsWith('{')) {
      try {
        const json = JSON.parse(text);
        const problems = validateSubmission(json);
        if (problems.length) { setErrors(problems); return; }
        setPredictions(json.predictions);
        setMeta({ model: json.model || '', organisation: json.organisation || '', contact: json.contact || '', url: json.url || '' });
      } catch (e) {
        setErrors([L('This is not valid JSON.', '不是有效的 JSON。')]);
      }
      return;
    }
    const parsed = parsePredictionsCsv(text, { defaultTaskId: tasks.length === 1 ? tasks[0].task_id : '' });
    setErrors(parsed.errors);
    if (Object.keys(parsed.predictions).length) setPredictions(parsed.predictions);
  };

  const save = () => {
    const sub = buildSubmission({ ...meta, predictions });
    const name = submissionFileName(sub);
    downloadTextFile(`${JSON.stringify(sub, null, 2)}\n`, name);
    setSaved(name);
  };

  return (
    <Box data-testid="score-your-model">
      <Typography variant="body2" color="text.secondary" sx={{ mb: 1.5 }}>
        {L(
          'Download a task CSV, fill the value column with your model\'s score for each image (higher = more of the quality asked about), and upload it here. Several tasks can go in one file with a task_id column. Scoring runs in your browser; nothing is uploaded.',
          '下载任务的 CSV 模板，在 value 列填上模型给每张图的分数（越高表示越符合题目问的那种感受），再上传到这里。多个任务可以放在同一个文件里，用 task_id 列区分。打分在你的浏览器里完成，不会上传任何数据。',
        )}
      </Typography>
      <Button component="label" variant="outlined" startIcon={<UploadFile />}>
        {L('Upload predictions (CSV or JSON)', '上传预测（CSV 或 JSON）')}
        <input hidden type="file" accept=".csv,.json,text/csv,application/json" data-testid="predictions-input" onChange={(e) => onFile(e.target.files?.[0])} />
      </Button>
      {fileLabel && <Typography variant="caption" color="text.secondary" sx={{ ml: 1 }}>{fileLabel}</Typography>}
      {errors.length > 0 && <Alert severity="warning" sx={{ mt: 1.5 }}>{errors.join(' ')}</Alert>}

      {result && (
        <Box sx={{ mt: 2 }}>
          <Typography variant="subtitle1" fontWeight={700} data-testid="your-score">
            {L(`Overall ${fmt(result.overall)} · ${result.tasks_scored} of ${result.tasks_total} tasks scored`, `总分 ${fmt(result.overall)} · ${result.tasks_total} 个任务中有 ${result.tasks_scored} 个得分`)}
          </Typography>
          <Table size="small" sx={{ mb: 2 }}>
            <TableHead>
              <TableRow>
                <TableCell>{L('Task', '任务')}</TableCell>
                <TableCell align="right">{L('Score', '分数')}</TableCell>
                <TableCell align="right">{L('Images matched', '匹配图片')}</TableCell>
              </TableRow>
            </TableHead>
            <TableBody>
              {result.per_task.map((s, i) => (
                <TableRow key={s.task_id}>
                  <TableCell>{`T${i + 1} · ${taskName(tasks[i])}`}</TableCell>
                  <TableCell align="right" sx={{ fontVariantNumeric: 'tabular-nums' }}>{`${fmt(s.headline)} ${s.headline_metric === 'kendall_tau_b' ? 'τ' : 'ρ'}`}</TableCell>
                  <TableCell align="right">{`${s.n_matched}/${s.n_items}`}</TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
          {preview?.rank > 0 && (
            <Typography variant="body2" sx={{ mb: 2 }} data-testid="your-rank">
              {L(`This would place #${preview.rank} of ${preview.rows.length}.`, `这个成绩在榜上排第 ${preview.rank} / ${preview.rows.length}。`)}
            </Typography>
          )}

          <Typography variant="subtitle2" sx={{ mb: 1 }}>{L('Put it on the leaderboard', '提交上榜')}</Typography>
          <Stack direction={{ xs: 'column', sm: 'row' }} spacing={1.5} sx={{ mb: 1.5 }}>
            <TextField size="small" required label={L('Model name', '模型名称')} value={meta.model} onChange={(e) => setMeta({ ...meta, model: e.target.value })} />
            <TextField size="small" label={L('Organisation', '机构')} value={meta.organisation} onChange={(e) => setMeta({ ...meta, organisation: e.target.value })} />
            <TextField size="small" label={L('Paper or code URL', '论文或代码链接')} value={meta.url} onChange={(e) => setMeta({ ...meta, url: e.target.value })} />
          </Stack>
          <Button variant="contained" startIcon={<Download />} disabled={!meta.model.trim() || Boolean(meta.url && !/^https?:\/\//.test(meta.url))} onClick={save}>
            {L('Download submission file', '下载提交文件')}
          </Button>
          {saved && (
            <Alert severity="success" sx={{ mt: 1.5 }}>
              {L(`Saved ${saved}. Add it to `, `已保存 ${saved}。请把它添加到 `)}
              <Link href={`${SUBMISSIONS_NEW_FILE_URL}?filename=${encodeURIComponent(saved)}`} target="_blank" rel="noopener noreferrer">public/bench/submissions</Link>
              {L(' with a pull request, and add the file name to index.json. The leaderboard recomputes every score from the file, so the numbers cannot drift from the data.', '（通过 pull request），并把文件名加进 index.json。榜单会从文件重新计算分数，所以数字不会和数据对不上。')}
            </Alert>
          )}
        </Box>
      )}
    </Box>
  );
}

/** Public SP-Bench track: models vs real people on platform studies. */
export default function HumanAgreementTrack({ tasks, submissions, language }) {
  const L = (en, zh) => uiPair(language, en, zh);
  const rows = useMemo(() => leaderboard(tasks, submissions), [tasks, submissions]);
  const downloadAll = () => downloadTextFile(`${JSON.stringify({ schema: 'sp-bench-human-taskset/1', tasks }, null, 2)}\n`, 'sp-bench-human-tasks.json');

  return (
    <Stack spacing={3}>
      <Box>
        <Typography variant="body1" sx={{ maxWidth: 900, mb: 1 }}>
          {L(
            'Does a model see a street the way people do? Each task is a real SP-Survey study: participants compared or rated images, and the per-image result was frozen. A model gives one number per image and is scored on how well it reproduces the human ranking: Kendall τ for pairwise rankings, Spearman ρ for ratings (1 = same order, 0 = unrelated).',
            '模型看街道的方式和人一样吗？每个任务都来自 SP-Survey 上真实做过的研究：被试比较或打分图片，平台把每张图的结果冻结下来。模型对每张图给一个数，按它复现人类排名的程度打分：成对比较用 Kendall τ，评分题用 Spearman ρ（1 = 顺序一致，0 = 无关）。',
          )}
        </Typography>
        <Typography variant="body2" color="text.secondary" sx={{ maxWidth: 900 }}>
          {L(
            'The overall score is the mean over all tasks, and a missing task counts as 0. Every score is recomputed from public files with deterministic code; no model judges another. Silicon samples are listed for comparison; they help pretest a survey and do not replace people.',
            '总分是所有任务的平均，缺的任务按 0 计。每个分数都用确定性代码从公开文件重新计算，不让模型给模型打分。硅样本列出来作对比，它们用于预测试问卷，不能代替真人。',
          )}
        </Typography>
      </Box>

      <Paper variant="outlined" sx={{ p: 2 }}>
        <Typography variant="h6" fontWeight={700} sx={{ mb: 1 }}>{L('Leaderboard', '排行榜')}</Typography>
        <LeaderboardTable tasks={tasks} rows={rows} L={L} />
      </Paper>

      <Paper variant="outlined" sx={{ p: 2 }}>
        <Stack direction="row" alignItems="center" sx={{ mb: 1.5 }}>
          <Typography variant="h6" fontWeight={700} sx={{ flex: 1 }}>{L(`Tasks (${tasks.length})`, `任务（${tasks.length}）`)}</Typography>
          <Button size="small" startIcon={<Download />} onClick={downloadAll}>{L('All tasks', '全部任务')}</Button>
        </Stack>
        <TaskList tasks={tasks} L={L} />
      </Paper>

      <Paper variant="outlined" sx={{ p: 2 }}>
        <Typography variant="h6" fontWeight={700} sx={{ mb: 1 }}>{L('Score your model', '给你的模型打分')}</Typography>
        <ScoreYourModel tasks={tasks} submissions={submissions} L={L} />
      </Paper>

      <Typography variant="caption" color="text.secondary">
        {L('Submissions are JSON files in ', '提交文件都在 ')}
        <Link href={SUBMISSIONS_REPO_DIR} target="_blank" rel="noopener noreferrer">public/bench/submissions</Link>
        {L('. Task data are published by each study\'s owner under the license shown in the task file.', '。任务数据由各研究的负责人发布，许可见任务文件。')}
      </Typography>
    </Stack>
  );
}
