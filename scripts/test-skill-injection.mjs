/** Integration test: skill question media injection pipeline (dev debugging). */
import { PRESET_SKILLS, getPresetSkill } from '../src/lib/presetSkills.js';
import {
  ensureSkillDemoMedia, filterPoolForQuestion, applyMediaToElement, defaultMediaCount,
  isRandomMediaQuestion,
} from '../src/lib/surveyMediaInjection.js';
import { readSkillQuestionFields, toSkillInitPayload } from '../src/lib/skillPostMessage.js';

const preset = getPresetSkill('emotion_color_picker');

// Simulate a question as stored in survey config after QuestionEditor
const element = {
  type: 'skillquestion',
  name: 'q_skill_1',
  skillId: 'preset_emotion_color_picker',
  skillHtml: preset.sourceHtml,
  skillConfig: { ...preset.defaultConfig },
  randomImageSelection: true,
  imageSelectionMode: 'huggingface_random',
  imageCount: 1,
};

// Simulate resolveSkillQuestions merge (without supabase)
element.skillConfig = { ...preset.defaultConfig, ...element.skillConfig };
if (preset.defaultConfig?.demoImages?.length) {
  element.skillConfig.demoImages = preset.defaultConfig.demoImages;
}
ensureSkillDemoMedia(element);

console.log('--- after resolve/ensure ---');
console.log('isRandomMediaQuestion:', isRandomMediaQuestion(element));
console.log('skillImages[0].url starts with:', element.skillImages?.[0]?.url?.slice(0, 40));

// Simulate project preloaded images (real R2/HF urls)
const preloadedImages = [
  { name: 'real-photo-1.jpg', url: 'https://r2.example.com/user/proj/real-photo-1.jpg', type: 'image' },
  { name: 'real-photo-2.jpg', url: 'https://r2.example.com/user/proj/real-photo-2.jpg', type: 'image' },
];

// Simulate SurveyApp/SurveyPreview PRIORITY 1 injection
const pool = filterPoolForQuestion(preloadedImages, element);
console.log('\n--- injection ---');
console.log('pool size:', pool.length);
const imageCount = element.imageCount || defaultMediaCount(element);
const selected = pool.slice(0, imageCount);
applyMediaToElement(element, selected);
console.log('skillImages after inject:', JSON.stringify(element.skillImages));

// Simulate SurveyJS question render → SkillQuestionFrame
const fakeQuestion = {
  skillId: element.skillId,
  skillConfig: element.skillConfig,
  skillImages: element.skillImages,
  value: null,
};
const fields = readSkillQuestionFields(fakeQuestion);
console.log('\n--- payload to iframe ---');
console.log('images count:', fields.images.length);
fields.images.forEach((img) => console.log('  ', img.name, '→', img.url.slice(0, 60)));

const isReal = fields.images.every((img) => img.url.startsWith('https://r2.example.com'));
console.log('\nRESULT:', isReal ? '✅ real project images win' : '❌ demo images leaked');

// Also verify: toSkillInitPayload prefers demoImages only when images empty
const emptyCase = toSkillInitPayload(element.skillConfig, [], null);
console.log('empty-images fallback uses demo:', emptyCase.images[0]?.url?.startsWith('data:') ? '✅' : '❌', emptyCase.images.length, 'images');
