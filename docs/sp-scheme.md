# SP-Scheme (2026-10-13)

SP-Scheme lets a researcher design a survey with any external LLM (ChatGPT, Claude, Gemini, …) and bring it back into SP-Survey without losing analysis, export or Silicon Sample support.

Survey Builder shows the SP-Scheme panel first:

1. **Copy SP-Scheme** (or download `.md`). The text is generated from the live platform catalogs (`src/lib/spScheme.js` → `buildSpSchemeText`): question types and minimum examples, built-in tasks, media sampling rules, the custom interaction SDK, and the native result families. It updates whenever those catalogs change.
2. The researcher pastes it into a model with their study idea. The model may invent any interface; stimuli, wording and answer recording follow the scheme.
3. **Upload package** or **Paste and check**. `validateSpSchemePackage` checks the package before anything is saved:
   - `format`, `spScheme` major version, no credential fields;
   - every custom interaction passes the same save contract as the Skill editor (`prepareSkillForSave`: SDK calls, one native result field, matching `exampleAnswer`, no `analysisHtml`);
   - every `skillId: "custom:<ref>"` resolves, `preset_*` ids exist, no inline HTML on questions;
   - media questions use platform sampling; URLs are rejected unless the question is in curated mode;
   - the whole survey passes `validateSurveyConfig` after the usual AI post-processing.
4. **Import into Builder** saves each used custom interaction to the researcher's private interaction library, rewrites the references to the saved ids and revisions, and replaces pages and questions in the editor. Theme, logo and other project settings are kept. Nothing is written to the project until the researcher saves; publishing is unchanged.

Package shape:

```json
{
  "format": "sp-scheme-package",
  "spScheme": "1.0",
  "survey": { "title": "", "locale": "en", "pages": [] },
  "customInteractions": [{ "ref": "", "name": "", "sourceHtml": "", "configSchema": [], "defaultConfig": {}, "resultSchema": [{}], "exampleAnswer": {} }]
}
```

Limits are those of custom interactions today: one recorded answer per question (use `trialCount` for rounds), no network inside the sandbox, answers must map to an existing result family.
