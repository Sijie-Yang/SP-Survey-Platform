# SP-Scheme 2.0 (2026-10-13)

SP-Scheme lets a researcher build a whole survey with any external LLM (ChatGPT, Claude, Gemini, …) as one web page, and run that page on SP-Survey as both the Builder preview and the participant link. The model owns the interface; the platform keeps owning stimuli, question description and answer recording, so analysis, export, drafts and Silicon Samples work as for any survey.

## Flow

1. **Copy SP-Scheme** (or download `.md`) from the panel at the top of Survey Builder and paste it into a model with the study idea. The text is generated from the live catalogs (`src/lib/spScheme.js` → `buildSpSchemeText`): native question types, answer shapes, media sampling rules, the `SPSite` API and runtime limits.
2. The model builds `index.html`: the whole survey, any design. Inside `<head>` it embeds the survey JSON (`<script type="application/json" id="sp-scheme">`) and the **preview shim** (`SP_SITE_PREVIEW_SHIM`), which provides `SPSite` with placeholder images and a recorded-data panel, so the page works in the model's own preview. The researcher tries it and asks for changes until satisfied.
3. **Upload** a zip: `index.html` plus every file it uses (stimulus images as real files in their folders, CSS, JS, data). Stimuli must be image files, never pictures the code draws. A lone `index.html` or pasted code is still accepted and runs as is. **Example** downloads a working sample.
4. `validateSpSchemePackage` checks it before anything changes:
   - the embedded survey JSON (or `sp-scheme.json`): `format`, `spScheme` major version 2, no credentials, no per-question HTML, no `skillquestion` when a page is present, every recorded question has a type a page can answer;
   - media questions use platform sampling; URLs are rejected unless the question is in curated mode;
   - the survey passes `validateSurveyConfig` after the usual AI post-processing;
   - the page (`checkSiteHtml`): under 3 MB, reads questions from `SPSite`, calls `SPSite.answer` and `SPSite.complete`, scripts only inline or from the allowed CDNs; network calls are flagged.
5. **Import into Builder** replaces pages and questions and stores the page, shim removed, as `config.spSite = { html, id, version, importedAt }`. Theme, logo and other settings are kept. Nothing is saved until the researcher saves. The panel shows when a page is active and can remove it.

## Runtime (`src/lib/spSite.js`, `SpSiteFrame`, `SpSiteSurvey`, `SpSitePreview`)

- `SurveyApp` loads and draws media exactly as before and builds the SurveyJS model, but when `spSite.html` exists it renders the page full-screen in a sandboxed iframe (`allow-scripts allow-forms allow-modals allow-popups`, no same-origin) instead of `<Survey>`. A CSP is injected first in `<head>`: no `connect-src` except allowed domains, scripts inline or from jsDelivr / cdnjs / unpkg / Tailwind CDN / esm.sh, images and media over https or data:.
- The injected SDK defines `window.SPSite` (`onReady`, `getQuestions`, `getQuestion`, `getSurvey`, `getAnswers`, `getMedia(folder)`, `answer(name, value, { trial } | { key, shown })`, `complete()`, `onRequest`, `onSubmit`) and an in-memory `localStorage`.
- **Three levels of match.** The platform never refuses a page for not matching; it says what it can do with the data (`siteMatchLevel`: shown in the SP-Scheme panel, the Builder preview and the Results page).
  - *Full*: every question uses a platform type: validated answers, platform analysis.
  - *Partial / custom*: some or all questions are `type: "custom"`: any JSON (≤ 32 KB), stored and exported as is, never analysed (the Results card says so instead of drawing a chart).
  - *None*: no questions declared. Every request the page sends that no handler answers is kept raw under `responses.__sp_requests` (`{ at, kind, method, url, data }`, max 500, exported as one JSON column), the participant submits from a bar under the page or when the page sends a request matching `spSite.completeOn` (default `finish|complete|submit|done|final`).
