import React from 'react';
import '@testing-library/jest-dom';
import { fireEvent, render, screen, within } from '@testing-library/react';
import HumanAgreementTrack from './HumanAgreementTrack';
import { buildHumanTask, buildSubmission, publicTask } from '../../lib/benchHumanTrack';
import { syntheticResponses, syntheticSurveyConfig } from '../../lib/__fixtures__/syntheticResults';

jest.mock('../../lib/methodsExport', () => ({ downloadTextFile: jest.fn() }));
const { downloadTextFile } = require('../../lib/methodsExport');

const config = syntheticSurveyConfig({ images: 8 });
const questions = config.pages.flatMap((p) => p.elements);
const human = syntheticResponses(40, { config, seed: 5 });
const project = { id: 'abcd1234-0000', name: 'Street study' };
const q = (name) => questions.find((x) => x.name === name);
const tasks = [
  publicTask(buildHumanTask({ project, question: q('safe'), humanRows: human, publishedAt: '2026-10-22' })),
  publicTask(buildHumanTask({ project, question: q('comfort'), humanRows: human, publishedAt: '2026-10-22' })),
];
const exact = (t, sign = 1) => Object.fromEntries(t.items.map((it) => [it.item_key, sign * it.value]));

test('shows tasks and a leaderboard recomputed from the submission files', () => {
  const subs = [
    buildSubmission({ model: 'Weak VLM', date: '2026-10-01', predictions: { [tasks[0].task_id]: exact(tasks[0], -1) } }),
    buildSubmission({ model: 'Strong VLM', organisation: 'Lab', date: '2026-10-02', predictions: { [tasks[0].task_id]: exact(tasks[0]), [tasks[1].task_id]: exact(tasks[1]) } }),
  ];
  render(<HumanAgreementTrack tasks={tasks} submissions={subs} language="en" />);
  const rows = within(screen.getByTestId('human-leaderboard')).getAllByRole('row');
  expect(rows[1]).toHaveTextContent('Strong VLM');
  expect(rows[1]).toHaveTextContent('1.000');
  expect(rows[2]).toHaveTextContent('Weak VLM');
  expect(rows[2]).toHaveTextContent('-0.500');
  expect(screen.getByTestId(`human-task-${tasks[0].task_id}`)).toHaveTextContent('Which place looks safer?');
  expect(screen.getByTestId(`human-task-${tasks[0].task_id}`)).toHaveTextContent('40 responses');
});

test('scores an uploaded CSV in the browser and builds a submission file', async () => {
  render(<HumanAgreementTrack tasks={tasks} submissions={[]} language="en" />);
  const csv = ['task_id,item_key,value', ...tasks[0].items.map((it) => `${tasks[0].task_id},${it.item_key},${it.value}`)].join('\n');
  const file = new File([csv], 'preds.csv', { type: 'text/csv' });
  fireEvent.change(screen.getByTestId('predictions-input'), { target: { files: [file] } });
  expect(await screen.findByTestId('your-score')).toHaveTextContent('Overall 0.500 · 1 of 2 tasks scored');
  expect(screen.getByTestId('your-rank')).toHaveTextContent('#1 of 1');
  fireEvent.change(screen.getByLabelText(/Model name/), { target: { value: 'My Model' } });
  fireEvent.click(screen.getByRole('button', { name: /Download submission file/ }));
  const [content, name] = downloadTextFile.mock.calls.at(-1);
  expect(name).toMatch(/^\d{4}-\d{2}-\d{2}-my-model\.json$/);
  const sub = JSON.parse(content);
  expect(sub).toMatchObject({ schema: 'sp-bench-human-submission/1', model: 'My Model', kind: 'model' });
  expect(Object.keys(sub.predictions)).toEqual([tasks[0].task_id]);
  const links = screen.getAllByRole('link', { name: 'public/bench/submissions' }).map((a) => a.getAttribute('href'));
  expect(links.some((href) => href.endsWith(`/new/main/public/bench/submissions?filename=${encodeURIComponent(name)}`))).toBe(true);
});

test('explains a bad upload', async () => {
  render(<HumanAgreementTrack tasks={tasks} submissions={[]} language="zh" />);
  fireEvent.change(screen.getByTestId('predictions-input'), { target: { files: [new File(['{"schema":"x"}'], 'bad.json')] } });
  expect(await screen.findByText(/schema must be/)).toBeInTheDocument();
  expect(screen.getByText('排行榜')).toBeInTheDocument();
});
