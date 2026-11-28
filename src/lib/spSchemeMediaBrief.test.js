import { buildExampleSite } from './spScheme';
import { mediaLibraryBrief, mediaLibraryText, pageMediaGaps, pageWantedFolders } from './spSchemeMediaBrief';

const stored = (folder, name) => {
  const file = name.replace(/(\.[a-z0-9]+)$/i, '__236a3465-ef58-4c35-9ee7-7e1a3a4fc833$1');
  return { url: `https://media.test/u1/p1/${folder ? `${folder}/` : ''}${file}`, key: `u1/p1/${folder ? `${folder}/` : ''}${file}`, name: file };
};
const LIBRARY = [
  ...[10, 2, 1].map((n) => stored('streets', `IMG_${n}.jpg`)),
  stored('', 'intro.mp4'),
  stored('sounds', 'rain.mp3'),
];

test('the brief lists folders with counts and the names pages use, in natural order', () => {
  const brief = mediaLibraryBrief(LIBRARY, 'u1/p1/');
  expect(brief.total).toBe(5);
  expect(brief.folders.map((f) => [f.folder, f.count])).toEqual([['', 1], ['sounds', 1], ['streets', 3]]);
  expect(brief.folders[2].names).toEqual(['IMG_1.jpg', 'IMG_2.jpg', 'IMG_10.jpg']);
  const text = mediaLibraryText(brief);
  expect(text).toContain('holds 5 file(s)');
  expect(text).toContain('- library root (no folder), 1 video: intro.mp4');
  expect(text).toContain('- folder "sounds", 1 audio file: rain.mp3');
  expect(text).toContain('- folder "streets", 3 images: IMG_1.jpg, IMG_2.jpg, IMG_10.jpg');
  expect(text).not.toContain('236a3465');
});

test('a long folder lists its first names only and says how many more there are', () => {
  const many = Array.from({ length: 500 }, (_, i) => stored('streets', `v_${i + 1}.jpg`));
  const brief = mediaLibraryBrief(many, 'u1/p1/');
  expect(brief.folders[0].names).toHaveLength(60);
  expect(brief.folders[0].more).toBe(440);
  expect(mediaLibraryText(brief)).toContain('v_60.jpg, … and 440 more');
});

test('an empty library says so', () => {
  expect(mediaLibraryText(mediaLibraryBrief([]))).toMatch(/media library is empty/);
});

test('a page that reads the library folders and names no other file has no gaps', () => {
  const html = buildExampleSite().replace('</body>', "<script>SPSite.getMedia('streets'); var first = 'IMG_2.jpg';</script></body>");
  expect(pageWantedFolders(html)).toContain('streets');
  expect(pageMediaGaps(html, LIBRARY, 'u1/p1/')).toEqual([]);
});

test('folders and named files the library lacks are listed; an empty library has no gaps', () => {
  const html = buildExampleSite().replace('</body>', "<script>SPSite.getMedia('photos'); var need = ['photos/lawnA_1slight.jpg', 'IMG_1.jpg'];</script></body>");
  const gaps = pageMediaGaps(html, LIBRARY, 'u1/p1/');
  expect(gaps.map((g) => [g.kind, g.items])).toEqual([['folders', ['photos']], ['files', ['photos/lawnA_1slight.jpg']]]);
  expect(gaps[0].message).toContain('Its folders are: "sounds", "streets".');
  expect(pageMediaGaps(html, [])).toEqual([]);
});
