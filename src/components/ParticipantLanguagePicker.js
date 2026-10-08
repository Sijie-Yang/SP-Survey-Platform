import React from 'react';
import { Box, FormControl, InputLabel, MenuItem, Select, Typography } from '@mui/material';
import { uiPair } from '../lib/uiLanguages';

/** Languages the researcher enabled. Shown on the first page only. */
export default function ParticipantLanguagePicker({ languages, value, onChange, language }) {
  if (!languages || languages.length < 2) return null;
  const ui = language || value || 'en';
  const label = uiPair(ui, 'Language', '语言');
  return (
    <Box sx={{ mb: 2 }}>
      <FormControl size="small" sx={{ minWidth: 180 }}>
        <InputLabel id="participant-language-label">{label}</InputLabel>
        <Select
          labelId="participant-language-label"
          label={label}
          value={value || ''}
          onChange={(event) => onChange(event.target.value)}
        >
          {languages.map((item) => (
            <MenuItem key={item.id} value={item.id}>{item.nativeName}</MenuItem>
          ))}
        </Select>
      </FormControl>
      <Typography variant="caption" color="text.secondary" sx={{ display: 'block', mt: 0.5 }}>
        {uiPair(ui, 'Choose a language on this page. Later pages keep this choice.', '请在此页选择语言。之后的页面沿用这个选择。')}
      </Typography>
    </Box>
  );
}
