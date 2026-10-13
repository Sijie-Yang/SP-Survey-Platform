# SP-Scheme 2.0 (2026-10-13)

SP-Scheme lets a researcher build a whole survey with any external LLM (ChatGPT, Claude, Gemini, …) as one web page, and run that page on SP-Survey as both the Builder preview and the participant link. The model owns the interface; the platform keeps owning stimuli, question description and answer recording, so analysis, export, drafts and Silicon Samples work as for any survey.

## Flow

1. **Copy SP-Scheme** (or download `.md`) from the panel at the top of Survey Builder and paste it into a model with the study idea. The text is generated from the live catalogs (`src/lib/spScheme.js` → `buildSpSchemeText`): native question types, answer shapes, media sampling rules, the `SPSite` API and runtime limits.
2. The model builds `index.html`: the whole survey, any design. Inside `<head>` it embeds the survey JSON (`<script type="application/json" id="sp-scheme">`) and the **preview shim** (`SP_SITE_PREVIEW_SHIM`), which provides `SPSite` with placeholder images and a recorded-data panel, so the page works in the model's own preview. The researcher tries it and asks for changes until satisfied.
3. **Upload** the same `index.html`, or a zip holding it (optionally with `sp-scheme.json` and local CSS / JS / small images, which are inlined). Pasting the page's code also works. **Example** downloads a working sample.
4. `validateSpSchemePackage` checks it before anything changes:
   - the embedded survey JSON (or `sp-scheme.json`): `format`, `spScheme` major version 2, no credentials, no per-question HTML, no `skillquestion` when a page is present, every recorded question has a type a page can answer;
   - media questions use platform sampling; URLs are rejected unless the question is in curated mode;
   - the survey passes `validateSurveyConfig` after the usual AI post-processing;
   - the page (`checkSiteHtml`): under 3 MB, reads questions from `SPSite`, calls `SPSite.answer` and `SPSite.complete`, scripts only inline or from the allowed CDNs; network calls are flagged.
5. **Import into Builder** replaces pages and questions and stores the page, shim removed, as `config.spSite = { html, id, version, importedAt }`. Theme, logo and other settings are kept. Nothing is saved until the researcher saves. The panel shows when a page is active and can remove it.

## Runtime (`src/lib/spSite.js`, `SpSiteFrame`, `SpSiteSurvey`, `SpSitePreview`)

- `SurveyApp` loads and draws media exactly as before and builds the SurveyJS model, but when `spSite.html` exists it renders the page full-screen in a sandboxed iframe (`allow-scripts allow-forms allow-modals allow-popups`, no same-origin) instead of `<Survey>`. A CSP is injected first in `<head>`: no `connect-src`, scripts inline or from jsDelivr / cdnjs / unpkg / Tailwind CDN / esm.sh, images and media over https or data:.
- The injected SDK defines `window.SPSite` (`onReady`, `getQuestions`, `getQuestion`, `getSurvey`, `getAnswers`, `answer(name, value, { trial })`, `complete()`) and an in-memory `localStorage`.
- `buildSiteQuestions` sends each question with its wording, the media drawn for this participant (per trial for `trialCount > 1`) and the exact allowed values (for image choice types, `image_N` / `media_N` with `imageUrl`).
- Every answer is validated per native answer kind (`validateSiteAnswer`) before it reaches the model; trials are stored as `{ trials: [{ value, shown_images, shown_media_ids }] }` through the trials store, as `TrialShell` does. `complete()` checks required questions, then calls `model.doComplete()`, so submission, enrichment and the response contract are unchanged. Responses carry `survey_metadata.sp_site = { id, version }`.
- Builder preview shows the same page with the same media draw and a live panel of recorded answers; nothing is submitted.
- Participant drafts store the page metadata only; resume re-attaches the page from the current config. The Builder AI assistant does not receive the page and keeps it across its edits.
