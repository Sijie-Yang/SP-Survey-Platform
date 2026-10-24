import React, { useMemo, useState } from 'react';
import {
  Alert, Autocomplete, Box, Button, ButtonBase, Checkbox, FormControlLabel, Radio, RadioGroup, Stack,
  Table, TableBody, TableCell, TableHead, TableRow, TextField, Typography,
} from '@mui/material';
import { useRegion } from '../../contexts/RegionContext';
import { isChineseLanguage, uiPair } from '../../lib/uiLanguages';
import {
  buildVersions, computeDesignId, describeDesign, designMethodsText, designSizing, designTypeName,
  normalizeDesign, parsePairsText, plannedExposures, questionCanFollowDesign, surveyQuestions, validateDesign,
} from '../../lib/experimentDesign';
import { newSeed } from '../../lib/designRandom';
import { getDirectChildMedia, getEligibleMediaSets, getRecursiveMedia, listAllKnownFolders, normalizeMediaEntry } from '../../lib/mediaUtils';
import { resolveMediaFolderTags } from '../../lib/surveyMediaInjection';
import MediaFolderScopeSelect from './MediaFolderScopeSelect';

const GOALS = [
  {
    type: 'rate',
    zh: ['给很多图打分', '一个图库，每人只看其中一部分并打分。例如街景安全感 1–7 分。', '和普通随机抽图的区别：每张图被看的次数一样多（你定几次就几次），不会有的图 9 次、有的 1 次。'],
    en: ['Rate many images', 'A library of images; each person rates part of it. E.g. street safety 1–7.', 'Unlike plain random draws, every image is seen the same number of times (you choose how many).'],
  },
  {
    type: 'pool_pairs',
    zh: ['从图库里两两比较', '每次从图库配一对让人选，最后排出每张图的名次。例如 Place Pulse。', '和普通随机配对的区别：每张图出场次数一样多，结果直接给出名次和区间。'],
    en: ['Pairwise comparison from a library', 'Each trial pairs two library images; the result ranks every image. E.g. Place Pulse.', 'Unlike plain random pairing, every image appears equally often, and Results gives a ranking with intervals.'],
  },
  {
    type: 'fixed_pairs',
    zh: ['比较固定的几对图', '你事先定好哪两张一对，例如改造前/后。同一对下可以问好几道题。', '和"分组"模式的区别：几道题共用同一批对子，左右各占正好一半，结果按对给出 B 比 A 好多少。'],
    en: ['Compare fixed pairs', 'You decide which two images form a pair, e.g. before/after. Several questions can follow the same pair.', 'Unlike set mode, several questions share the same pairs, each side is shown exactly half the time, and Results gives B vs A per pair.'],
  },
];

const keyOf = (entry) => normalizeMediaEntry(entry)?.media_id;

function NumberField({ id, label, value, onChange, min = 1, max = 100000, helperText }) {
  const [text, setText] = useState(String(value));
  React.useEffect(() => { setText(String(value)); }, [value]);
  return (
    <TextField
      id={id} size="small" type="number" label={label} value={text} helperText={helperText}
      inputProps={{ min, max }}
      onChange={(e) => {
        setText(e.target.value);
        const n = parseInt(e.target.value, 10);
        if (Number.isFinite(n) && n >= min && n <= max) onChange(n);
      }}
      sx={{ flex: '1 1 180px' }}
    />
  );
}

