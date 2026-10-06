import React from 'react';
import '@testing-library/jest-dom';
import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import DocsPage from './DocsPage';
import { RegionProvider } from '../contexts/RegionContext';
import { RESEARCH_GUIDES } from './researchGuides';
import { PAPER_TEMPLATE_DOCS } from './paperTemplateDocs';
import { exampleTemplateMediaPrefix, libraryExampleUrls, researchPreviewSnapshot } from '../components/docs/ResearchPreview';
jest.mock('../lib/supabase', () => ({ supabase: null }));
import { getWikiPage, listWikiPages, wikiHistory } from '../lib/contentSubmissionStore';

let mockPreviewProps;
jest.mock('../lib/contentSubmissionStore', () => ({
  getWikiPage: jest.fn(() => Promise.resolve(null)),
  listWikiPages: jest.fn(() => Promise.resolve([])),
  wikiHistory: jest.fn(() => Promise.resolve([])),
}));
jest.mock('../components/admin/SurveyPreview', () => function MockSurveyPreview(props) {
  mockPreviewProps = props;
  return <div data-testid="full-template-renderer">{props.config.pages.length} pages</div>;
});

let mockDocId = '2013-salesses-collaborative';
jest.mock('../lib/useGithubStars', () => ({ useGithubStars: () => null }));
jest.mock('../lib/spBenchApi', () => ({ getBenchPublicStatus: () => Promise.resolve({ enabled: false }) }));
jest.mock('react-router-dom', () => ({
  useNavigate: () => jest.fn(),
  useParams: () => ({ docId: mockDocId }),
  useLocation: () => ({ pathname: '/docs' }),
  Link: require('react').forwardRef(({ children, to, ...rest }, ref) => <a ref={ref} href={to} {...rest}>{children}</a>),
}), { virtual: true });
const realFetch = global.fetch;
const templates = Object.fromEntries(PAPER_TEMPLATE_DOCS.map(({ id }) => [id, require(`../../public/project_templates/${id}.json`)]));
beforeEach(() => {
  getWikiPage.mockResolvedValue(null);
  listWikiPages.mockResolvedValue([]);
  wikiHistory.mockResolvedValue([]);
  mockDocId = '2013-salesses-collaborative';
  localStorage.setItem('sp-survey-language', 'en');
  window.scrollTo = jest.fn();
  global.fetch = jest.fn(url => Promise.resolve({ ok: true, json: async () => templates[url.split('/').pop().replace('.json', '')] }));
});
afterEach(() => { localStorage.clear(); global.fetch = realFetch; });
const view = () => <RegionProvider><DocsPage /></RegionProvider>;
// DocsNavigation labels the sidebar landmark "SP-Wiki". "Documentation" is not a role name.
const docsNav = () => screen.getByRole('navigation', { name: 'SP-Wiki' });

test('guide ties the paper, real preview, current settings and scoring together', async () => {
  render(view());
  expect(docsNav()).toBeInTheDocument();
  expect(screen.getByRole('heading', { name: 'Place Pulse 1.0' })).toBeInTheDocument();
  expect(screen.getByRole('img', { name: /actual platform survey preview/ })).toHaveAttribute('src', '/docs/research/2013-salesses-collaborative-preview.png');
  const settings = await screen.findByRole('table', { name: 'Current template settings' });
  expect(within(settings).getByText('safer')).toBeInTheDocument();
  expect(within(settings).getAllByText(/10 trials/)).toHaveLength(3);
  expect(screen.getByRole('button', { name: 'Try the example' })).toBeEnabled();
  fireEvent.click(screen.getByRole('button', { name: 'Add a tie' }));
  expect(screen.getByText(/7 comparisons; computed/)).toBeInTheDocument();
  fireEvent.click(screen.getByRole('button', { name: 'Reset example' }));
  expect(screen.getByText(/6 comparisons; computed/)).toBeInTheDocument();
});

test('failed template fetch leaves the written guide readable and supports retry', async () => {
  global.fetch.mockRejectedValueOnce(new Error('offline'));
  render(view());
  expect(await screen.findByText('Template could not load; the guide remains available.')).toBeInTheDocument();
  expect(screen.getByRole('heading', { name: 'What is being measured?' })).toBeInTheDocument();
  expect(screen.getByRole('button', { name: 'Try the example' })).toBeDisabled();
  fireEvent.click(screen.getByRole('button', { name: 'Retry' }));
  await screen.findByRole('table', { name: 'Current template settings' });
  expect(screen.getByRole('button', { name: 'Try the example' })).toBeEnabled();
});

