import { afterEach, describe, expect, it, vi } from 'vitest';
import { mkdtemp, rm } from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import http from 'node:http';
import { createApp } from '../server/app';
import { DatasetService } from '../server/service';
import { CacheStore } from '../server/cache';
import { fakeGateway } from './jira-fixtures';
import { AS_OF } from './fixtures';
const cleanup: (() => Promise<unknown>)[] = [];
afterEach(async () => { for (const fn of cleanup.splice(0).reverse()) await fn(); });
async function setup() {
  const dir = await mkdtemp(path.join(os.tmpdir(), 'hf-jira-api-')); cleanup.push(() => rm(dir, { recursive: true, force: true }));
  const factory = vi.fn().mockResolvedValue(fakeGateway()), service = new DatasetService(new CacheStore(dir), () => AS_OF, factory);
  const server = http.createServer(createApp(service)); await new Promise<void>(r => server.listen(0, '127.0.0.1', r));
  cleanup.push(() => new Promise<void>(r => server.close(() => r())));
  cleanup.push(() => service.waitForIdle());
  const base = `http://127.0.0.1:${(server.address() as { port: number }).port}`;
  const post = (route: string, body: unknown) => fetch(base + route, { method: 'POST', headers: { 'content-type': 'application/json', 'x-local-request': '1' }, body: JSON.stringify(body) });
  return { base, post, factory, service };
}
describe('BDD: локальный API трёх источников', () => {
  it('принимает одиночную ссылку и возвращает задание; неверная ссылка не читает credentials', async () => {
    const { post, factory } = await setup();
    expect((await post('/api/epic/import', { url: 'https://evil.test/browse/TEST-1' })).status).toBe(400);
    expect(factory).not.toHaveBeenCalled();
    expect((await post('/api/epic/import', { url: 'https://hq.tutu.ru/browse/TEST-1' })).status).toBe(202);
  });
  it('принимает CSV только с явным Jira-источником истории', async () => {
    const { base } = await setup();
    const send = (mode: string) => fetch(base + '/api/import', { method: 'POST', headers: { 'content-type': 'text/csv', 'x-local-request': '1', 'x-file-name': 'keys.csv', 'x-history-source': mode }, body: 'Ключ\nTEST-1' });
    expect((await send('file')).status).toBe(400);
    expect((await send('wrong')).status).toBe(400);
    expect((await send('jira')).status).toBe(202);
  });
  it('ошибка JSON и устаревший datasetId — явные 400/409, не 500', async () => {
    const { base, post } = await setup();
    expect((await post('/api/refresh', { datasetId: 'old' })).status).toBe(409);
    expect((await fetch(base + '/api/board/import', { method: 'POST', headers: { 'content-type': 'application/json', 'x-local-request': '1' }, body: '{' })).status).toBe(400);
  });
});
