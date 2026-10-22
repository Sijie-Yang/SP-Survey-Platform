import React from 'react';
import '@testing-library/jest-dom';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import CitePlatformButton from './CitePlatformButton';

test('opens the cite dialog, switches formats and copies', async () => {
  const writeText = jest.fn().mockResolvedValue();
  Object.assign(navigator, { clipboard: { writeText } });
  render(<CitePlatformButton language="en" />);
  fireEvent.click(screen.getByRole('button', { name: 'Cite' }));
  expect(screen.getByTestId('citation-text')).toHaveTextContent('@article{yang2026spsurvey');
  fireEvent.click(screen.getByRole('tab', { name: 'APA' }));
  expect(screen.getByTestId('citation-text')).toHaveTextContent(/^Yang, S\./);
  fireEvent.click(screen.getByRole('button', { name: 'Copy APA' }));
  await waitFor(() => expect(writeText).toHaveBeenCalledWith(expect.stringMatching(/^Yang, S\., Liang, X\./)));
  expect(await screen.findByRole('button', { name: 'Copied' })).toBeInTheDocument();
  expect(screen.getByRole('link', { name: 'SP-Report' })).toHaveAttribute('href', '/docs/sp-report');
});

test('Chinese labels', () => {
  render(<CitePlatformButton language="zh" />);
  fireEvent.click(screen.getByRole('button', { name: '引用' }));
  expect(screen.getByRole('tab', { name: '方法段落' })).toBeInTheDocument();
});
