import React, { useMemo, useState } from 'react';
import {
  Alert, Autocomplete, Box, Button, ButtonBase, Checkbox, FormControlLabel, MenuItem, Radio, RadioGroup, Select, Stack,
  Table, TableBody, TableCell, TableHead, TableRow, TextField, Typography,
} from '@mui/material';
import { useRegion } from '../../contexts/RegionContext';
import { isChineseLanguage, uiPair } from '../../lib/uiLanguages';
import {
  DESIGN_MAX_PER_TRIAL, DESIGN_MAX_SLOTS, SLOT_NAMES, buildVersions, computeDesignId, describeDesign, designMethodsText, designSizing,
  designSlotNames, designTypeName, normalizeDesign, parseCatchText, parsePairsText, plannedExposures, questionCanFollowDesign,
  questionShowsPair, questionView, surveyQuestions, validateDesign,
} from '../../lib/experimentDesign';
import { newSeed } from '../../lib/designRandom';
import { getDirectChildMedia, getRecursiveMedia, listAllKnownFolders, normalizeMediaEntry } from '../../lib/mediaUtils';
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
    zh: ['从图库里挑选', '每次从图库出 2 张（或更多）让人选一张或勾几张，最后排出每张图的名次。例如 Place Pulse。', '和普通随机配对的区别：每张图出场次数一样多，一个人不会重复看到同一张，结果直接给出名次和区间。'],
    en: ['Choose from a library', 'Each trial shows 2 (or more) library images to pick one or several from; the result ranks every image. E.g. Place Pulse.', 'Unlike plain random pairing, every image appears equally often, nobody sees an image twice, and Results gives a ranking with intervals.'],
  },
  {
    type: 'fixed_pairs',
    zh: ['比较固定的几组图', '你事先定好哪几张是一组，例如改造前/后，或同一地点的 3 个版本。同一组下可以问好几道题。', '和"分组"模式的区别：几道题共用同一批组，每个位置各占正好一半，结果按组给出 B 比 A 好多少。'],
    en: ['Compare fixed sets', 'You decide which images form a set, e.g. before/after, or 3 versions of one place. Several questions can follow the same set.', 'Unlike set mode, several questions share the same sets, every position is used exactly equally, and Results gives B vs A per set.'],
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
  const catchesToText = (list) => (Array.isArray(list) ? list : [])
    .map((c) => [...(c.media || []), c.expected == null ? null : String(c.expected)].filter((x) => x != null).join(', ')).join('\n');
  const savedCatchText = catchesToText(config?.experimentDesign?.catches);
  const [catchText, setCatchText] = useState(savedCatchText);
  // Show the saved catch trials when the panel opens on an existing design (not while typing).
  React.useEffect(() => { setCatchText((t) => (catchesToText(parseCatchText(t).catches) === savedCatchText ? t : savedCatchText)); }, [savedCatchText]); // eslint-disable-line react-hooks/exhaustive-deps
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
  // Every folder that holds 2 or more images is one set; slots A, B, C… in file-name order.
  // Folders with 2–12 direct images are sets. All sets need the same slots, so take the
  // most common image count and leave folders of another size out (they are usually anchors or checks).
  const setsFromFolders = () => {
    const candidates = folders
      .map((folder) => ({ folder, members: getDirectChildMedia(pool, folder) }))
      .filter((s) => s.folder && s.members.length >= 2 && s.members.length <= DESIGN_MAX_SLOTS);
    const bySize = new Map();
    candidates.forEach((s) => bySize.set(s.members.length, (bySize.get(s.members.length) || 0) + 1));
    const size = [...bySize.entries()].sort((x, y) => y[1] - x[1] || x[0] - y[0])[0]?.[0];
    return candidates.filter((s) => s.members.length === size).map((s) => ({
      id: s.folder.split('/').pop() || s.folder,
      slots: Object.fromEntries(s.members.map((m, i) => [SLOT_NAMES[i], keyOf(m)])),
      label: s.folder,
    }));
  };

  const chooseGoal = (type) => {
    const base = { enabled: true, type, perPerson: raw?.perPerson || 10, target: raw?.target || 10, sizing: raw?.sizing || 'target', people: raw?.people || 100, repeats: raw?.repeats || 0, questions: (raw?.questions || []).filter((n) => followable.some((q) => q.name === n)), anchors: [], views: {} };
    if (type === 'fixed_pairs') save({ ...base, units: raw?.type === 'fixed_pairs' ? raw.units : setsFromFolders(), sourceFolders: [] });
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
  const slotNames = design ? designSlotNames(design) : [];
  const isFixed = design?.type === 'fixed_pairs';
  const setWord = isFixed ? (slotNames.length === 2 ? uiPair(language, 'pair', '对') : uiPair(language, 'set', '组')) : uiPair(language, 'image', '张图');
  const label = (k) => String(k).split('/').pop();
  const followed = design ? followable.filter((q) => design.questions.includes(q.name)) : [];
  const showViews = design && followed.length > 0 && (isFixed || followed.length > 1);

  const setView = (name, patch) => {
    const current = { ...(design.views?.[name] || {}), ...patch };
    const views = { ...(raw?.views || {}) };
    if ((current.trials || 'all') === 'all' && (current.slots == null || current.slots === 'auto')) delete views[name];
    else views[name] = current;
    save({ views });
  };
  const slotChoice = (q) => {
    const v = questionView(design, q);
    return Array.isArray(v.slots) ? v.slots.join(',') : v.slots;
  };

  const copyMethods = async () => {
    try {
      await navigator.clipboard.writeText(methods);
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch {
      setCopied(false);
    }
  };

  const trialText = (t) => {
    const role = t.role === 'anchor' ? uiPair(language, ' (anchor)', '（锚点）') : t.role === 'catch' ? uiPair(language, ' (catch)', '（检查）') : '';
    return `[${t.media.map(label).join(' | ')}]${role}`;
  };

  return (
    <Stack gap={2}>
      <Typography variant="body2" color="text.secondary">
        {uiPair(language,
          'Decide before publishing who sees which media. The platform splits the stimuli into versions so every image or set is seen about equally often, and Results analyses the data the same way. For a quick test or a small library you can skip this and let each question draw its own media.',
          '发布前先定好谁看哪些图。平台把刺激分成若干版本，保证每张图或每组被看的次数基本一样，结果页也按同一个设计来分析。只是试一下或者图不多，不用设计也可以，每道题各自随机抽图就够了。')}
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
              {!isFixed ? (
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
                    {uiPair(language, `${design.units.length} ${slotNames.length === 2 ? 'pairs' : 'sets'} in the design${slotNames.length ? ` (slots ${slotNames.join(', ')})` : ''}.`,
                      `设计里共 ${design.units.length} ${slotNames.length === 2 ? '对' : '组'}${slotNames.length ? `（每组 ${slotNames.length} 张：${slotNames.join('、')}）` : ''}。`)}
                  </Typography>
                  <Stack direction="row" gap={1} flexWrap="wrap">
                    <Button size="small" variant="outlined" onClick={() => save({ units: setsFromFolders(), anchors: [], views: {} })}>
                      {uiPair(language, 'Read sets from folders (one folder = one set, A/B/C… by file name)', '从文件夹读取（一个文件夹 = 一组，按文件名顺序记为 A、B、C…）')}
                    </Button>
                  </Stack>
                  <TextField
                    id="design-pairs-text" size="small" multiline minRows={3} value={pairsText}
                    onChange={(e) => setPairsText(e.target.value)}
                    label={uiPair(language, 'Or paste a table', '或粘贴一张表')}
                    placeholder={'id, A, B, label\nP01, before_01.jpg, after_01.jpg, Main St\nP02, before_02.jpg, after_02.jpg'}
                    helperText={uiPair(language, 'One set per line: id, then the files (2 or more), then an optional label. A header line can name the slots (e.g. id, day, night). File names as in the media library.', '每行一组：编号，然后是文件（2 个或更多），最后可加说明。第一行可以给槽位起名（例如 id, 白天, 夜晚）。文件名与媒体库一致。')}
                  />
                  <Box>
                    <Button size="small" variant="contained" disabled={!pairsText.trim()} onClick={() => {
                      const { units } = parsePairsText(pairsText);
                      if (units.length) save({ units, anchors: [], views: {} });
                    }}
                    >
                      {uiPair(language, 'Use this table', '使用这张表')}
                    </Button>
                  </Box>
                  <Stack direction="row" gap={1.5} flexWrap="wrap">
                    <TextField
                      select size="small" id="design-slot-mode" sx={{ flex: '1 1 260px' }} value={design.slotMode}
                      label={uiPair(language, 'What each person sees of a set', '每人看一组里的什么')}
                      onChange={(e) => save({ slotMode: e.target.value })}
                    >
                      <MenuItem value="all">{uiPair(language, 'All images of the set', '整组都看')}</MenuItem>
                      <MenuItem value="one">{uiPair(language, 'One image per set, rotated (e.g. day or night, half each)', '每组只看一张，轮流分配（例如白天或夜晚，各占一半）')}</MenuItem>
                    </TextField>
                    {design.slotMode === 'all' && (
                      <TextField
                        select size="small" id="design-position" sx={{ flex: '1 1 260px' }} value={design.position}
                        label={uiPair(language, 'Positions within a set', '组内的位置')}
                        onChange={(e) => save({ position: e.target.value })}
                      >
                        <MenuItem value="alternate">{uiPair(language, 'Alternate (each position exactly half)', '轮流交换（每个位置正好各占一半）')}</MenuItem>
                        <MenuItem value="random">{uiPair(language, 'Random', '随机')}</MenuItem>
                        <MenuItem value="fixed">{uiPair(language, 'Fixed as listed (e.g. reference always left)', '固定（例如参照图永远在左）')}</MenuItem>
                      </TextField>
                    )}
                  </Stack>
                </>
              )}
              <Stack direction="row" gap={1.5} flexWrap="wrap" alignItems="flex-start">
                <NumberField
                  id="design-per-person"
                  label={design.type === 'pool_pairs' ? uiPair(language, 'Choices per person', '每人选几次') : isFixed ? uiPair(language, `${slotNames.length === 2 ? 'Pairs' : 'Sets'} per person`, `每人看几${slotNames.length === 2 ? '对' : '组'}`) : uiPair(language, 'Images per person', '每人看几张')}
                  value={design.perPerson} max={200} onChange={(n) => save({ perPerson: n })}
                />
                {design.type === 'pool_pairs' && (
                  <NumberField id="design-per-trial" min={2} max={DESIGN_MAX_PER_TRIAL} label={uiPair(language, 'Images on screen each time', '每次看几张')} value={design.perTrial} onChange={(n) => save({ perTrial: n })} helperText={uiPair(language, '2 = pairwise; more for pick-one-of-k or pick-any.', '2 = 二选一；更多则是多选一或多选多。')} />
                )}
                <Box sx={{ flex: '2 1 280px' }}>
                  <RadioGroup row value={design.sizing} onChange={(e) => save({ sizing: e.target.value })}>
                    <FormControlLabel value="target" control={<Radio size="small" />} label={uiPair(language, 'I know how often each should be seen', '我知道每个要被看几次')} />
                    <FormControlLabel value="people" control={<Radio size="small" />} label={uiPair(language, 'I know how many people I will get', '我知道能招多少人')} />
                  </RadioGroup>
                  {design.sizing === 'target' ? (
                    <NumberField id="design-target" label={uiPair(language, `Times each ${setWord} is seen (at least)`, `每${setWord}至少被看几次`)} value={design.target} onChange={(n) => save({ target: n })} />
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
              <TextField
                id="design-catch-text" size="small" multiline minRows={1} fullWidth value={catchText}
                onChange={(e) => setCatchText(e.target.value)}
                label={uiPair(language, `Catch trials with a known answer (optional)${design.catches.length ? ` · ${design.catches.length} set` : ''}`, `检查题，答案已知（可选）${design.catches.length ? ` · 已设 ${design.catches.length} 道` : ''}`)}
                placeholder={design.type === 'rate' ? 'black_square.jpg, 1' : 'black_square.jpg, park.jpg, park.jpg'}
                helperText={uiPair(language, 'One per line: the file(s) to show, then the expected answer (a file name for a choice, a number for a rating). Mixed in at random; Results reports who failed.', '每行一道：先写要显示的文件，最后写正确答案（选择题写文件名，打分题写数字）。随机插在中间，结果页会列出没答对的人。')}
                onBlur={() => {
                  const { catches } = parseCatchText(catchText);
                  if (catches.length || design.catches.length) save({ catches });
                }}
              />
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
                {showViews && (
                  <Box sx={{ overflowX: 'auto', mt: 0.5 }}>
                    <Table size="small" sx={{ '& td, & th': { py: 0.5 } }}>
                      <TableHead>
                        <TableRow>
                          <TableCell>{uiPair(language, 'Question', '题')}</TableCell>
                          {isFixed && design.slotMode === 'all' && <TableCell>{uiPair(language, 'Shows', '看什么')}</TableCell>}
                          <TableCell>{uiPair(language, 'Which trials', '做哪些')}</TableCell>
                        </TableRow>
                      </TableHead>
                      <TableBody>
                        {followed.map((q) => {
                          const v = questionView(design, q);
                          return (
                            <TableRow key={q.name}>
                              <TableCell sx={{ whiteSpace: 'nowrap' }}>{q.title || q.name}</TableCell>
                              {isFixed && design.slotMode === 'all' && (
                                <TableCell>
                                  <Select size="small" value={slotChoice(q)} id={`design-view-slots-${q.name}`} sx={{ minWidth: 200 }}
                                    onChange={(e) => {
                                      const val = e.target.value;
                                      setView(q.name, { slots: val === 'all' || val === 'each' ? val : val.split(',') });
                                    }}
                                  >
                                    {questionShowsPair(q) && <MenuItem value="all">{uiPair(language, 'The whole set on one screen', '整组一屏')}</MenuItem>}
                                    {!questionShowsPair(q) && <MenuItem value="each">{uiPair(language, 'Each image on its own', '一张一张看')}</MenuItem>}
                                    {slotNames.map((s) => <MenuItem key={s} value={s}>{uiPair(language, `Only ${s}`, `只看 ${s}`)}</MenuItem>)}
                                    {questionShowsPair(q) && slotNames.length > 2 && slotNames.flatMap((s, i) => slotNames.slice(i + 1).map((t) => (
                                      <MenuItem key={`${s},${t}`} value={`${s},${t}`}>{uiPair(language, `${s} and ${t} only`, `只看 ${s} 和 ${t}`)}</MenuItem>
                                    )))}
                                  </Select>
                                </TableCell>
                              )}
                              <TableCell>
                                <Select size="small" value={v.trials} id={`design-view-trials-${q.name}`} sx={{ minWidth: 160 }} onChange={(e) => setView(q.name, { trials: e.target.value })}>
                                  <MenuItem value="all">{uiPair(language, 'All of them', '全部')}</MenuItem>
                                  <MenuItem value="first">{uiPair(language, 'First half only', '只做前一半')}</MenuItem>
                                  <MenuItem value="second">{uiPair(language, 'Second half only', '只做后一半')}</MenuItem>
                                </Select>
                              </TableCell>
                            </TableRow>
                          );
                        })}
                      </TableBody>
                    </Table>
                    <Typography variant="caption" color="text.secondary">
                      {uiPair(language, 'Defaults are fine for most studies. "First half / second half" lets two questions use different images from the same balanced plan.', '默认就行。"前一半 / 后一半"可以让两道题用同一个平衡计划里不同的图。')}
                    </Typography>
                  </Box>
                )}
                <Typography variant="caption" color="text.secondary" display="block">
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
                {exposure && ` ${uiPair(language, `Across all ${sizing.versions} versions each ${setWord} is seen ${exposure.min === exposure.max ? exposure.min : `${exposure.min}–${exposure.max}`} times.`, `全部 ${sizing.versions} 个版本做完后，每${setWord}被看 ${exposure.min === exposure.max ? exposure.min : `${exposure.min}–${exposure.max}`} 次。`)}`}
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
                          {trials.slice(0, 3).map(trialText).join('  ')}
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
