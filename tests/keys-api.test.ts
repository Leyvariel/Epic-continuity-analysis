import { afterEach, describe, expect, it, vi } from 'vitest';
import { mkdtemp, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import http from 'node:http';
import { createApp } from '../server/app';
import { DatasetService } from '../server/service';
import { CacheStore } from '../server/cache';
import { AS_OF } from './fixtures';

const cleanup: (() => Promise<unknown>)[] = [];
afterEach(async () => { for (const fn of cleanup.splice(0).reverse()) await fn(); vi.restoreAllMocks(); });
async function setup() {
  const dir = await mkdtemp(path.join(os.tmpdir(), 'hf-keys-api-'));
  cleanup.push(() => rm(dir, { recursive: true, force: true }));
  const factory = vi.fn().mockRejectedValue(new Error('Jira must not be used'));
  const service = new DatasetService(new CacheStore(dir), () => AS_OF, factory);
  await service.initialize();
  const server = http.createServer(createApp(service));
  await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve));
  cleanup.push(() => new Promise<void>(resolve => server.close(() => resolve())));
  cleanup.push(() => service.waitForIdle());
  const base = `http://127.0.0.1:${(server.address() as { port: number }).port}`;
  const send = (body: string, headers: Record<string, string> = { 'content-type': 'application/json', 'x-local-request': '1' }) => fetch(base + '/api/keys/import', { method: 'POST', headers, body });
  return { base, send, factory, service };
}

describe('KEYS-API: локальный ввод списка', () => {
  it('AC-021/022: один JSON-запрос создаёт один job и сохраняемый отчёт только об ошибках', async () => {
    const { base, send, service, factory } = await setup();
    const accepted = await send(JSON.stringify({ text: 'неверный ключ\nещё одна ошибка' }));
    expect(accepted.status).toBe(202);
    const { id } = await accepted.json();
    await service.waitForIdle();
    const job = await (await fetch(base + `/api/jobs/${id}`)).json();
    const { dataset } = await (await fetch(base + '/api/dataset')).json();
    expect(job.status).toBe('completed');
    expect(dataset.id).toBe(job.dataset.id);
    expect(dataset.audit.entries).toHaveLength(2);
    expect(dataset.epics).toEqual([]);
    expect(factory).not.toHaveBeenCalled();
  });
  it('пустота и неверная форма JSON дают 400 до задания и без Jira', async () => {
    const { send, factory } = await setup();
    for (const body of ['{"text":""}', '{"text":"New grid\\n| :--- |"}', '{}', '{"text":null}', '{"text":12}', '{"text":"bad","extra":1}', '[]', 'null', '{']) {
      expect((await send(body)).status, body).toBe(400);
    }
    expect(factory).not.toHaveBeenCalled();
  });
  it('MIME, локальный заголовок и байтовый предел проверяются на границе HTTP', async () => {
    const { send, service, factory } = await setup();
    expect((await send('{"text":"bad"}', { 'content-type': 'text/plain', 'x-local-request': '1' })).status).toBe(415);
    expect((await send('{"text":"bad"}', { 'content-type': 'application/json' })).status).toBe(403);
    const seed = '{"text":"bad"}';
    expect((await send(seed + ' '.repeat(16384 - Buffer.byteLength(seed)))).status).toBe(202);
    await service.waitForIdle();
    const saved = service.getDataset()?.id;
    expect((await send(seed + ' '.repeat(16385 - Buffer.byteLength(seed)))).status).toBe(413);
    expect(service.getDataset()?.id).toBe(saved);
    expect(factory).not.toHaveBeenCalled();
  });
});
