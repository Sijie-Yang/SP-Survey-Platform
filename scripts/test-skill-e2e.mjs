/** E2E test: injection → JSON → SurveyJS Model → iframe payload. */
import { Serializer, Question, Model } from 'survey-core';
import { getPresetSkill } from '../src/lib/presetSkills.js';
import { ensureSkillDemoMedia, filterPoolForQuestion, applyMediaToElement } from '../src/lib/surveyMediaInjection.js';
import { readSkillQuestionFields } from '../src/lib/skillPostMessage.js';

Serializer.addClass('skillquestion', [
  { name: 'skillId', category: 'general' },
  { name: 'skillHtml', category: 'general' },
  { name: 'skillConfig', default: {}, category: 'general' },
  { name: 'skillImages', default: [], category: 'general' },
  { name: 'randomImageSelection:boolean', default: false, category: 'general' },
  { name: 'imageCount', default: 1, category: 'general' },
], () => new (class extends Question {
  getType() { return 'skillquestion'; }
})(), 'question');

const preset = getPresetSkill('emotion_color_picker');

// 1. Element as stored in survey config
const element = {
  type: 'skillquestion',
  name: 'likert_image',
  skillId: 'preset_emotion_color_picker',
  skillHtml: preset.sourceHtml,
  skillConfig: { ...preset.defaultConfig },
  randomImageSelection: true,
  imageCount: 1,
};
ensureSkillDemoMedia(element);

// 2. Inject real project media (simulates SurveyPreview PRIORITY 1)
const preloadedImages = [
  { name: 'r2-photo-1.jpg', url: 'https://r2.example.com/u/p/r2-photo-1.jpg', type: 'image' },
];
const pool = filterPoolForQuestion(preloadedImages, element);
applyMediaToElement(element, pool.slice(0, 1));

// 3. Deserialize through SurveyJS Model (this used to strip url/type)
const model = new Model({ pages: [{ name: 'p1', elements: [element] }] });
const q = model.getQuestionByName('likert_image');
console.log('after Model — q.skillImages:', JSON.stringify(q.skillImages));
console.log('after Model — injectedImages:', JSON.stringify(q.skillConfig?.injectedImages));

// 4. Build iframe payload exactly like the render path does
const { images } = readSkillQuestionFields(q);
console.log('payload images:', JSON.stringify(images));

const ok = images.length === 1 && images[0].url === 'https://r2.example.com/u/p/r2-photo-1.jpg';
console.log(ok ? '✅ real project image reaches iframe' : '❌ FAIL — demo leaked or url lost');
process.exit(ok ? 0 : 1);