test('a delayed old template response cannot replace a newly selected guide', async () => {
  let resolveOld;
  global.fetch.mockImplementationOnce(() => new Promise(resolve => { resolveOld = resolve; }));
  const rendered = render(view());
  mockDocId = '1990-nasar-evaluative';
  rendered.rerender(view());
  await screen.findByRole('table', { name: 'Current template settings' });
  await act(async () => resolveOld({ ok: true, json: async () => templates['2013-salesses-collaborative'] }));
  const settings = screen.getByRole('table', { name: 'Current template settings' });
  expect(within(settings).getByText('liked_areas')).toBeInTheDocument();
  expect(within(settings).queryByText('safer')).not.toBeInTheDocument();
});

test('guide header states the checked sample and medium', () => {
  expect(RESEARCH_GUIDES['1990-nasar-evaluative'].participants.label.en).toBe('Residents and visitors');
  expect(RESEARCH_GUIDES['1990-nasar-evaluative'].medium.en).toBe('Map');
  const cases = [
    ['2013-salesses-collaborative', ['Safety & Social Perception', 'Image · SVI', 'Pairwise Comparison', '7,872', '4,136']],
    ['2009-ewing-measuring', ['Urban Design Qualities', 'Video', 'Video + Rating Matrix', '10', '48']],
    ['2025-yang-thermal', ['Thermal Perception', 'Image · SVI', 'Pairwise Comparison', '176', '500']],
    ['2014-quercia-aesthetic', ['Beauty, Quiet & Happiness', 'Image', 'Pairwise Comparison', '3,301', '568']],
    ['2014-naik-streetscore', ['Perceived Safety', 'Image · SVI', 'Pairwise Comparison', '7,872', '4,109']],
    ['2016-dubey-place', ['Six Perceptual Attributes', 'Image · SVI', 'Pairwise Comparison', '81,630', '110,988']],
    ['2017-liu-machine', ['Facade & Street Wall', 'Image · SVI', 'Expert Rating', '8', '2,000+']],
  ];
  cases.forEach(([id, texts]) => {
    mockDocId = id;
    render(view());
    texts.forEach((text) => expect(screen.getAllByText(text).length).toBeGreaterThan(0));
    cleanup();
  });
});

test('the four promoted guides score with their own methods', () => {
  const ResearchAnalysisExample = require('../components/docs/ResearchAnalysisExample').default;
  render(<ResearchAnalysisExample id="2014-quercia-aesthetic" language="en" />);
  expect(screen.getByText('Choice share')).toBeInTheDocument();
  expect(screen.queryByText(/0\.6 − 0\.2/)).not.toBeInTheDocument();
  cleanup();
  render(<ResearchAnalysisExample id="2014-naik-streetscore" language="en" />);
  expect(screen.getByText('Scaled 0–10')).toBeInTheDocument();
  expect(screen.queryByRole('button', { name: 'Add a tie' })).not.toBeInTheDocument();
  cleanup();
  render(<ResearchAnalysisExample id="2016-dubey-place" language="en" />);
  expect(screen.getByText('TrueSkill μ')).toBeInTheDocument();
  expect(screen.queryByRole('button', { name: 'Add a tie' })).not.toBeInTheDocument();
  cleanup();
  render(<ResearchAnalysisExample id="2017-liu-machine" language="en" />);
  expect(screen.getByText('Street wall continuous: yes for images 1–3, no for image 4, so the continuous share is 3/4.')).toBeInTheDocument();
  expect(screen.queryByText(/0\.6 − 0\.2/)).not.toBeInTheDocument();
  cleanup();
});

test('Docs home searches concepts and keeps reference pages distinct', async () => {
  mockDocId = undefined;
  await act(async () => { render(view()); });
  fireEvent.change(screen.getByLabelText('Search papers, concepts or methods'), { target: { value: 'Thermal Perception' } });
  expect(screen.getByRole('heading', { name: 'Thermal Comfort in Sight' })).toBeInTheDocument();
  expect(screen.queryByRole('heading', { name: 'Place Pulse 1.0' })).not.toBeInTheDocument();
});

test('Chinese editorial copy and section links are available', async () => {
  localStorage.setItem('sp-survey-language', 'zh');
  render(view());
  expect(screen.getByRole('heading', { name: '研究问题与感知概念' })).toBeInTheDocument();
  expect(screen.getByRole('link', { name: '查看计分示例' })).toHaveAttribute('href', '#worked-example');
  await waitFor(() => expect(screen.getByRole('button', { name: '试答示例题' })).toBeEnabled());
});

