import { moveImagesInR2, resetR2ProxyUnreachable } from './r2';
jest.mock('./supabase', () => ({ supabase: null }));
const originalFetch = global.fetch;
afterEach(() => { global.fetch = originalFetch; });
test('partial copy failures do not delete any original objects', async () => {
  resetR2ProxyUnreachable();
  global.fetch = jest.fn().mockResolvedValue({ ok: true, json: async () => ({
    success: false, copied: [{ from: 'u/p/a.jpg', to: 'u/p/new/a.jpg' }],
    errors: [{ from: 'u/p/b.jpg', error: 'Copy failed' }],
  }) });
  const result = await moveImagesInR2([{ from: 'u/p/a.jpg', to: 'u/p/new/a.jpg' }, { from: 'u/p/b.jpg', to: 'u/p/new/b.jpg' }]);
  expect(result.success).toBe(false);
  expect(global.fetch).toHaveBeenCalledTimes(1);
  expect(global.fetch.mock.calls[0][0]).toContain('/api/r2/copy');
});
