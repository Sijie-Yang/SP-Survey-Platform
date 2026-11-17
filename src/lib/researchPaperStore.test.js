jest.mock('./supabase', () => ({ supabase: null }));

// eslint-disable-next-line import/first
import { escapeLikePattern } from './researchPaperStore';

describe('escapeLikePattern', () => {
  test('escapes LIKE wildcards in DOIs', () => {
    expect(escapeLikePattern('10.1007/978-3-319-46448-0_12')).toBe('10.1007/978-3-319-46448-0\\_12');
    expect(escapeLikePattern('10.1/50%')).toBe('10.1/50\\%');
    expect(escapeLikePattern('a\\b')).toBe('a\\\\b');
  });
  test('leaves ordinary DOIs unchanged', () => {
    expect(escapeLikePattern('10.1016/j.landurbplan.2026.105734')).toBe('10.1016/j.landurbplan.2026.105734');
  });
});
