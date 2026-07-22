/**
 * Guard against browser ↔ Worker design-protocol drift.
 * Worker ESM cannot be imported into CRA Jest, so we parse the Worker source.
 */
import fs from 'fs';
import path from 'path';
import { DESIGN_CAPABILITIES } from './capabilities';
import { KNOWN_SKILL_RESULT_TYPE_IDS } from '../skillResultTypes';

const root = path.join(__dirname, '../../..');

function readWorker(rel) {
  return fs.readFileSync(path.join(root, rel), 'utf8');
}

function extractQuotedArray(source, marker) {
  const idx = source.indexOf(marker);
  if (idx < 0) throw new Error(`Marker not found: ${marker}`);
  const start = source.indexOf('[', idx);
  if (start < 0) throw new Error(`Array start not found after ${marker}`);
  let depth = 0;
  let end = -1;
  for (let i = start; i < source.length; i += 1) {
    if (source[i] === '[') depth += 1;
    else if (source[i] === ']') {
      depth -= 1;
      if (depth === 0) { end = i; break; }
    }
  }
  if (end < 0) throw new Error(`Array end not found after ${marker}`);
  const body = source.slice(start, end + 1);
  return [...body.matchAll(/'([^']+)'/g)].map((m) => m[1]);
}

describe('designProtocol browser ↔ worker mirror', () => {
  const workerDesign = readWorker('worker-lib/designProtocol.mjs');
  const workerSkillTypes = readWorker('worker-lib/agent/skillResultTypes.mjs');

  test('questionTypes sets match', () => {
    const browserTypes = [...DESIGN_CAPABILITIES.questionTypes].sort();
    const workerTypes = extractQuotedArray(workerDesign, 'questionTypes:').sort();
    expect(workerTypes).toEqual(browserTypes);
  });

  test('imagecheckbox / mediacheckbox defaults include 3 tags', () => {
    expect(workerDesign).toMatch(/imagecheckbox:[\s\S]*?tag_c/);
    expect(workerDesign).toMatch(/mediacheckbox:[\s\S]*?tag_c/);
    expect(workerDesign).toContain("value: 'tag_a'");
    expect(workerDesign).toContain("value: 'tag_b'");
    expect(workerDesign).toContain("value: 'tag_c'");
  });

  test('worker exposes postProcessAiConfig', () => {
    expect(workerDesign).toContain('export function postProcessAiConfig');
  });

  test('skillResultTypes id sets match', () => {
    // Worker: export const SKILL_RESULT_TYPES = { id: {...}, ... }
    const workerIds = [...workerSkillTypes.matchAll(/^\s{2}([a-zA-Z][a-zA-Z0-9]*): \{/gm)]
      .map((m) => m[1])
      .filter((id) => id !== 'SKILL_RESULT_TYPES')
      .sort();
    const browserIds = [...KNOWN_SKILL_RESULT_TYPE_IDS].sort();
    expect(workerIds).toEqual(browserIds);
  });

  test('capabilities skill resultSchemaTypes include native families', () => {
    const browserGuide = DESIGN_CAPABILITIES.questionTypeGuide.skillquestion.resultSchemaTypes;
    const workerGuide = extractQuotedArray(workerDesign, 'resultSchemaTypes:');
    expect([...workerGuide].sort()).toEqual([...browserGuide].sort());
  });
});
