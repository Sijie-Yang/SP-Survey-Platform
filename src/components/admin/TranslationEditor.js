import React, { useMemo, useState } from 'react';
import {
  Alert,
  Box,
  Button,
  Chip,
  FormControl,
  FormControlLabel,
  InputLabel,
  MenuItem,
  Select,
  Switch,
  TextField,
  Typography,
} from '@mui/material';
import { useRegion } from '../../contexts/RegionContext';
import { UI_LANGUAGES, uiPair } from '../../lib/uiLanguages';
import { requestSurveyTranslations } from '../../lib/surveyTranslationApi';
import {
  confirmAllTranslations,
  confirmTranslation,
  deleteLanguageVersion,
  editTranslation,
  extractTranslatableStrings,
  mergeMachineTranslations,
  reconcileTranslations,
  setTranslationLanguages,
  stringsForMachineTranslation,
  translationAccuracyNotice,
  translationPublishFindings,
  translationStatusLabel,
} from '../../lib/surveyTranslations';

const FIELD_LABELS = {
  title: ['Title', '标题'],
  description: ['Description', '说明'],
  completion: ['Completion page', '完成页'],
  choice: ['Option label', '选项文字'],
  row: ['Row label', '行文字'],
  column: ['Column label', '列文字'],
  rate: ['Scale label', '量表文字'],
  minRateDescription: ['Scale start', '量表起点'],
  maxRateDescription: ['Scale end', '量表终点'],
  labelTrue: ['Yes label', '“是”的文字'],
  labelFalse: ['No label', '“否”的文字'],
  scaleStart: ['Scale start', '量表起点'],
  scaleEnd: ['Scale end', '量表终点'],
};

function fieldLabel(field, uiLanguage) {
  const pair = FIELD_LABELS[field] || [field, field];
  return uiPair(uiLanguage, pair[0], pair[1]);
}

export function TranslationPublishNotice({ config, language }) {
  const findings = translationPublishFindings(config || {});
  if (!findings.missing.length && !findings.unreviewed.length) return null;
  const line = (row, status) => `${row.groupLabel} · ${fieldLabel(row.field, language)} · ${row.languageName} · ${translationStatusLabel(status, language)}`;
  return (
    <Alert severity="warning" sx={{ my: 1 }}>
      <Typography variant="body2" sx={{ mb: 0.5 }}>
        {uiPair(language, 'Check translations before publishing', '发布前请检查翻译')}
      </Typography>
      {findings.missing.map((row) => (
        <Typography key={`missing-${row.language}-${row.id}`} variant="caption" component="p">
          {line(row, 'missing')}
        </Typography>
      ))}
      {findings.unreviewed.map((row) => (
        <Typography key={`review-${row.language}-${row.id}`} variant="caption" component="p">
          {line(row, 'machine')}
        </Typography>
      ))}
    </Alert>
  );
}