test.each(Object.keys(RESEARCH_GUIDES))('%s preview uses local demonstration media and never mutates the template', id => {
  const template = templates[id];
  const before = JSON.stringify(template);
  const result = researchPreviewSnapshot(template, RESEARCH_GUIDES[id].question);
  const question = result.surveyJson.pages[0].elements[0];
  expect(question.name).toBe(RESEARCH_GUIDES[id].question);
  expect(question.trialCount).toBe(1);
  expect(JSON.stringify(template)).toBe(before);
  if (id === '2025-yang-thermal') {
    expect(exampleTemplateMediaPrefix(template, RESEARCH_GUIDES[id].question)).toBe('templates/2025-yang-thermal/');
    expect(libraryExampleUrls({
      ...template,
      preloadedImages: [
        { url: 'https://media.example/templates/2025-yang-thermal/a.jpg', type: 'image' },
        { url: 'https://media.example/templates/2025-yang-thermal/b.jpg', type: 'image' },
      ],
    }, RESEARCH_GUIDES[id].question)).toEqual([
      'https://media.example/templates/2025-yang-thermal/a.jpg',
      'https://media.example/templates/2025-yang-thermal/b.jpg',
    ]);
    const study = researchPreviewSnapshot(template, RESEARCH_GUIDES[id].question, [
      'https://pub-6c5a1831a6254dd88b26e2dc199bfd94.r2.dev/templates/2025-yang-thermal/a.jpg',
      'https://pub-6c5a1831a6254dd88b26e2dc199bfd94.r2.dev/templates/2025-yang-thermal/b.jpg',
    ]);
    expect(JSON.stringify(study)).toMatch(/templates\/2025-yang-thermal\//);
    expect(JSON.stringify(study)).not.toMatch(/street-a\.jpg/);
    expect(JSON.stringify(template)).toBe(before);
  } else {
    expect(exampleTemplateMediaPrefix(template, RESEARCH_GUIDES[id].question)).toBe('');
    if (question.type === 'mapannotation') expect(JSON.stringify(result)).not.toMatch(/street-a\.jpg/);
    else expect(JSON.stringify(result)).toMatch(/\/docs\/research\/|\/hero\/streetscape-loop/);
  }
  expect(result).not.toHaveProperty('projectId');
  expect(result.surveyJson.showNavigationButtons).toBe(false);
  if (id === '2009-ewing-measuring') expect(question.requireMediaEnded).toBe(true);
  if (id === '2013-salesses-collaborative') expect(question.allowTie).toBe(true);
});

test.each(['en', 'zh'])('all method pages have translated content and working section links (%s)', async language => {
  localStorage.setItem('sp-survey-language', language);
  const { DOC_TOPICS } = require('./docsTopics');
  mockDocId = DOC_TOPICS[0].id;
  let rendered;
  await act(async () => { rendered = render(view()); });
  for (const topic of DOC_TOPICS) {
    mockDocId = topic.id;
    rendered.rerender(view());
    expect(screen.getByRole('heading', { level: 1, name: topic.title[language] })).toBeInTheDocument();
    for (const section of topic.sections) {
      expect(document.getElementById(section.id)).toHaveTextContent(section.title[language]);
    }
  }
});

test('method crosslinks resolve and search includes both languages', () => {
  const { DOC_TOPICS, topicMatches } = require('./docsTopics');
  const { PAPER_TEMPLATE_DOCS } = require('./paperTemplateDocs');
  const ids = new Set([...DOC_TOPICS, ...PAPER_TEMPLATE_DOCS].map(d => d.id).concat('paper-templates'));
  for (const topic of DOC_TOPICS) for (const id of topic.related) expect(ids.has(id)).toBe(true);
  expect(topicMatches(DOC_TOPICS.find(t => t.id === 'q-score'), 'Q score')).toBe(true);
  expect(topicMatches(DOC_TOPICS.find(t => t.id === 'trueskill'), '不确定性')).toBe(true);
  expect(topicMatches(DOC_TOPICS.find(t => t.id === 'icc'), 'ICC')).toBe(true);
  expect(topicMatches(DOC_TOPICS.find(t => t.id === 'icc'), '组内')).toBe(true);
});

test('comparison lab distinguishes ties, unscored images and reset', async () => {
  const { labScores, LAB_OUTCOMES } = require('../components/docs/ScoringLab');
  const tied = [...LAB_OUTCOMES, { tie: true, a: 'A', b: 'B' }];
  const baseline = labScores(LAB_OUTCOMES);
  const excluded = labScores(tied);
  expect(excluded[0].mu).toBe(baseline[0].mu);
  expect(excluded[0].qScore).not.toBe(baseline[0].qScore);
  expect(labScores(tied, { tieHandling: 'draw' })[0].sigma).not.toBe(excluded[0].sigma);
  expect(labScores(LAB_OUTCOMES, { minComparisons: 8 }).every(r => r.qScore == null)).toBe(true);
  mockDocId = 'trueskill';
  await act(async () => { render(view()); });
  fireEvent.click(screen.getByRole('button', { name: 'Add A/B tie' }));
  expect(screen.getByRole('status')).toHaveTextContent('7 comparisons');
  fireEvent.click(screen.getByRole('button', { name: 'Reset lab' }));
  expect(screen.getByRole('status')).toHaveTextContent('6 comparisons');
});


test.each(PAPER_TEMPLATE_DOCS)('$id has its full citation, sidebar shorthand and complete preview', async doc => {
  mockDocId = doc.id;
  const original = JSON.stringify(templates[doc.id]);
  render(view());
  const citation = screen.getByRole('region', { name: 'Full paper citation' });
  expect(citation).toHaveTextContent(doc.citation);
  expect(within(citation).getByRole('link')).toHaveAttribute('href', `https://doi.org/${doc.doi}`);
  const nav = docsNav();
  expect(within(nav).getByRole('link', { name: `${doc.shortCitation} ${doc.name}` })).toHaveAttribute('aria-current', 'page');
  const button = screen.getByRole('button', { name: 'Preview full template' });
  await waitFor(() => expect(button).toBeEnabled());
  fireEvent.click(button);
  await screen.findByTestId('full-template-renderer');
  expect(mockPreviewProps.config).toEqual(templates[doc.id].config);
  expect(mockPreviewProps.currentProject.preloadedImages).toEqual(templates[doc.id].preloadedImages || []);
  expect(mockPreviewProps.currentProject.imageDatasetConfig).toEqual(templates[doc.id].imageDatasetConfig || {});
  expect(mockPreviewProps.showMediaAssignment).toBe(false);
  expect(JSON.stringify(templates[doc.id])).toBe(original);
  fireEvent.click(screen.getByRole('button', { name: 'Close template preview' }));
  await waitFor(() => expect(screen.queryByTestId('full-template-renderer')).not.toBeInTheDocument());
});

test('Chinese reference page labels the full preview and keeps the citation available offline', async () => {
  localStorage.setItem('sp-survey-language', 'zh');
  mockDocId = '2017-seresinhe-scenic';
  global.fetch.mockRejectedValueOnce(new Error('offline'));
  render(view());
  await screen.findByText('模板加载失败。');
  expect(screen.getByRole('region', { name: '完整文章引用' })).toHaveTextContent('Seresinhe');
  expect(screen.getByRole('button', { name: '预览完整模板' })).toBeDisabled();
  fireEvent.click(screen.getByRole('button', { name: '重试' }));
  await waitFor(() => expect(screen.getByRole('button', { name: '预览完整模板' })).toBeEnabled());
  fireEvent.click(screen.getByRole('button', { name: '预览完整模板' }));
  await screen.findByTestId('full-template-renderer');
  expect(screen.getByRole('dialog')).toHaveAccessibleName('完整模板预览 · Scenic Beauty of Outdoor Places');
});

test('a promoted Chinese guide stays readable when the template cannot load', async () => {
  localStorage.setItem('sp-survey-language', 'zh');
  mockDocId = '2014-quercia-aesthetic';
  global.fetch.mockRejectedValueOnce(new Error('offline'));
  render(view());
  expect(await screen.findByText('模板未能加载；仍可阅读教程。')).toBeInTheDocument();
  expect(screen.getByRole('heading', { name: '研究问题与感知概念' })).toBeInTheDocument();
  expect(screen.getByRole('region', { name: '完整文章引用' })).toHaveTextContent('Quercia, D.');
  expect(screen.getByRole('button', { name: '试答示例题' })).toBeDisabled();
});

test('approved paper edits keep citations, the native template preview and interactive scoring', async () => {
  getWikiPage.mockResolvedValue({page_key:mockDocId,language:'en',title:'Reviewed Place Pulse guide',summary:'Community revision',body:'## Measurement\n\nA reviewed introduction with references.',contributor_name:'Research group',revision:1});
  render(view());
  await screen.findByRole('heading',{name:'Reviewed Place Pulse guide'});
  expect(screen.getAllByText(PAPER_TEMPLATE_DOCS.find(d=>d.id===mockDocId).citation).length).toBeGreaterThan(0);
  await waitFor(()=>expect(screen.getByRole('button',{name:'Preview full template'})).toBeEnabled());
  expect(screen.getByRole('button',{name:'Add a tie'})).toBeEnabled();
  fireEvent.click(screen.getByRole('button',{name:'Preview full template'}));
  await screen.findByTestId('full-template-renderer');
});

test('new community docs fall back to their published language and offer an edit link', async () => {
  mockDocId = 'community-test';
  getWikiPage.mockImplementation(async (key,language)=>language==='zh' ? {page_key:key,language:'zh',title:'社区研究教程',summary:'摘要',body:'## 方法\n\n社区作者的研究方法。',contributor_name:'研究者',revision:1} : null);
  render(view());
  await screen.findByRole('heading',{name:'社区研究教程'});
  expect(screen.getByRole('link',{name:'Suggest an edit'})).toHaveAttribute('href','/contribute?kind=doc_edit&target=community-test&language=zh');
});
