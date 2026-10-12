import { r2KeyFromUrl } from './r2';

test('object keys resolve from the current and legacy public hosts', () => {
  expect(r2KeyFromUrl('https://media.sp-survey.org/templates/a.jpg')).toBe('templates/a.jpg');
  expect(r2KeyFromUrl('https://pub-6c5a1831a6254dd88b26e2dc199bfd94.r2.dev/templates/a.jpg?v=2')).toBe('templates/a.jpg');
  expect(r2KeyFromUrl('https://example.com/templates/a.jpg')).toBeNull();
});
