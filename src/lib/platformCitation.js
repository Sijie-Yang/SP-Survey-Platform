/**
 * How to cite SP-Survey. One place for the platform's citation so the cite
 * dialog, the methods text, every export README and CITATION.cff say the same
 * thing. Change the paper entry here once it is published.
 */

// Keep in step with package.json "version" (a test checks this).
export const PLATFORM_VERSION = '0.1.0';
export const PLATFORM_URL = 'https://sp-survey.org';
export const PLATFORM_REPOSITORY = 'https://github.com/Sijie-Yang/SP-Survey';

function env(name) {
  try {
    return (typeof process !== 'undefined' && process.env && process.env[name]) || '';
  } catch {
    return '';
  }
}

/** The methods paper. `doi` / `volume` / `pages` stay empty until it is published. */
export const PLATFORM_PAPER = Object.freeze({
  title: 'SP-Survey: An Open-source Platform for Visual Assessment of Urban Environments',
  authors: Object.freeze([
    { family: 'Yang', given: 'Sijie' },
    { family: 'Liang', given: 'Xiucheng' },
    { family: 'Gu', given: 'Youlong' },
    { family: 'Quintana', given: 'Matias' },
    { family: 'Ito', given: 'Koichi' },
    { family: 'Li', given: 'Jiatong' },
    { family: 'Torkko', given: 'Jussi' },
    { family: 'Fan', given: 'Zicheng' },
    { family: 'Biljecki', given: 'Filip' },
  ].map(Object.freeze)),
  journal: 'Environment and Planning B: Urban Analytics and City Science',
  year: '2026',
  status: 'under review',
});

// The software is credited to the lab; change to named people if preferred.
export const PLATFORM_SOFTWARE_AUTHORS = Object.freeze([
  { name: 'Urban Analytics Lab, National University of Singapore' },
].map(Object.freeze));

