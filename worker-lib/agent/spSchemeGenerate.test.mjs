import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { buildExampleSite } from '../../src/lib/spScheme.js';
import {
  checkGeneratedPage,
  extractHtml,
  extractReply,
  writeSpSchemePage,
} from './spSchemeGenerate.mjs';

const GOOD = buildExampleSite().trim();
const PLAIN = '<!doctype html><html><head><title>x</title></head><body><p>Hello</p></body></html>';
const ROUTE = { apiKey: 'sk', provider: 'deepseek', baseUrl: 'https://x', model: 'deepseek-flash', modelRecord: { maxTokens: 8000 } };

function fakeChat(answers) {
  const calls = [];
  const chat = async (options) => {
    calls.push(options);
    return { content: answers[Math.min(calls.length - 1, answers.length - 1)] };
  };
  return { chat, calls };
}

const fenced = (html, note = '') => `${note}\n\`\`\`html\n${html}\n\`\`\``;

describe('SP-Scheme page writer', () => {
  it('pulls the page and the note out of an answer', () => {
    assert.equal(extractHtml(fenced(PLAIN, 'Here you go:')), PLAIN);
    assert.equal(extractHtml(`sure ${PLAIN} trailing`), PLAIN);
    assert.equal(extractHtml('no page here'), '');
    assert.equal(extractReply(fenced(PLAIN, 'Added an age question.')), 'Added an age question.');
    assert.equal(extractReply(PLAIN), '');
  });

  it('checks pages with the Studio import check', () => {
    const good = checkGeneratedPage(GOOD);
    assert.equal(good.ok, true);
    assert.equal(good.asIs, false);
    assert.equal(checkGeneratedPage(PLAIN).asIs, true);
  });

  it('rejects an empty request', async () => {
    const { chat } = fakeChat(['']);
    await assert.rejects(writeSpSchemePage({ chat, route: ROUTE, request: '  ' }), /Say what/);
  });

  it('sends problems back and returns the repaired page', async () => {
    const { chat, calls } = fakeChat([fenced(PLAIN, 'Made it.'), fenced(GOOD, 'Fixed.')]);
    const out = await writeSpSchemePage({ chat, route: ROUTE, request: 'Rate street safety' });
    assert.equal(out.rounds, 2);
    assert.equal(out.passed, true);
    assert.equal(out.html, GOOD);
    assert.equal(out.reply, 'Made it.');
    assert.equal(calls[0].model, 'deepseek-flash');
    assert.match(calls[0].messages[0].content, /SP-Scheme/);
    assert.match(calls[1].messages.at(-1).content, /found these problems/);
  });

  it('stops after the repair rounds and reports what is still wrong', async () => {
    const { chat, calls } = fakeChat([fenced(PLAIN)]);
    const out = await writeSpSchemePage({ chat, route: ROUTE, request: 'x' });
    assert.equal(calls.length, 3);
    assert.equal(out.passed, false);
    assert.ok(out.check.problems.length > 0);
  });

  it('changes the current page when one is given', async () => {
    const { chat, calls } = fakeChat([fenced(GOOD)]);
    await writeSpSchemePage({ chat, route: ROUTE, request: 'Make the button green', currentHtml: GOOD });
    assert.equal(calls.length, 1);
    assert.match(calls[0].messages[1].content, /current index\.html/);
    assert.match(calls[0].messages[1].content, /Make the button green/);
  });
  describe('with the study media library', () => {
    const LIBRARY = [1, 2, 3].map((n) => ({
      url: `https://media.test/u1/p1/streets/IMG_${n}__236a3465-ef58-4c35-9ee7-7e1a3a4fc833.jpg`,
      key: `u1/p1/streets/IMG_${n}__236a3465-ef58-4c35-9ee7-7e1a3a4fc833.jpg`,
      name: `IMG_${n}__236a3465-ef58-4c35-9ee7-7e1a3a4fc833.jpg`,
      folder: 'streets',
    }));
    // Passes the check, but reads a folder and names a file the library does not have.
    const MISFIT = GOOD.replace('</body>', "<script>var extra = SPSite.getMedia('photos'); var first = 'lawnA_1slight.jpg';</script></body>");

    it('tells the model what the library holds, under the names pages use', async () => {
      const { chat, calls } = fakeChat([fenced(GOOD, 'Done.')]);
      const out = await writeSpSchemePage({ chat, route: ROUTE, request: 'Use my street photos', mediaLibrary: LIBRARY, mediaPrefix: 'u1/p1/' });
      const first = calls[0].messages[1].content;
      assert.match(first, /folder "streets", 3 images: IMG_1\.jpg, IMG_2\.jpg, IMG_3\.jpg/);
      assert.doesNotMatch(first, /236a3465/);
      assert.match(first, /Use my street photos/);
      assert.equal(out.rounds, 1);
      assert.deepEqual(out.check.mediaNotes, []);
    });

    it('says so when the library is empty, and says nothing when there is no study', async () => {
      const empty = fakeChat([fenced(GOOD)]);
      await writeSpSchemePage({ chat: empty.chat, route: ROUTE, request: 'Rate streets', mediaLibrary: [] });
      assert.match(empty.calls[0].messages[1].content, /media library is empty/);
      const none = fakeChat([fenced(GOOD)]);
      await writeSpSchemePage({ chat: none.chat, route: ROUTE, request: 'Rate streets' });
      assert.equal(none.calls[0].messages[1].content, 'Rate streets');
    });

    it('gives a page that does not fit the library one round to fit it', async () => {
      const { chat, calls } = fakeChat([fenced(MISFIT, 'Made it.'), fenced(GOOD, 'Fitted.')]);
      const out = await writeSpSchemePage({ chat, route: ROUTE, request: 'Use my street photos', currentHtml: MISFIT, mediaLibrary: LIBRARY });
      assert.equal(checkGeneratedPage(MISFIT).ok, true);
      assert.equal(out.rounds, 2);
      assert.match(calls[1].messages.at(-1).content, /media folder "photos"/);
      assert.match(calls[1].messages.at(-1).content, /lawnA_1slight\.jpg/);
      assert.equal(out.html, GOOD);
      assert.equal(out.passed, true);
      assert.deepEqual(out.check.mediaNotes, []);
    });

    it('asks once only, keeps the page and reports what the library lacks', async () => {
      const { chat } = fakeChat([fenced(MISFIT, 'Made it.')]);
      const out = await writeSpSchemePage({ chat, route: ROUTE, request: 'Add a folder photos for later', mediaLibrary: LIBRARY });
      assert.equal(out.rounds, 2);
      assert.equal(out.passed, true);
      assert.equal(out.html, MISFIT);
      assert.equal(out.check.mediaNotes.length, 2);
      assert.match(out.check.mediaNotes[0], /"photos"/);
    });
  });
});
