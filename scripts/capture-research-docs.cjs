/**
 * Capture real participant previews for the four Docs guides.
 * Run a local npm start first. Requires Playwright (may be supplied via NODE_PATH).
 * Optional: DOCS_BASE_URL, DOCS_BROWSER_EXECUTABLE, DOCS_QA_DIR.
 * Uses a fresh browser context and the no-save /question-preview renderer.
 * Media are frames of the existing homepage video and a schematic city map.
 */
const { chromium } = require('playwright');
const fs = require('node:fs');
const path = require('node:path');
const { createHash } = require('node:crypto');
const root = path.resolve(__dirname, '..');
const output = path.join(root, 'public/docs/research');
const base = process.env.DOCS_BASE_URL || 'http://127.0.0.1:4000';
const ids = ['2013-salesses-collaborative', '1990-nasar-evaluative', '2009-ewing-measuring', '2025-yang-thermal'];
(async () => {
  const browser = await chromium.launch({ headless: true, ...(process.env.DOCS_BROWSER_EXECUTABLE ? { executablePath: process.env.DOCS_BROWSER_EXECUTABLE } : {}) });
  try {
    const page = await browser.newPage({ viewport: { width: 1440, height: 1100 }, deviceScaleFactor: 2 });
    await page.addInitScript(() => localStorage.setItem('sp-survey-language', 'en'));
    const errors = [];
    page.on('pageerror', error => errors.push(error.message));
    await page.goto(`${base}/docs`);
    for (const [name, time] of [['street-a', 2], ['street-b', 10]]) {
      const data = await page.evaluate(async time => {
        const video = document.createElement('video');
        // Buffer the clip so seeking works even on preview servers without Range support.
        const blobUrl = URL.createObjectURL(await (await fetch('/hero/streetscape-loop.mp4')).blob());
        video.src = blobUrl; video.muted = true;
        await new Promise((resolve, reject) => { video.onloadeddata = resolve; video.onerror = reject; });
        const seeked = new Promise(resolve => video.onseeked = resolve);
        video.currentTime = Math.min(time, video.duration - 0.1); await seeked;
        const canvas = document.createElement('canvas'); canvas.width = 960; canvas.height = 540;
        canvas.getContext('2d').drawImage(video, 0, 0, 960, 540);
        const result = canvas.toDataURL('image/jpeg', 0.87).split(',')[1];
        URL.revokeObjectURL(blobUrl);
        return result;
      }, time);
      fs.writeFileSync(path.join(output, `${name}.jpg`), Buffer.from(data, 'base64'));
    }
    if (fs.readFileSync(path.join(output, 'street-a.jpg')).equals(fs.readFileSync(path.join(output, 'street-b.jpg')))) {
      throw new Error('Video seeking returned duplicate demonstration frames');
    }
    for (const id of ids) {
      await page.goto(`${base}/docs/${id}`);
      await page.getByRole('button', { name: 'Try the example', exact: true }).click();
      const frame = await page.locator('iframe').elementHandle().then(el => el.contentFrame());
      await frame.waitForSelector('.sd-question');
      await frame.evaluate(async () => {
        await document.fonts.ready;
        await Promise.all([...document.images].map(img => img.complete ? Promise.resolve() : new Promise(resolve => { img.onload = resolve; img.onerror = resolve; })));
        if ([...document.images].some(img => !img.naturalWidth && !img.classList.contains('leaflet-tile'))) throw new Error('Preview image failed to load');
      });
      await page.setViewportSize({ width: 1440, height: 3200 });
      await page.locator('iframe').evaluate(el => { el.style.height = '2700px'; });
      await page.locator('.MuiDialog-paper').evaluate(el => { el.style.maxHeight = 'none'; el.style.height = '3000px'; });
      if (id === '2009-ewing-measuring') {
        // Playback unlocks the rating matrix. Seeking afterward keeps that unlock and shows two scenes.
        await frame.locator('video').first().evaluate(async video => {
          video.muted = true;
          if (video.readyState < 1) await new Promise((resolve, reject) => { video.onloadeddata = resolve; video.onerror = reject; });
          const ended = new Promise(resolve => video.addEventListener('ended', resolve, { once: true }));
          video.currentTime = Math.max(0, video.duration - 0.05);
          await video.play();
          await ended;
        });
        await frame.getByText('Please play the media to the end before answering.').waitFor({ state: 'hidden' });
        for (const scene of [{ file: 'scene-a', time: 1.2 }, { file: 'scene-b', time: 7 }]) {
          await frame.locator('video').first().evaluate(async (video, time) => {
            video.pause();
            const seeked = new Promise(resolve => { video.onseeked = resolve; });
            video.currentTime = time;
            await seeked;
          }, scene.time);
          await frame.locator('.sd-question').first().screenshot({ path: path.join(output, `${id}-${scene.file}.png`) });
        }
      } else if (id === '1990-nasar-evaluative') {
        for (const city of ['knoxville', 'chattanooga']) {
          await frame.evaluate(async (city) => {
            const el = document.querySelector('.sd-question');
            const key = Object.getOwnPropertyNames(el).find((name) => name.startsWith('__reactFiber'));
            let fiber = el[key];
            while (fiber && !(fiber.memoizedProps && fiber.memoizedProps.element && fiber.memoizedProps.element.getType)) fiber = fiber.return;
            const question = fiber.memoizedProps.element;
            question.survey.setValue('city', city);
            question.survey.render();
            const label = city === 'knoxville' ? 'Knoxville' : 'Chattanooga';
            for (let i = 0; i < 40; i += 1) {
              const tiles = [...document.querySelectorAll('.leaflet-tile')];
              const pending = tiles.filter((tile) => !tile.complete || !tile.naturalWidth);
              if (document.body.innerText.includes(`City: ${label}`) && tiles.length >= 6 && pending.length === 0) return;
              await new Promise((resolve) => setTimeout(resolve, 200));
            }
            throw new Error(`Map tiles did not settle for ${city}`);
          }, city);
          await frame.locator('.sd-question').first().screenshot({ path: path.join(output, `${id}-${city}.png`) });
        }
      } else {
        await frame.locator('.sd-question').first().screenshot({ path: path.join(output, `${id}-preview.png`) });
      }
      await page.getByRole('button', { name: 'Close preview', exact: true }).click();
      await page.setViewportSize({ width: 1440, height: 1100 });
      console.log(`Captured ${id}`);
    }
    const manifest = {
      capturedAt: new Date().toISOString(),
      renderer: 'src/components/admin/QuestionPreviewPage.js',
      reproduction: 'node scripts/capture-research-docs.cjs (Playwright via NODE_PATH if needed; DOCS_BROWSER_EXECUTABLE optional)',
      scope: 'One trial copied from each bundled template; original English wording; no responses saved. Ewing screenshots are the same rating question after playback, paused on two different scenes of the homepage video. The Nasar guide shows the same map question after Knoxville and after Chattanooga are selected.',
      demonstrationMedia: [
        { files: ['street-a.jpg', 'street-b.jpg'], source: 'public/hero/streetscape-loop.mp4', timesSeconds: [2, 'min(10, duration - 0.1)'], note: 'Existing platform homepage footage. Not original study stimuli.' },
        { files: ['demo-city.svg'], source: 'Schematic drawn for Docs; fictional city; no geographic coordinates.' },
      ],
      screenshots: ids.flatMap(id => {
        const template = `public/project_templates/${id}.json`;
        const templateSha256 = createHash('sha256').update(fs.readFileSync(path.join(root, template))).digest('hex');
        const files = id === '1990-nasar-evaluative'
          ? [`${id}-knoxville.png`, `${id}-chattanooga.png`]
          : id === '2009-ewing-measuring'
            ? [`${id}-scene-a.png`, `${id}-scene-b.png`]
            : [`${id}-preview.png`];
        return files.map(file => ({ file, template, templateSha256 }));
      }),
    };
    fs.writeFileSync(path.join(output, 'provenance.json'), JSON.stringify(manifest, null, 2) + '\n');
    if (process.env.DOCS_QA_DIR) {
      fs.mkdirSync(process.env.DOCS_QA_DIR, { recursive: true });
      await page.goto(`${base}/docs`);
      await page.getByRole('heading', { name: 'From perception to research practice.' }).waitFor();
      await page.screenshot({ path: path.join(process.env.DOCS_QA_DIR, 'docs-desktop.png'), fullPage: true });
      await page.setViewportSize({ width: 390, height: 844 });
      await page.goto(`${base}/docs/2013-salesses-collaborative`);
      await page.getByRole('heading', { name: 'Place Pulse 1.0', exact: true }).waitFor();
      const overflow = await page.evaluate(() => document.documentElement.scrollWidth > document.documentElement.clientWidth);
      if (overflow) throw new Error('Mobile Docs has horizontal overflow');
      await page.screenshot({ path: path.join(process.env.DOCS_QA_DIR, 'docs-mobile.png'), fullPage: true });
    }
    if (errors.length) throw new Error(errors.join('\n'));
  } finally { await browser.close(); }
})().catch(error => { console.error(error); process.exitCode = 1; });
