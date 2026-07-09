/** Generate a standalone test page for preset skill iframes (dev debugging). */
import { writeFileSync } from 'fs';
import { join } from 'path';
import { PRESET_SKILLS } from '../src/lib/presetSkills.js';
import { buildSkillSrcdoc } from '../src/lib/skillSdk.js';

const root = process.cwd();

const frames = PRESET_SKILLS.map((preset) => {
  const bootstrap = {
    config: preset.defaultConfig || {},
    images: preset.defaultConfig?.demoImages || [],
    value: null,
  };
  const srcdoc = buildSkillSrcdoc(preset.sourceHtml, bootstrap)
    .replace(/&/g, '&amp;')
    .replace(/"/g, '&quot;');
  return `<h2 style="font-family:sans-serif;">${preset.name} (${preset.id})</h2>
<iframe sandbox="allow-scripts allow-same-origin" srcdoc="${srcdoc}" style="width:100%;height:560px;border:1px solid #ccc;border-radius:8px;"></iframe>`;
}).join('\n');

const page = `<!DOCTYPE html><html><head><meta charset="utf-8"><title>Skill Test</title></head>
<body style="max-width:900px;margin:0 auto;padding:20px;background:#fafafa;">
<h1 style="font-family:sans-serif;">Preset Skill Smoke Test</h1>
${frames}
</body></html>`;

writeFileSync(join(root, 'public/skill-test.html'), page);
console.log('Wrote public/skill-test.html with', PRESET_SKILLS.length, 'presets');
