import { afterEach, expect, it, vi } from 'vitest';
import { restartApplication } from '../src/restart';
const response = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status });
afterEach(() => { vi.restoreAllMocks(); vi.useRealTimers(); });
it('AC-160 reloads only when a new server instance is ready; retries temporary outages', async () => {
  vi.useFakeTimers(); const reload = vi.fn();
  const fetch = vi.spyOn(globalThis, 'fetch')
    .mockResolvedValueOnce(response({ instanceId: 'old' }))
    .mockResolvedValueOnce(response({ instanceId: 'old' }))
    .mockRejectedValueOnce(new Error('offline'))
    .mockResolvedValueOnce(response({ instanceId: 'new' }));
  const pending = restartApplication(reload);
  await vi.advanceTimersByTimeAsync(100); expect(reload).not.toHaveBeenCalled();
  await vi.advanceTimersByTimeAsync(2000); await pending;
  expect(reload).toHaveBeenCalledTimes(1);
  expect(fetch.mock.calls.filter(([url]) => url === '/api/restart')).toHaveLength(1);
  expect(fetch.mock.calls[0][1]).toMatchObject({ method: 'POST', headers: { 'X-Local-Request': '1' } });
});
it('AC-163 reports rejection without polling or reload', async () => {
  const reload = vi.fn();
  const fetch = vi.spyOn(globalThis, 'fetch').mockResolvedValue(response({ error: { code: 'BUSY', message: 'Дождитесь завершения задания' } }, 409));
  await expect(restartApplication(reload)).rejects.toThrow('Дождитесь');
  expect(fetch).toHaveBeenCalledTimes(1); expect(reload).not.toHaveBeenCalled();
});
it('AC-163 times out without claiming success or sending another restart', async () => {
  vi.useFakeTimers(); const reload = vi.fn();
  const fetch = vi.spyOn(globalThis, 'fetch').mockResolvedValue(response({ instanceId: 'same' }));
  const assertion = expect(restartApplication(reload)).rejects.toThrow(/Не удалось дождаться/);
  await vi.advanceTimersByTimeAsync(35000); await assertion;
  expect(reload).not.toHaveBeenCalled();
  expect(fetch.mock.calls.filter(([url]) => url === '/api/restart')).toHaveLength(1);
});
