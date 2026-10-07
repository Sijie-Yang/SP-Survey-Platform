import {
  applyContentWidthToModel,
  configForPreviewRefresh,
  movePage,
  moveQuestion,
  resolvePublishedFrame,
  setViewportLayoutField,
  updatePageText,
  updateQuestionText,
  updateSurveyText,
  viewportSlot,
} from './viewportLayout';

const config = {
  title: 'Study',
  pages: [
    {
      name: 'p1',
      title: 'Intro',
      description: 'Welcome',
      elements: [
        { type: 'text', name: 'q1', title: 'Alpha', description: 'First' },
        { type: 'text', name: 'q2', title: 'Beta' },
      ],
    },
    {
      name: 'p2',
      title: 'Next',
      elements: [{ type: 'text', name: 'q3', title: 'Gamma' }],
    },
  ],
};

test('media size and content width are stored separately per viewport', () => {
  const desktopMedia = setViewportLayoutField(config, 'desktop', 'mediaMaxHeight', 400);
  const both = setViewportLayoutField(desktopMedia, 'mobile', 'mediaMaxHeight', 220);
  const sized = setViewportLayoutField(both, 'desktop', 'contentWidth', 1040);
  expect(sized.viewportLayout.desktop).toEqual({ mediaMaxHeight: 400, contentWidth: 1040 });
  expect(sized.viewportLayout.mobile).toEqual({ mediaMaxHeight: 220 });
  expect(viewportSlot(sized, 'mobile').contentWidth).toBe(390);
  expect(viewportSlot(sized, 'mobile').contentWidthSaved).toBe(false);
  expect(resolvePublishedFrame(sized, 1280)).toEqual({
    viewport: 'desktop',
    contentWidth: 1040,
    questionWidth: null,
    mediaMaxHeight: 400,
  });
  expect(resolvePublishedFrame(sized, 390)).toEqual({
    viewport: 'mobile',
    contentWidth: null,
    questionWidth: null,
    mediaMaxHeight: 220,
  });
  expect(resolvePublishedFrame(config, 1280)).toEqual({
    viewport: 'desktop',
    contentWidth: null,
    questionWidth: null,
    mediaMaxHeight: null,
  });
  const model = {};
  applyContentWidthToModel(model, sized.viewportLayout.desktop.contentWidth);
  expect(model).toEqual({ widthMode: 'static', width: '1040px' });
});

test('question and page text and order are shared across viewports', () => {
  const sized = setViewportLayoutField(
    setViewportLayoutField(config, 'desktop', 'mediaMaxHeight', 400),
    'mobile',
    'contentWidth', 320,
  );
  const titled = updateQuestionText(sized, 'q1', 'title', 'Alpha edited');
  const described = updatePageText(titled, 'p1', 'description', 'Hello');
  const reordered = moveQuestion(described, 'q1', 1);
  const pagesMoved = movePage(reordered, 'p1', 1);
  expect(pagesMoved.viewportLayout).toEqual(sized.viewportLayout);
  expect(pagesMoved.pages.map((page) => page.name)).toEqual(['p2', 'p1']);
  expect(pagesMoved.pages[1].description).toBe('Hello');
  expect(pagesMoved.pages[1].elements.map((element) => element.name)).toEqual(['q2', 'q1']);
  expect(pagesMoved.pages[1].elements[1].title).toBe('Alpha edited');
  expect(moveQuestion(config, 'q1', -1)).toBe(config);
  expect(updateQuestionText(titled, 'q1', 'title', 'Alpha edited')).toBe(titled);
});

test('question card width is stored per viewport and stays inside the content width', () => {
  const desktopCard = setViewportLayoutField(config, 'desktop', 'questionWidth', 720);
  const both = setViewportLayoutField(desktopCard, 'mobile', 'questionWidth', 300);
  expect(both.viewportLayout.desktop).toEqual({ questionWidth: 720 });
  expect(both.viewportLayout.mobile).toEqual({ questionWidth: 300 });
  expect(viewportSlot(both, 'desktop').questionWidth).toBe(720);
  expect(viewportSlot(both, 'mobile').questionWidth).toBe(300);
  expect(resolvePublishedFrame(both, 1280).questionWidth).toBe(720);
  const widerCard = setViewportLayoutField(
    setViewportLayoutField(config, 'desktop', 'contentWidth', 800),
    'desktop',
    'questionWidth',
    1100,
  );
  expect(widerCard.viewportLayout.desktop.questionWidth).toBe(1100);
  expect(viewportSlot(widerCard, 'desktop').questionWidth).toBe(800);
  expect(resolvePublishedFrame(widerCard, 1280)).toMatchObject({
    contentWidth: 800,
    questionWidth: 800,
  });
  expect(updateSurveyText(config, 'title', 'Renamed').title).toBe('Renamed');
  expect(updateSurveyText(config, 'logo', 'https://example.com/logo.png').logo).toBe('https://example.com/logo.png');
  expect(updateSurveyText(config, 'title', 'Study')).toBe(config);
});

test('preview refresh ignores text and viewport size but keeps question order', () => {
  const sized = setViewportLayoutField(config, 'desktop', 'contentWidth', 1000);
  const retitled = updateQuestionText(sized, 'q2', 'title', 'Beta edited');
  const headed = updateSurveyText(updateSurveyText(retitled, 'title', 'Other'), 'logo', 'https://example.com/a.png');
  expect(configForPreviewRefresh(headed)).toEqual(configForPreviewRefresh(config));
  expect(configForPreviewRefresh(moveQuestion(config, 'q1', 1))).not.toEqual(configForPreviewRefresh(config));
});