/** DOIs come from build-time variables so they can be set without a code change. */
export function platformDois() {
  return {
    paper: env('REACT_APP_PLATFORM_PAPER_DOI').replace(/^https?:\/\/(dx\.)?doi\.org\//i, ''),
    software: env('REACT_APP_PLATFORM_DOI').replace(/^https?:\/\/(dx\.)?doi\.org\//i, ''),
  };
}

const initials = (given) => given.split(/[\s-]+/).filter(Boolean).map((g) => `${g[0]}.`).join(' ');

function apaAuthors(list) {
  // A group author ends with its own full stop, as APA writes it.
  const names = list.map((a) => (a.name ? `${a.name}.` : `${a.family}, ${initials(a.given)}`));
  if (names.length === 1) return names[0];
  if (names.length <= 20) return `${names.slice(0, -1).join(', ')}, & ${names[names.length - 1]}`;
  return `${names.slice(0, 19).join(', ')}, … ${names[names.length - 1]}`;
}

function bibAuthors(list) {
  return list.map((a) => (a.name ? `{${a.name}}` : `${a.family}, ${a.given}`)).join(' and ');
}

function textAuthors(list) {
  if (list.length > 2) return `${list[0].given} ${list[0].family} et al.`;
  return list.map((a) => `${a.given} ${a.family}`).join(' and ');
}

/**
 * All citation formats.
 * @returns {{ apa: string, bibtex: string, text: string, software: { apa: string, bibtex: string } }}
 */
export function platformCitations({ version = PLATFORM_VERSION, accessed = '' } = {}) {
  const p = PLATFORM_PAPER;
  const { paper: paperDoi, software: softwareDoi } = platformDois();
  const published = Boolean(paperDoi);
  const paperTail = published ? ` https://doi.org/${paperDoi}` : ` Manuscript ${p.status}.`;
  const apa = `${apaAuthors(p.authors)} (${p.year}). ${p.title}. *${p.journal}*.${paperTail}`;
  const bibtex = [
    '@article{yang2026spsurvey,',
    `  title   = {${p.title}},`,
    `  author  = {${bibAuthors(p.authors)}},`,
    `  journal = {${p.journal}},`,
    `  year    = {${p.year}},`,
    published ? `  doi     = {${paperDoi}},` : `  note    = {Manuscript ${p.status}},`,
    `  url     = {${PLATFORM_URL}}`,
    '}',
  ].join('\n');

  const swAuthors = PLATFORM_SOFTWARE_AUTHORS;
  const swTail = softwareDoi ? ` https://doi.org/${softwareDoi}` : ` ${PLATFORM_URL}`;
  const softwareApa = `${apaAuthors(swAuthors)} (${p.year}). *SP-Survey* (Version ${version}) [Computer software].${swTail}`;
  const softwareBib = [
    '@software{spsurvey_software,',
    '  title   = {SP-Survey},',
    `  author  = {${bibAuthors(swAuthors)}},`,
    `  version = {${version}},`,
    `  year    = {${p.year}},`,
    softwareDoi ? `  doi     = {${softwareDoi}},` : null,
    `  url     = {${PLATFORM_URL}}`,
    '}',
  ].filter(Boolean).join('\n');

  const text = `Data were collected with SP-Survey (${textAuthors(p.authors)}, ${p.year}; version ${version}, ${PLATFORM_URL}${accessed ? `, accessed ${accessed}` : ''}).`;
  return { apa, bibtex, text, software: { apa: softwareApa, bibtex: softwareBib } };
}

/** Plain-text lines for README files. */
export function howToCiteLines({ version = PLATFORM_VERSION } = {}) {
  const c = platformCitations({ version });
  return [
    'How to cite SP-Survey:',
    `  ${c.apa.replace(/\*/g, '')}`,
    `  Software: ${c.software.apa.replace(/\*/g, '')}`,
    '  BibTeX for both is in references.bib; machine-readable metadata in CITATION.cff.',
  ];
}

/** BibTeX for both the paper and the software, for references.bib. */
export function platformBibtex({ version = PLATFORM_VERSION } = {}) {
  const c = platformCitations({ version });
  return `${c.bibtex}\n\n${c.software.bibtex}\n`;
}

const yaml = (v) => JSON.stringify(String(v ?? ''));

/** The `references` / `preferred-citation` CFF entries for the platform, indented for a list. */
export function platformCffReferenceLines({ indent = '  ', version = PLATFORM_VERSION } = {}) {
  const { paper: paperDoi, software: softwareDoi } = platformDois();
  const p = PLATFORM_PAPER;
  const lines = [
    `${indent}- type: article`,
    `${indent}  title: ${yaml(p.title)}`,
    `${indent}  journal: ${yaml(p.journal)}`,
    `${indent}  year: ${p.year}`,
    ...(paperDoi ? [`${indent}  doi: ${yaml(paperDoi)}`] : [`${indent}  status: ${yaml('submitted')}`]),
    `${indent}  authors:`,
    ...p.authors.flatMap((a) => [`${indent}    - family-names: ${yaml(a.family)}`, `${indent}      given-names: ${yaml(a.given)}`]),
    `${indent}- type: software`,
    `${indent}  title: "SP-Survey"`,
    `${indent}  version: ${yaml(version)}`,
    `${indent}  url: ${yaml(PLATFORM_URL)}`,
    `${indent}  repository-code: ${yaml(PLATFORM_REPOSITORY)}`,
    ...(softwareDoi ? [`${indent}  doi: ${yaml(softwareDoi)}`] : []),
    `${indent}  authors:`,
    ...PLATFORM_SOFTWARE_AUTHORS.flatMap((a) => (a.name
      ? [`${indent}    - name: ${yaml(a.name)}`]
      : [`${indent}    - family-names: ${yaml(a.family)}`, `${indent}      given-names: ${yaml(a.given)}`])),
  ];
  return lines;
}

/**
 * CITATION.cff for a results export: the data belong to the researcher, the
 * tool is cited through `references`.
 */
export function resultsCitationCff({ project, releaseDate, version = PLATFORM_VERSION } = {}) {
  const lines = [
    'cff-version: 1.2.0',
    'message: "These data were collected with SP-Survey. If you use them, please cite the study they belong to and SP-Survey (see references)."',
    'type: dataset',
    `title: ${yaml(project?.name || 'SP-Survey results export')}`,
    'authors:',
    '  - name: "The study authors"',
    `date-released: ${releaseDate}`,
    `url: ${yaml(PLATFORM_URL)}`,
    'references:',
    ...platformCffReferenceLines({ version }),
  ];
  return `${lines.join('\n')}\n`;
}
