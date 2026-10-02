import React, { useEffect, useState } from 'react';
import { TextField } from '@mui/material';
import { useRegion } from '../../contexts/RegionContext';
import { captureParamNames, normalizeConditions } from '../../lib/surveyRuntimeContext';

const conditionsToText = (config) => normalizeConditions(config)
  .map((c) => [c.id, c.label !== c.id ? c.label : '', c.weight !== 1 ? c.weight : ''].join(' | ').replace(/( \| )+$/, ''))
  .join('\n');

export function parseConditionsText(text) {
  const list = String(text || '').split('\n').map((line) => line.trim()).filter(Boolean).map((line) => {
    const [id, label, weight] = line.split('|').map((part) => part.trim());
    const out = { id };
    if (label) out.label = label;
    if (Number(weight) > 0) out.weight = Number(weight);
    return out;
  });
  return normalizeConditions({ conditions: list }).length > 1 ? list : undefined;
}

export function parseUrlParamsText(text) {
  const names = captureParamNames({ captureUrlParams: String(text || '').split(/[\s,]+/) });
  return names.length ? names : undefined;
}

/** Project-level between-participant conditions and URL parameter allow-list. */
export default function RuntimeContextSettings({ config, onChange }) {
  const { language } = useRegion();
  const zh = language === 'zh';
  const [conditionsText, setConditionsText] = useState(() => conditionsToText(config));
  const [paramsText, setParamsText] = useState(() => captureParamNames(config).join(', '));
  useEffect(() => { setConditionsText(conditionsToText(config)); }, [config?.conditions]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => { setParamsText(captureParamNames(config).join(', ')); }, [config?.captureUrlParams]); // eslint-disable-line react-hooks/exhaustive-deps

  return (
    <>
      <TextField
        fullWidth
        multiline
        minRows={2}
        variant="outlined"
        label={zh ? '被试间实验条件（可选）' : 'Between-participant conditions (optional)'}
        value={conditionsText}
        onChange={(e) => setConditionsText(e.target.value)}
        onBlur={() => onChange('conditions', parseConditionsText(conditionsText))}
        placeholder={'more_safe | More safe\nless_safe | Less safe'}
        helperText={zh
          ? '每行一个：id | 显示名 | 权重。至少两个才生效。每位新参与者分到已完成人数（按权重）最少的条件；可在题目显示条件里用 {sp_condition}。'
          : 'One per line: id | label | weight. Needs at least two. Each new participant joins the condition with the fewest completed responses relative to its weight. Use {sp_condition} in visibility rules.'}
      />
      <TextField
        fullWidth
        variant="outlined"
        label={zh ? '记录的链接参数（可选）' : 'URL parameters to record (optional)'}
        value={paramsText}
        onChange={(e) => setParamsText(e.target.value)}
        onBlur={() => onChange('captureUrlParams', parseUrlParamsText(paramsText))}
        placeholder="site, pid"
        helperText={zh
          ? '用逗号分隔。只记录列出的参数（截断到 64 字符），导出为 url_<名称> 列，题目里可用 {url_<名称>}。'
          : 'Comma-separated. Only these parameters are recorded (trimmed to 64 characters), exported as url_<name> columns, and available as {url_<name>}.'}
      />
    </>
  );
}