- **Page-drawn media.** A page that has its own randomisation declares `survey.mediaFolders` (stored as `spSite.mediaFolders`) and reads whole folders with `SPSite.getMedia(folder)` (`SpSiteSurvey` / `SpSitePreview` pass the project's media grouped by folder, only the folders named, max 2000 files). Answers are recorded with `{ key, shown }`: one record per item, stored as `{ trials: [{ value, shown_images, shown_media_ids, key }] }`, so export and per-trial analysis work as for platform-drawn rounds. Same-site image URLs naming a known file (`/image/IMG0279?…`) are rewritten to that file's URL by the SDK.
- **The library is the page's folder.** Files the page names by relative path (`<img src="images/a.jpg">`, inline CSS `url(...)`) are served from the media library (same folder path, else same file name), linked or not (`pageReferencedFiles`). An empty image list in the page's code (`const PHOTO_URLS = []`) is filled with the linked folders' images, or the library root when none is linked, in a random order per participant, so the page never shows pictures it draws itself; the list each participant got is kept as `__sp_page_state["sp-media:NAME"]`. Results analysis replaces the page's own ids with the image at that position in that participant's list (`mapRecordsToMedia`).
- `buildSiteQuestions` sends each question with its wording, the media drawn for this participant (per trial for `trialCount > 1`) and the exact allowed values (for image choice types, `image_N` / `media_N` with `imageUrl`).
- Every answer is validated per native answer kind (`validateSiteAnswer`) before it reaches the model; trials are stored as `{ trials: [{ value, shown_images, shown_media_ids }] }` through the trials store, as `TrialShell` does. `complete()` checks required questions, then calls `model.doComplete()`, so submission, enrichment and the response contract are unchanged. Responses carry `survey_metadata.sp_site = { id, version }`.
- Builder preview shows the same page with the same media draw and a live panel of recorded answers; nothing is submitted.
- Participant drafts store the page metadata only; resume re-attaches the page from the current config. The Builder AI assistant does not receive the page and keeps it across its edits.

## Pages that do not match SP-Scheme: imported as they are

Any survey page can be uploaded, including a complete hand-made one that loads data from or posts results to its own server (fetch, XHR, form posts, Google Forms, Apps Script, …). When the page has no valid SP-Scheme block, the check dialog says so and imports it **as it is** (`src/lib/spSchemeAsIs.js`, no model involved):

1. The page is kept unchanged; an empty SP-Scheme block (no questions) replaces any invalid one, so the page's own interaction logic (which images go together, its own randomisation) is exactly what participants get.
2. Media files in the zip go to the project's media library in the zip's own folders (`images/…`) and those folders are linked as the page's folders (`spSite.mediaFolders`); the page's relative paths resolve to them, and an empty image list is filled from them in a random order per participant. Text files (`.json`, `.csv`, `.txt`) are embedded for `SPSite.getData`.
3. The domains the page uses are listed; the researcher ticks only the ones it must load from (`spSite.allowedHosts`). A script from an unticked domain is blocked and the dialog warns that the page may break.
4. `spSite.convertedFrom` marks the import. Results then shows one "All page records" card, no per-question analysis, and a single ZIP export (answers CSV + every record as stored + README); the Builder shows the page read-only. The records are `__sp_page_state` (what the page saved in its own storage) and `__sp_requests` (every request it sent with data). The page submits when it calls `SPSite.complete()` or saves `{"done": true}`; otherwise participants use the bar under the page.

A page that carries an SP-Scheme block with problems is also offered as is; the dialog lists the problems so the block can be fixed and the page re-uploaded for the platform's analysis. The online model conversion that used to stand here was removed on 2026-10-15: the free model mapped questions unreliably, and anything that must be right lives in deterministic platform code.

At run time the SDK keeps every request to a domain that is not allowed inside the page: a GET fails, while a POST, `sendBeacon` or form submission resolves as a success and its payload is recorded under `__sp_requests`. The page keeps its own design and thank-you step; results are recorded only by SP-Survey.

### Whole projects and web links

- **Project zip.** A zip of a whole study (page, config, stimulus images) is read as one upload. Media files the page does not embed are the study's stimuli and keep the zip's own folder layout: on import they are uploaded to the project's media library under the same folders before the survey is loaded (`src/lib/spSchemeMediaImport.js`). Zips up to 200 MB are accepted. This applies to SP-Scheme pages and as-is pages alike.
- **Web link.** "Paste code or link" also takes a survey's address. The worker fetches the page (`POST /api/agent/sp-scheme/fetch-page`), inlines its same-site scripts and stylesheets, adds a `<base>` to the original site and returns the small data files its code mentions. The original site is listed (and ticked) as an allowed domain, so the page keeps loading its images from there; it is imported as it is unless it carries a valid SP-Scheme block.
