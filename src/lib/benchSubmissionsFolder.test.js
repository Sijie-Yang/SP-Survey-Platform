import fs from 'fs';
import path from 'path';
import { validateSubmission } from './benchHumanTrack';

const dir = path.join(__dirname, '../../public/bench/submissions');

test('every submission file is listed in index.json and is valid', () => {
  const index = JSON.parse(fs.readFileSync(path.join(dir, 'index.json'), 'utf8'));
  expect(Array.isArray(index.submissions)).toBe(true);
  const files = fs.readdirSync(dir).filter((f) => f.endsWith('.json') && f !== 'index.json').sort();
  expect([...index.submissions].sort()).toEqual(files);
  for (const f of files) {
    const sub = JSON.parse(fs.readFileSync(path.join(dir, f), 'utf8'));
    expect({ file: f, errors: validateSubmission(sub) }).toEqual({ file: f, errors: [] });
  }
});
