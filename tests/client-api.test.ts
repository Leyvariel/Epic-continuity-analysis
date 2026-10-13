import { afterEach, describe, expect, it, vi } from 'vitest';
import { LocalApiError, readImportStatus, request } from '../src/api';

afterEach(() => vi.restoreAllMocks());
const response = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });

describe('local import recovery', () => {
  it('reads a job without fetching or changing the saved dataset', async () => {
    const job = { id: 'one', status: 'running' };
    const fetch = vi.spyOn(globalThis, 'fetch').mockResolvedValue(response(job));
    expect(await readImportStatus('one')).toEqual({ kind: 'job', job });
    expect(fetch).toHaveBeenCalledExactlyOnceWith('/api/jobs/one', undefined);
  });
  it('restores the saved dataset when the server lost its in-memory jobs', async () => {
    const dataset = { id: 'saved' };
    const fetch = vi.spyOn(globalThis, 'fetch')
      .mockResolvedValueOnce(response({ error: { code: 'JOB_NOT_FOUND', message: 'Задание не найдено' } }, 404))
      .mockResolvedValueOnce(response({ dataset }));
    expect(await readImportStatus('lost')).toEqual({ kind: 'restored', dataset });
    expect(fetch.mock.calls.map(call => call[0])).toEqual(['/api/jobs/lost', '/api/dataset']);
  });
  it('recovers to an empty state if the first import was never saved', async () => {
    vi.spyOn(globalThis, 'fetch')
      .mockResolvedValueOnce(response({ error: { code: 'JOB_NOT_FOUND' } }, 404))
      .mockResolvedValueOnce(response({ dataset: null }));
    expect(await readImportStatus('lost')).toEqual({ kind: 'restored', dataset: null });
  });
  it('does not treat network failure as a successfully restored or empty dataset', async () => {
    vi.spyOn(globalThis, 'fetch').mockRejectedValue(new Error('offline'));
    await expect(readImportStatus('one')).rejects.toThrow(/Локальный сервер недоступен/);
  });
  it('keeps cache corruption visible and preserves the HTTP error for the UI to unlock import', async () => {
    vi.spyOn(globalThis, 'fetch')
      .mockResolvedValueOnce(response({ error: { code: 'JOB_NOT_FOUND' } }, 404))
      .mockResolvedValueOnce(response({ error: { code: 'CACHE_INVALID', message: 'Кэш повреждён' } }, 500));
    await expect(readImportStatus('lost')).rejects.toMatchObject({ status: 500, code: 'CACHE_INVALID', message: 'Кэш повреждён' });
  });
  it('does not hide unrelated HTTP errors as a successful recovery', async () => {
    const fetch = vi.spyOn(globalThis, 'fetch').mockResolvedValue(response({ error: { code: 'FORBIDDEN', message: 'Нет доступа' } }, 403));
    await expect(readImportStatus('one')).rejects.toBeInstanceOf(LocalApiError);
    expect(fetch).toHaveBeenCalledTimes(1);
  });
  it('rejects an invalid success response instead of publishing null data', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(new Response('<html>error</html>'));
    await expect(request('/api/dataset')).rejects.toThrow(/некорректный ответ/);
  });
});
