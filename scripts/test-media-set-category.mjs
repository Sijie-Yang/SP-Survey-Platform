#!/usr/bin/env node
/**
 * Media pipeline smoke gate for CI/local release checks.
 * Delegates to the CRA/Jest suite — raw Node cannot import CRA's ESM-style
 * src/lib modules as named ESM exports (same limitation as older skill scripts).
 */
import { spawnSync } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const result = spawnSync(
  process.platform === 'win32' ? 'npx.cmd' : 'npx',
  [
    'cross-env',
    'CI=true',
    'react-scripts',
    'test',
    '--watchAll=false',
    '--testPathPattern=media(Utils|Pipeline|PerCategory|Slots)|surveyMediaInjection|templateImageImport|enrichSurveyResponses',
  ],
  { cwd: root, stdio: 'inherit', env: process.env },
);

process.exit(result.status ?? 1);
