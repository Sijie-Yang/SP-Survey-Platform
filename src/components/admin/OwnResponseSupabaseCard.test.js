import React from 'react';
import '@testing-library/jest-dom';
import { fireEvent, render, screen } from '@testing-library/react';
import { RegionProvider } from '../../contexts/RegionContext';
import OwnResponseSupabaseCard from './OwnResponseSupabaseCard';
import { saveOwnResponseSupabase } from '../../lib/projectManager';
import { settingsForSave } from '../../lib/ownResponseSupabase';

jest.mock('../../lib/projectManager', () => ({
  saveOwnResponseSupabase: jest.fn(),
}));

const project = {
  id: 'proj_1',
  ownResponseSupabase: {
    enabled: true,
    url: 'https://abcd.supabase.co',
    anonKey: 'public-anon-key',
    table: 'sp_survey_responses',
  },
};

function renderCard(language = 'en') {
  localStorage.setItem('sp-survey-language', language);
  return render(
    <RegionProvider>
      <OwnResponseSupabaseCard currentProject={project} />
    </RegionProvider>,
  );
}

test('shows the English setting, insert-only SQL, and refuses an empty URL', async () => {
  saveOwnResponseSupabase.mockImplementation(async (_id, settings) => {
    const decided = settingsForSave(settings);
    if (!decided.ok) return { success: false, error: decided.error };
    return { success: true, ownResponseSupabase: decided.value };
  });
  renderCard('en');
  expect(screen.getByText('Store responses in my Supabase')).toBeInTheDocument();
  expect(screen.getByLabelText(/Anon public key/i)).toBeInTheDocument();
  const sql = screen.getByTestId('own-response-sql').textContent;
  expect(sql).toContain('sp_survey_responses');
  expect(sql.toLowerCase()).toContain('for insert');
  expect(sql.toLowerCase()).not.toMatch(/for\s+(select|update|delete)/);
  fireEvent.change(screen.getByLabelText(/Supabase project URL/i), { target: { value: '' } });
  fireEvent.click(screen.getByRole('button', { name: 'Save response storage' }));
  expect(await screen.findByText('Enter the Supabase project URL.')).toBeInTheDocument();
});

test('shows the Chinese setting labels', () => {
  renderCard('zh');
  expect(screen.getByText('回答写入我的 Supabase')).toBeInTheDocument();
  expect(screen.getByLabelText(/anon 公钥/)).toBeInTheDocument();
  expect(screen.getByText('粘贴到你的 Supabase SQL 编辑器')).toBeInTheDocument();
});