export default function TranslationEditor({ config, onChange }) {
  const { language } = useRegion();
  const live = useMemo(() => reconcileTranslations(config || {}), [config]);
  const strings = useMemo(() => extractTranslatableStrings(config || {}), [config]);
  const [activeLanguage, setActiveLanguage] = useState(live.targetLanguages[0] || '');
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState('');
  const target = live.targetLanguages.includes(activeLanguage) ? activeLanguage : (live.targetLanguages[0] || '');

  const write = (translations) => onChange({ ...config, translations });

  const updateLanguages = (patch) => {
    write(setTranslationLanguages(config, {
      sourceLanguage: live.sourceLanguage,
      targetLanguages: live.targetLanguages,
      enabledLanguages: live.enabledLanguages,
      ...patch,
    }));
  };

  const generate = async (forceIds = []) => {
    if (!target) return;
    const items = stringsForMachineTranslation({ ...config, translations: live }, target, { forceIds });
    if (!items.length) {
      setNotice(uiPair(language, 'Every string already has a reviewed or edited translation.', '每条文字都已有审阅过或人工改过的翻译。'));
      return;
    }
    setBusy(true);
    setNotice('');
    const result = await requestSurveyTranslations({
      sourceLanguage: live.sourceLanguage,
      targetLanguage: target,
      items,
    });
    setBusy(false);
    if (!result.configured) {
      setNotice(uiPair(
        language,
        'The Assistant model is not configured, so no translation was requested. Add a model and key in AI & Integrations.',
        '尚未配置助手模型，因此没有请求翻译。请在「AI 与集成」中添加模型和密钥。',
      ));
      return;
    }
    if (result.error) {
      setNotice(result.error);
      return;
    }
    write(mergeMachineTranslations(live, target, result.translations, { forceIds }));
    if (result.rejected?.length) {
      setNotice(uiPair(
        language,
        'Some strings were left unchanged because the translation altered a number, placeholder, or tag.',
        '有些文字未更新，因为译文改动了数字、占位符或标签。',
      ));
    }
  };

  return (
    <Box sx={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
      <Typography variant="h6">{uiPair(language, 'Translations', '翻译')}</Typography>
      <Alert severity="info">{translationAccuracyNotice(language)}</Alert>
      <Typography variant="body2" color="text.secondary">
        {uiPair(
          language,
          'One survey, one response dataset. Participants only see languages you enable here.',
          '一份问卷，一份答卷数据。参与者只能选择你在这里启用的语言。',
        )}
      </Typography>
      {!!notice && <Alert severity="warning">{notice}</Alert>}
      <Box sx={{ display: 'flex', gap: 2, flexWrap: 'wrap' }}>
        <FormControl size="small" sx={{ minWidth: 180 }}>
          <InputLabel>{uiPair(language, 'Source language', '源语言')}</InputLabel>
          <Select
            label={uiPair(language, 'Source language', '源语言')}
            value={live.sourceLanguage}
            onChange={(event) => updateLanguages({ sourceLanguage: event.target.value })}
          >
            {UI_LANGUAGES.map((item) => (
              <MenuItem key={item.id} value={item.id}>{item.nativeName}</MenuItem>
            ))}
          </Select>
        </FormControl>
        <FormControl size="small" sx={{ minWidth: 220 }}>
          <InputLabel>{uiPair(language, 'Target languages', '目标语言')}</InputLabel>
          <Select
            multiple
            label={uiPair(language, 'Target languages', '目标语言')}
            value={live.targetLanguages}
            onChange={(event) => {
              const nextTargets = event.target.value;
              updateLanguages({ targetLanguages: nextTargets });
              if (!nextTargets.includes(target)) setActiveLanguage(nextTargets[0] || '');
            }}
            renderValue={(selected) => selected.map((id) => UI_LANGUAGES.find((item) => item.id === id)?.nativeName || id).join(', ')}
          >
            {UI_LANGUAGES.filter((item) => item.id !== live.sourceLanguage).map((item) => (
              <MenuItem key={item.id} value={item.id}>{item.nativeName}</MenuItem>
            ))}
          </Select>
        </FormControl>
      </Box>
      {live.targetLanguages.map((code) => (
        <FormControlLabel
          key={code}
          control={(
            <Switch
              checked={live.enabledLanguages.includes(code)}
              onChange={(event) => {
                const enabled = new Set(live.enabledLanguages);
                if (event.target.checked) enabled.add(code);
                else enabled.delete(code);
                updateLanguages({ enabledLanguages: [...enabled] });
              }}
            />
          )}
          label={uiPair(
            language,
            `Participants can choose ${UI_LANGUAGES.find((item) => item.id === code)?.nativeName || code}`,
            `参与者可以选择${UI_LANGUAGES.find((item) => item.id === code)?.nativeName || code}`,
          )}
        />
      ))}
      {!!live.targetLanguages.length && (
        <Box sx={{ display: 'flex', gap: 1, flexWrap: 'wrap', alignItems: 'center' }}>
          <FormControl size="small" sx={{ minWidth: 160 }}>
            <InputLabel>{uiPair(language, 'Editing', '正在编辑')}</InputLabel>
            <Select
              label={uiPair(language, 'Editing', '正在编辑')}
              value={target}
              onChange={(event) => setActiveLanguage(event.target.value)}
            >
              {live.targetLanguages.map((code) => (
                <MenuItem key={code} value={code}>{UI_LANGUAGES.find((item) => item.id === code)?.nativeName || code}</MenuItem>
              ))}
            </Select>
          </FormControl>
          <Button variant="contained" disabled={busy || !target} onClick={() => generate()}>
            {busy
              ? uiPair(language, 'Translating…', '正在翻译…')
              : uiPair(language, 'Generate translations', '生成翻译')}
          </Button>
          <Button
            variant="outlined"
            disabled={busy || !target}
            onClick={() => generate(strings.map((item) => item.id))}
          >
            {uiPair(language, 'Update this language', '更新此语言')}
          </Button>
          <Button
            color="error"
            disabled={busy || !target}
            onClick={() => {
              const remaining = live.targetLanguages.filter((code) => code !== target);
              write(deleteLanguageVersion(live, target));
              setActiveLanguage(remaining[0] || '');
            }}
          >
            {uiPair(language, 'Delete this language', '删除此语言')}
          </Button>
          <Button disabled={!target} onClick={() => write(confirmAllTranslations(live, target))}>
            {uiPair(language, 'Mark all as reviewed', '全部标为已审阅')}
          </Button>
        </Box>
      )}
      {!!target && (
        <Typography variant="caption" color="text.secondary">
          {uiPair(
            language,
            'Edits are saved immediately. Update regenerates this language and saves it. Delete removes it, so participants can no longer choose it on the first page.',
            '修改会立即保存。更新会重新生成此语言并保存。删除后，参与者在第一页不能再选择它。',
          )}
        </Typography>
      )}
      {target && strings.map((item) => {
        const cell = live.entries[item.id]?.byLanguage?.[target];
        const status = cell?.text ? cell.status : 'missing';
        return (
          <Box key={item.id} sx={{ display: 'grid', gap: 1, gridTemplateColumns: { xs: '1fr', sm: '1fr 1fr auto' }, alignItems: 'start' }}>
            <TextField
              size="small"
              label={`${item.groupLabel} · ${fieldLabel(item.field, language)}`}
              value={item.sourceText}
              InputProps={{ readOnly: true }}
            />
            <TextField
              key={`${target}:${item.id}`}
              size="small"
              label={uiPair(language, 'Translation', '译文')}
              value={cell?.text || ''}
              onChange={(event) => write(editTranslation(live, item.id, target, event.target.value))}
            />
            <Box sx={{ display: 'flex', flexDirection: 'column', gap: 0.5, pt: 0.5 }}>
              <Chip size="small" color={status === 'reviewed' ? 'success' : status === 'missing' ? 'default' : 'warning'} label={translationStatusLabel(status, language)} />
              <Button size="small" disabled={!cell?.text || status === 'reviewed'} onClick={() => write(confirmTranslation(live, item.id, target))}>
                {uiPair(language, 'Mark reviewed', '标为已审阅')}
              </Button>
            </Box>
          </Box>
        );
      })}
    </Box>
  );
}
