import React from 'react';
import { FormControl, InputLabel, MenuItem, Select } from '@mui/material';

/** Languages the researcher enabled. Native names, so the control is readable before a choice. */
export default function ParticipantLanguagePicker({ languages, value, onChange }) {
  if (!languages || languages.length < 2) return null;
  return (
    <FormControl size="small" sx={{ mb: 2, minWidth: 180 }}>
      <InputLabel id="participant-language-label">Language</InputLabel>
      <Select
        labelId="participant-language-label"
        label="Language"
        value={value || ''}
        onChange={(event) => onChange(event.target.value)}
      >
        {languages.map((item) => (
          <MenuItem key={item.id} value={item.id}>{item.nativeName}</MenuItem>
        ))}
      </Select>
    </FormControl>
  );
}
