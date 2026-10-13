# SP-Scheme (2026-10-13)

SP-Scheme lets a researcher design a survey with any external LLM (ChatGPT, Claude, Gemini, …) and bring it back into SP-Survey without losing analysis, export or Silicon Sample support.

Survey Builder shows the SP-Scheme panel first. The flow is written for non-technical researchers:

1. **Copy SP-Scheme** (or download `.md`) and paste it into a model with the study idea. The text is generated from the live platform catalogs (`src/lib/spScheme.js` → `buildSpSchemeText`): question types and minimum examples, built-in tasks, media sampling rules, the custom interaction SDK, and the native result families.
2. The scheme tells the model to build a **clickable prototype** (`preview.html`) first and let the researcher try every page and interaction in its preview, showing the JSON each question would record. Each interaction file carries a **preview shim** (`SP_PREVIEW_SHIM`) that supplies placeholder images and an on-screen answer readout outside the platform. Only after the researcher confirms does the model pack the study.
3. **Upload zip.** Layout:

   ```
   <study>.zip
   ├── sp-scheme.json            survey + customInteractions (each with "file")
   ├── interactions/<ref>.html   one file per custom interaction
   └── preview.html              prototype, kept for reference, not imported
   ```

   The zip may be wrapped in one folder; macOS metadata is ignored; zips over 10 MB or expanding beyond 25 MB are refused. A bare `sp-scheme.json` with inline `sourceHtml` is still accepted (Paste JSON) for models that cannot make files. **Example zip** downloads a working sample.
4. `validateSpSchemePackage` checks the package before anything is saved:
   - `format`, `spScheme` major version, no credential fields;
   - every interaction file is present; the preview shim is stripped; each interaction passes the same save contract as the Skill editor (`prepareSkillForSave`: SDK calls, one native result field, matching `exampleAnswer`, no `analysisHtml`);
   - every `skillId: "custom:<ref>"` resolves, `preset_*` ids exist, no inline HTML on questions;
   - media questions use platform sampling; URLs are rejected unless the question is in curated mode;
   - the whole survey passes `validateSurveyConfig` after the usual AI post-processing.
5. **Import into Builder** saves each used custom interaction to the researcher's private interaction library, rewrites the references to the saved ids and revisions, and replaces pages and questions in the editor. Theme, logo and other project settings are kept. Nothing is written to the project until the researcher saves; publishing is unchanged.

Limits are those of custom interactions today: one recorded answer per question (use `trialCount` for rounds), no network inside the sandbox, answers must map to an existing result family.
