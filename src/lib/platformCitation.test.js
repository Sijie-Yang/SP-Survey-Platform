import fs from 'fs';
import path from 'path';
import yaml from 'js-yaml';
import {
  PLATFORM_PAPER, PLATFORM_VERSION, howToCiteLines, platformBibtex, platformCitations, resultsCitationCff,
} from './platformCitation';

const ENV = { ...process.env };
afterEach(() => { process.env = { ...ENV }; });

test('version matches package.json', () => {
  const pkg = JSON.parse(fs.readFileSync(path.join(__dirname, '..', '..', 'package.json'), 'utf8'));
  expect(PLATFORM_VERSION).toBe(pkg.version);
});

test('formats name the paper, all nine authors and the version', () => {
  const c = platformCitations({ version: '1.2.3' });
  expect(c.apa).toMatch(/^Yang, S\., Liang, X\., Gu, Y\., Quintana, M\., Ito, K\., Li, J\., Torkko, J\., Fan, Z\., & Biljecki, F\. \(2026\)\. SP-Survey: An Open-source Platform/);
  expect(c.apa).toMatch(/Manuscript under review\.$/);
  expect(c.bibtex).toMatch(/^@article\{yang2026spsurvey,/);
  expect(c.bibtex).toMatch(/author  = \{Yang, Sijie and Liang, Xiucheng and .* and Biljecki, Filip\}/);
  expect(c.software.bibtex).toMatch(/version = \{1\.2\.3\}/);
  expect(c.software.bibtex).toMatch(/author  = \{\{Urban Analytics Lab, National University of Singapore\}\}/);
  expect(c.text).toBe('Data were collected with SP-Survey (Sijie Yang et al., 2026; version 1.2.3, https://sp-survey.org).');
  expect(c.software.apa).toMatch(/^Urban Analytics Lab, National University of Singapore\. \(2026\)\. \*SP-Survey\* \(Version 1\.2\.3\)/);
  expect(PLATFORM_PAPER.authors).toHaveLength(9);
});

test('DOIs come from build variables and replace the "under review" note', () => {
  process.env.REACT_APP_PLATFORM_PAPER_DOI = 'https://doi.org/10.1177/2399808X26000001';
  process.env.REACT_APP_PLATFORM_DOI = '10.5281/zenodo.123';
  const c = platformCitations();
  expect(c.apa).toMatch(/https:\/\/doi\.org\/10\.1177\/2399808X26000001$/);
  expect(c.bibtex).toMatch(/doi     = \{10\.1177\/2399808X26000001\}/);
  expect(c.bibtex).not.toMatch(/under review/);
  expect(c.software.apa).toMatch(/https:\/\/doi\.org\/10\.5281\/zenodo\.123$/);
});

test('results CITATION.cff is valid YAML and cites paper and software', () => {
  const doc = yaml.load(resultsCitationCff({ project: { name: 'Street "safety"' }, releaseDate: '2026-10-22' }));
  expect(doc['cff-version']).toBe('1.2.0');
  expect(doc.title).toBe('Street "safety"');
  expect(doc.references.map((r) => r.type)).toEqual(['article', 'software']);
  expect(doc.references[0].authors).toHaveLength(9);
  expect(doc.references[0].status).toBe('submitted');
  expect(doc.references[1].version).toBe(PLATFORM_VERSION);
});

test('README lines and references.bib', () => {
  expect(howToCiteLines()[0]).toBe('How to cite SP-Survey:');
  expect(howToCiteLines().join('\n')).not.toMatch(/\*/);
  const bib = platformBibtex();
  expect(bib.match(/^@/gm)).toHaveLength(2);
});