/** Project-level experiment design: who sees which media, decided before anyone starts. */
export default function ExperimentDesignPanel({ config, onChange, currentProject }) {
  const { language } = useRegion();
  const zh = isChineseLanguage(language);
  const raw = config?.experimentDesign || null;
  const pool = useMemo(() => currentProject?.preloadedImages || [], [currentProject?.preloadedImages]);
  const folderTags = useMemo(() => resolveMediaFolderTags(currentProject, config), [currentProject, config]);
  const folders = useMemo(() => listAllKnownFolders(pool, folderTags, null, currentProject?.imageDatasetConfig?.mediaFolders || []), [pool, folderTags, currentProject]);
  const questions = useMemo(() => surveyQuestions(config), [config]);
  const followable = questions.filter(questionCanFollowDesign);
  const conditions = Array.isArray(config?.conditions) ? config.conditions : [];
  const [pairsText, setPairsText] = useState('');
  const [copied, setCopied] = useState(false);

  const save = (patch) => {
    const next = { ...(raw || {}), ...patch };
    if (!next.seed) next.seed = newSeed();
    const normalized = normalizeDesign({ ...next, enabled: true });
    next.id = normalized ? computeDesignId(normalized) : null;
    onChange('experimentDesign', next);
  };
  const turnOff = () => onChange('experimentDesign', raw ? { ...raw, enabled: false } : undefined);

  const unitsFromFolders = (picked) => {
    const scope = picked?.length ? picked : [''];
    const seen = new Set();
    const keys = [];
    scope.forEach((folder) => getRecursiveMedia(pool, folder).forEach((e) => {
      const k = keyOf(e);
      if (k && !seen.has(k)) { seen.add(k); keys.push(k); }
    }));
    return keys;
  };
  // Every folder that holds exactly two images is one pair (A = first by file name).
  const pairsFromSets = () => {
    const seen = new Set();
    const sets = [
      ...getEligibleMediaSets(pool, 2, folderTags, {}),
      ...folders.map((folder) => ({ folder, members: getDirectChildMedia(pool, folder) })).filter((s) => s.members.length === 2),
    ];
    return sets.filter((set) => set.folder && !seen.has(set.folder) && seen.add(set.folder)).map((set) => ({
      id: set.folder.split('/').pop() || set.folder,
      a: keyOf(set.members[0]),
      b: keyOf(set.members[1]),
      label: set.folder,
    }));
  };

  const chooseGoal = (type) => {
    const base = { enabled: true, type, perPerson: raw?.perPerson || 10, target: raw?.target || 10, sizing: raw?.sizing || 'target', people: raw?.people || 100, repeats: raw?.repeats || 0, questions: (raw?.questions || []).filter((n) => followable.some((q) => q.name === n)), anchors: [] };
    if (type === 'fixed_pairs') save({ ...base, units: raw?.type === 'fixed_pairs' ? raw.units : pairsFromSets(), sourceFolders: [] });
    else save({ ...base, units: raw?.type && raw.type !== 'fixed_pairs' ? raw.units : unitsFromFolders(raw?.sourceFolders || []), sourceFolders: raw?.sourceFolders || [] });
  };

  const design = useMemo(() => {
    const d = normalizeDesign(raw);
    return d ? { ...d, id: d.id || computeDesignId(d) } : null;
  }, [raw]);
  const poolKeys = useMemo(() => new Set(pool.flatMap((e) => { const n = normalizeMediaEntry(e); return n ? [n.media_id, n.key, n.name] : []; }).filter(Boolean)), [pool]);
  const check = useMemo(() => (design ? validateDesign(design, { poolKeys, questions }) : null), [design, poolKeys, questions]);
  const sizing = design ? designSizing(design) : null;
  const preview = useMemo(() => (design && check?.ok ? buildVersions(design, Math.min(5, sizing.versions)) : []), [design, check, sizing]);
  const exposure = useMemo(() => {
    if (!design || !check?.ok || sizing.versions > 5000) return null;
    const counts = [...plannedExposures(design, sizing.versions).values()];
    return counts.length ? { min: Math.min(...counts), max: Math.max(...counts) } : null;
  }, [design, check, sizing]);
  const titles = Object.fromEntries(questions.map((q) => [q.name, q.title || q.name]));
  const sentence = design ? describeDesign(design, { zh, questionTitles: titles, conditions }) : '';
  const methods = design ? designMethodsText(design, { zh, conditions }) : '';
  const newInLibrary = design && design.type !== 'fixed_pairs'
    ? unitsFromFolders(design.sourceFolders).filter((k) => !design.units.includes(k)).length
    : 0;
  const unitWord = design?.type === 'fixed_pairs' ? uiPair(language, 'pairs', '对') : uiPair(language, 'images', '张图');
  const label = (k) => String(k).split('/').pop();

  const copyMethods = async () => {
    try {
      await navigator.clipboard.writeText(methods);
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch {
      setCopied(false);
    }
  };

  return (
    <Stack gap={2}>
      <Typography variant="body2" color="text.secondary">
        {uiPair(language,
          'Decide before publishing who sees which media. The platform splits the stimuli into versions so every image or pair is seen about equally often, and Results analyses the data the same way. For a quick test or a small library you can skip this and let each question draw its own media.',
          '发布前先定好谁看哪些图。平台把刺激分成若干版本，保证每张图或每对被看的次数基本一样，结果页也按同一个设计来分析。只是试一下或者图不多，不用设计也可以，每道题各自随机抽图就够了。')}
      </Typography>

      <Box component="section" aria-label={uiPair(language, 'What do you want to do?', '你要做什么？')}>
        <Typography variant="subtitle2" sx={{ fontWeight: 600, mb: 1 }}>{uiPair(language, '1. What do you want to do?', '1. 你要做什么？')}</Typography>
        <Box sx={{ display: 'grid', gridTemplateColumns: { xs: '1fr', sm: 'repeat(3, 1fr)' }, gap: 1 }}>
          {GOALS.map((g) => {
            const active = design?.type === g.type;
            const [name, hint, versus] = zh ? g.zh : g.en;
            return (
              <ButtonBase
                key={g.type} id={`design-goal-${g.type}`} aria-pressed={active} onClick={() => chooseGoal(g.type)}
                sx={{ display: 'block', textAlign: 'left', p: 1.5, border: 1, borderRadius: 1, borderColor: active ? 'primary.main' : 'divider', bgcolor: active ? 'action.selected' : 'transparent' }}
              >
                <Typography variant="body2" sx={{ fontWeight: 600 }}>{name}</Typography>
                <Typography variant="caption" color="text.secondary" component="p">{hint}</Typography>
                <Typography variant="caption" color="text.secondary" component="p" sx={{ mt: 0.5, fontStyle: 'italic' }}>{versus}</Typography>
              </ButtonBase>
            );
          })}
        </Box>
        {design && (
          <Button size="small" sx={{ mt: 1 }} onClick={turnOff}>
            {uiPair(language, 'Turn off the design (each question draws its own media again)', '不用设计（每道题恢复各自抽图）')}
          </Button>
        )}
      </Box>

      {design && (
        <>
          <Box component="section">
            <Typography variant="subtitle2" sx={{ fontWeight: 600, mb: 1 }}>{uiPair(language, '2. Settings', '2. 设置')}</Typography>
            <Stack gap={1.5}>
              {design.type !== 'fixed_pairs' ? (
                <>
                  <MediaFolderScopeSelect
                    folders={folders} value={design.sourceFolders}
                    onChange={(picked) => save({ sourceFolders: picked, units: unitsFromFolders(picked), anchors: [] })}
                    allLabel={uiPair(language, 'All media', '全部媒体')}
                    helperText={uiPair(language, `${design.units.length} images in the design.`, `设计里共 ${design.units.length} 张图。`)}
                  />
                  {newInLibrary > 0 && (
                    <Alert severity="info" action={<Button size="small" onClick={() => save({ units: unitsFromFolders(design.sourceFolders) })}>{uiPair(language, 'Add them', '加进设计')}</Button>}>
                      {uiPair(language, `${newInLibrary} new file(s) in these folders are not in the design yet.`, `这些文件夹里有 ${newInLibrary} 个新文件还不在设计里。`)}
                    </Alert>
                  )}
                </>
              ) : (
                <>
                  <Typography variant="body2">
                    {uiPair(language, `${design.units.length} pairs in the design.`, `设计里共 ${design.units.length} 对。`)}
                  </Typography>
                  <Stack direction="row" gap={1} flexWrap="wrap">
                    <Button size="small" variant="outlined" onClick={() => save({ units: pairsFromSets(), anchors: [] })}>
                      {uiPair(language, 'Read pairs from folders with exactly 2 images', '读取只装 2 张图的文件夹（一个文件夹 = 一对）')}
                    </Button>
                  </Stack>
                  <TextField
                    id="design-pairs-text" size="small" multiline minRows={3} value={pairsText}
                    onChange={(e) => setPairsText(e.target.value)}
                    label={uiPair(language, 'Or paste a pairs table', '或粘贴对子表')}
                    placeholder={'pair_id, a, b, label\nP01, before_01.jpg, after_01.jpg, Main St'}
                    helperText={uiPair(language, 'One pair per line: id, image A, image B, optional label. File names as in the media library.', '每行一对：编号、图 A、图 B、可选说明。文件名与媒体库一致。')}
                  />
                  <Box>
                    <Button size="small" variant="contained" disabled={!pairsText.trim()} onClick={() => {
                      const { units } = parsePairsText(pairsText);
                      if (units.length) save({ units, anchors: [] });
                    }}
                    >
                      {uiPair(language, 'Use this table', '使用这张表')}
                    </Button>
                  </Box>
                </>
              )}
              <Stack direction="row" gap={1.5} flexWrap="wrap" alignItems="flex-start">
                <NumberField
                  id="design-per-person"
                  label={design.type === 'pool_pairs' ? uiPair(language, 'Comparisons per person', '每人比较几次') : design.type === 'fixed_pairs' ? uiPair(language, 'Pairs per person', '每人看几对') : uiPair(language, 'Images per person', '每人看几张')}
                  value={design.perPerson} max={200} onChange={(n) => save({ perPerson: n })}
                />
                <Box sx={{ flex: '2 1 280px' }}>
                  <RadioGroup row value={design.sizing} onChange={(e) => save({ sizing: e.target.value })}>
                    <FormControlLabel value="target" control={<Radio size="small" />} label={uiPair(language, 'I know how often each should be seen', '我知道每个要被看几次')} />
                    <FormControlLabel value="people" control={<Radio size="small" />} label={uiPair(language, 'I know how many people I will get', '我知道能招多少人')} />
                  </RadioGroup>
                  {design.sizing === 'target' ? (
                    <NumberField id="design-target" label={uiPair(language, `Times each ${design.type === 'fixed_pairs' ? 'pair' : 'image'} is seen (at least)`, `每${design.type === 'fixed_pairs' ? '对' : '张图'}至少被看几次`)} value={design.target} onChange={(n) => save({ target: n })} />
                  ) : (
                    <NumberField id="design-people" label={uiPair(language, 'Completed participants', '完成的人数')} value={design.people} onChange={(n) => save({ people: n })} />
                  )}
                </Box>
              </Stack>
              <Stack direction="row" gap={1.5} flexWrap="wrap">
                <Autocomplete
                  multiple size="small" sx={{ flex: '2 1 280px' }} id="design-anchors"
                  options={design.units.map((u) => (typeof u === 'string' ? u : u.id))}
                  value={design.anchors}
                  getOptionLabel={label}
                  onChange={(_, next) => save({ anchors: next })}
                  renderInput={(params) => (
                    <TextField {...params} label={uiPair(language, 'Anchors: shown to everyone (optional)', '锚点：所有人都看（可选）')}
                      helperText={uiPair(language, 'Calibrate raters and compare with models.', '用来校准评分者，也可用于人机对比。')} />
                  )}
                />
                <NumberField id="design-repeats" min={0} max={20} label={uiPair(language, 'Repeat at the end (optional)', '最后重复几个（可选）')} value={design.repeats} onChange={(n) => save({ repeats: n })} helperText={uiPair(language, 'For test–retest agreement.', '用来算重测一致性。')} />
              </Stack>
              <Box>
                <Typography variant="body2" sx={{ mb: 0.5 }}>
                  {uiPair(language, 'Questions that follow this design (their own media settings are replaced):', '跟随这个设计的题（它们自己的抽图设置会被设计替代）：')}
                </Typography>
                {followable.length ? (
                  <Stack direction="row" flexWrap="wrap" columnGap={2}>
                    {followable.map((q) => (
                      <FormControlLabel
                        key={q.name}
                        control={<Checkbox size="small" id={`design-q-${q.name}`} checked={design.questions.includes(q.name)}
                          onChange={(e) => save({ questions: e.target.checked ? [...design.questions, q.name] : design.questions.filter((n) => n !== q.name) })} />}
                        label={`${q.title || q.name}`}
                      />
                    ))}
                  </Stack>
                ) : (
                  <Alert severity="info">{uiPair(language, 'Add an image choice or rating question first.', '先添加一道图片选择或打分题。')}</Alert>
                )}
                <Typography variant="caption" color="text.secondary">
                  {conditions.length > 1
                    ? uiPair(language, `Groups: ${conditions.length} conditions are set in Basic info and are balanced on top of this design.`, `分组：已在「基本信息」里设了 ${conditions.length} 个实验条件，会在这个设计之上平衡分组。`)
                    : uiPair(language, 'To compare groups of people, add conditions in Basic info. They are balanced on top of this design.', '要比较两组人，在「基本信息 → 实验条件」里添加条件，会在这个设计之上平衡分组。')}
                </Typography>
              </Box>
            </Stack>
          </Box>

          <Box component="section">
            <Typography variant="subtitle2" sx={{ fontWeight: 600, mb: 1 }}>{uiPair(language, '3. What this design does', '3. 这个设计是这样的')}</Typography>
            <Alert severity={check?.ok ? 'success' : 'warning'} icon={false} sx={{ '& .MuiAlert-message': { fontSize: '0.95rem', lineHeight: 1.7 } }}>{sentence}</Alert>
            {check?.errors.map((e, i) => <Alert key={`e${i}`} severity="error" sx={{ mt: 1 }}>{zh ? e.zh : e.en}</Alert>)}
            {check?.warnings.map((w, i) => <Alert key={`w${i}`} severity="info" sx={{ mt: 1 }}>{zh ? w.zh : w.en}</Alert>)}
          </Box>

          {preview.length > 0 && (
            <Box component="section">
              <Typography variant="subtitle2" sx={{ fontWeight: 600, mb: 0.5 }}>{uiPair(language, '4. Preview before publishing', '4. 发布前预览')}</Typography>
              <Typography variant="caption" color="text.secondary" display="block" sx={{ mb: 1 }}>
                {uiPair(language, `What the first ${preview.length} participants see (same seed every time).`, `前 ${preview.length} 位参与者会看到的内容（同一个种子，每次都一样）。`)}
                {exposure && ` ${uiPair(language, `Across all ${sizing.versions} versions each of the ${unitWord} is seen ${exposure.min === exposure.max ? exposure.min : `${exposure.min}–${exposure.max}`} times.`, `全部 ${sizing.versions} 个版本做完后，每${design.type === 'fixed_pairs' ? '对' : '张图'}被看 ${exposure.min === exposure.max ? exposure.min : `${exposure.min}–${exposure.max}`} 次。`)}`}
              </Typography>
              <Box sx={{ overflowX: 'auto' }}>
                <Table size="small">
                  <TableHead>
                    <TableRow>
                      <TableCell sx={{ whiteSpace: 'nowrap' }}>{uiPair(language, 'Participant', '参与者')}</TableCell>
                      <TableCell>{uiPair(language, 'First trials', '前几个试次')}</TableCell>
                    </TableRow>
                  </TableHead>
                  <TableBody>
                    {preview.map((trials, v) => (
                      <TableRow key={v}>
                        <TableCell sx={{ whiteSpace: 'nowrap' }}>{`P${String(v + 1).padStart(2, '0')}`}</TableCell>
                        <TableCell sx={{ fontFamily: 'monospace', fontSize: '0.8rem', whiteSpace: 'nowrap' }}>
                          {trials.slice(0, 3).map((t) => (t.media.length > 1 ? `[${label(t.media[0])} | ${label(t.media[1])}]` : `[${label(t.media[0])}]`)
                            + (t.role === 'anchor' ? uiPair(language, ' (anchor)', '（锚点）') : '')).join('  ')}
                          {trials.length > 3 ? uiPair(language, ` … ${trials.length} in total`, ` … 共 ${trials.length} 个`) : ''}
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </Box>
            </Box>
          )}

          {check?.ok && (
            <Box component="section">
              <Typography variant="subtitle2" sx={{ fontWeight: 600, mb: 0.5 }}>{uiPair(language, 'Methods text for the paper', '论文 Methods 文字')}</Typography>
              <Typography variant="body2" color="text.secondary" sx={{ mb: 1 }}>{methods}</Typography>
              <Stack direction="row" gap={1} alignItems="center" flexWrap="wrap">
                <Button size="small" variant="outlined" onClick={copyMethods}>{copied ? uiPair(language, 'Copied', '已复制') : uiPair(language, 'Copy', '复制')}</Button>
                <Typography variant="caption" color="text.secondary">
                  {uiPair(language, `Design ${design.id} · seed ${design.seed} · ${designTypeName(design.type, false)}`, `设计 ${design.id} · 种子 ${design.seed} · ${designTypeName(design.type, true)}`)}
                </Typography>
                <Button size="small" sx={{ ml: 'auto' }} onClick={() => save({ seed: newSeed() })}>
                  {uiPair(language, 'New random seed', '换一个随机种子')}
                </Button>
              </Stack>
              <Typography variant="caption" color="text.secondary" display="block" sx={{ mt: 1 }}>
                {uiPair(language, 'Changing anything after collection starts gives the design a new id: earlier responses are kept, new participants follow the new design.', '开始收集后再改动，设计会换一个编号：已收集的回答保留，新参与者按新设计分配。')}
              </Typography>
            </Box>
          )}
        </>
      )}
    </Stack>
  );
}
