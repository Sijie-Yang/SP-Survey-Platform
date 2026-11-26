import React from 'react';
import { Autocomplete, Stack, TextField } from '@mui/material';
import { FACET_DIMENSIONS } from '../../lib/templateFacets';

/**
 * Admin editor for template facets: one field per dimension, options from the
 * fixed vocabulary. Open dimensions (country, city) also take new values.
 * value / onChange use { dimension: [ids] }.
 */
export default function FacetEditor({ value, onChange }) {
  return (
    <Stack spacing={1.5}>
      {FACET_DIMENSIONS.map((dim) => {
        const ids = value?.[dim.key] || [];
        const set = (next) => onChange({ ...value, [dim.key]: dim.single ? next.slice(-1) : next });
        const label = `${dim.zh} / ${dim.en}${dim.single ? '（单选）' : ''}`;
        if (dim.open) {
          return (
            <Autocomplete
              key={dim.key}
              multiple
              freeSolo
              size="small"
              options={[]}
              value={ids}
              onChange={(_, next) => set(next.map((v) => String(v).trim()).filter(Boolean))}
              renderInput={(params) => <TextField {...params} label={label} placeholder="输入后回车" />}
            />
          );
        }
        const options = dim.values.map((v) => v.id);
        const byId = Object.fromEntries(dim.values.map((v) => [v.id, v]));
        return (
          <Autocomplete
            key={dim.key}
            multiple
            size="small"
            options={options}
            value={ids.filter((id) => byId[id])}
            onChange={(_, next) => set(next)}
            getOptionLabel={(id) => (byId[id] ? `${byId[id].zh} · ${byId[id].en}` : id)}
            renderInput={(params) => <TextField {...params} label={label} />}
          />
        );
      })}
    </Stack>
  );
}
