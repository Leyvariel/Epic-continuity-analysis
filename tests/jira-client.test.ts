import { describe, expect, it, vi } from 'vitest';
import { JiraClient } from '../server/jira/client';
import { readPat } from '../server/jira/keychain';
const signal = () => new AbortController().signal;
describe('AC-11: PAT и сетевые ошибки остаются на сервере', () => {
  it('использует GET и Bearer; redirect не вызывает второй запрос', async () => {
    const fetcher = vi.fn<typeof fetch>().mockResolvedValue(new Response('', { status: 302, headers: { location: 'https://evil.test' } }));
    const client = new JiraClient('secret-marker', { fetcher });
    await expect(client.get('/rest/api/2/field', {}, signal())).rejects.toMatchObject({ code: 'JIRA_REDIRECT' });
    expect(fetcher).toHaveBeenCalledTimes(1);
    expect(fetcher.mock.calls[0][1]).toMatchObject({ method: 'GET', redirect: 'manual', headers: { Authorization: 'Bearer secret-marker' } });
  });
  it('параметры кодируются, чужой URL и HTML не принимаются', async () => {
    const fetcher = vi.fn<typeof fetch>().mockResolvedValue(new Response('<html>secret-marker</html>', { headers: { 'content-type': 'text/html' } }));
    const client = new JiraClient('secret-marker', { fetcher });
    await expect(client.get('https://evil.test/rest/api/2/field', {}, signal())).rejects.toThrow();
    expect(fetcher).not.toHaveBeenCalled();
    await expect(client.get('/rest/api/2/search', { jql: 'key = TEST-1' }, signal())).rejects.toMatchObject({ code: 'JIRA_INVALID_RESPONSE' });
    expect(String(fetcher.mock.calls[0][0])).toContain('jql=key+%3D+TEST-1');
  });
  it('429 соблюдает Retry-After, ожидание >60 с завершается без раннего повтора', async () => {
    const fetcher = vi.fn<typeof fetch>().mockResolvedValueOnce(new Response('', { status: 429, headers: { 'Retry-After': '2' } })).mockResolvedValue(new Response('{}', { headers: { 'content-type': 'application/json' } }));
    const delay = vi.fn().mockResolvedValue(undefined), client = new JiraClient('secret', { fetcher, delay });
    await expect(client.get('/rest/api/2/field', {}, signal())).resolves.toEqual({});
    expect(delay.mock.calls[0][0]).toBe(2000);
    fetcher.mockReset().mockResolvedValue(new Response('', { status: 429, headers: { 'Retry-After': '61' } }));
    await expect(client.get('/rest/api/2/field', {}, signal())).rejects.toMatchObject({ code: 'RATE_LIMITED' });
    expect(fetcher).toHaveBeenCalledTimes(1);
  });
  it('401/403/404 не повторяются и не раскрывают тело ответа', async () => {
    for (const status of [401, 403, 404]) {
      const fetcher = vi.fn<typeof fetch>().mockResolvedValue(new Response('secret-marker', { status }));
      const error = await new JiraClient('secret-marker', { fetcher }).get('/rest/api/2/field', {}, signal()).catch(e => e);
      expect(String(error)).not.toContain('secret-marker'); expect(fetcher).toHaveBeenCalledTimes(1);
    }
  });
  it('временная сеть: максимум 3 попытки; слишком большой поток отклоняется', async () => {
    const fetcher = vi.fn<typeof fetch>().mockRejectedValue(new Error('secret-marker'));
    const client = new JiraClient('secret-marker', { fetcher, delay: async () => {} });
    await expect(client.get('/rest/api/2/field', {}, signal())).rejects.toMatchObject({ code: 'JIRA_NETWORK' });
    expect(fetcher).toHaveBeenCalledTimes(3);
    const large = new JiraClient('secret', { maxBytes: 2, fetcher: vi.fn().mockResolvedValue(new Response('{"a":1}', { headers: { 'content-type': 'application/json' } })) });
    await expect(large.get('/rest/api/2/field', {}, signal())).rejects.toMatchObject({ code: 'JIRA_RESPONSE_TOO_LARGE' });
  });
  it('Keychain fallback только при not-found, отказ не обходит и секрет не выдаёт', async () => {
    const runner = vi.fn().mockRejectedValueOnce({ code: 44, stderr: 'secret-marker' }).mockResolvedValue(' token\n');
    expect(await readPat(signal(), runner)).toBe('token'); expect(runner).toHaveBeenCalledTimes(2);
    const denied = vi.fn().mockRejectedValue({ code: 36, stderr: 'secret-marker' });
    await expect(readPat(signal(), denied)).rejects.toMatchObject({ code: 'KEYCHAIN_DENIED' });
    expect(denied).toHaveBeenCalledTimes(1);
  });
});
