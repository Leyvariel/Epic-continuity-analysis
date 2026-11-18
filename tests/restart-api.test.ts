import http from 'node:http';
import os from 'node:os';
import path from 'node:path';
import { mkdtemp, rm } from 'node:fs/promises';
import { afterEach, expect, it, vi } from 'vitest';
import { createApp } from '../server/app';
import { DatasetService } from '../server/service';
import { CacheStore } from '../server/cache';
import { historyWorkbook } from './fixtures';

const cleanup: (() => Promise<unknown>)[] = [];
afterEach(async () => { for (const fn of cleanup.splice(0).reverse()) await fn(); });
async function setup(mode: 'application' | 'snapshot' = 'application') {
  const dir = await mkdtemp(path.join(os.tmpdir(), 'hf-restart-'));
  cleanup.push(() => rm(dir, { recursive: true, force: true }));
  const cache = new CacheStore(dir), service = new DatasetService(cache);
  await service.initialize();
  const restart = vi.fn();
  const server = http.createServer(createApp(service, undefined, mode, restart));
  await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve));
  cleanup.push(() => new Promise<void>(resolve => server.close(() => resolve())));
  const base = `http://127.0.0.1:${(server.address() as { port: number }).port}`;
  const post = (headers: Record<string, string> = { 'X-Local-Request': '1' }) => fetch(`${base}/api/restart`, { method: 'POST', headers });
  return { base, post, restart, service, cache };
}
it('AC-160 accepts restart once, preserves the dataset and blocks subsequent mutations', async () => {
  const app = await setup();
  app.service.import(historyWorkbook(), 'history.xlsx'); await app.service.waitForIdle();
  const dataset = app.service.getDataset();
  const before = await (await fetch(`${app.base}/api/runtime`)).json();
  const response = await app.post();
  expect(response.status).toBe(202);
  expect(await response.json()).toEqual({ instanceId: before.instanceId });
  expect(app.restart).toHaveBeenCalledTimes(1);
  expect((await app.post()).status).toBe(409);
  expect(() => app.service.importKeys('A-1')).toThrow(/Дождитесь/);
  await expect(app.service.reset(dataset!.id)).rejects.toMatchObject({ code: 'BUSY' });
  expect(app.service.getDataset()).toEqual(dataset);
  expect((await app.cache.read())?.dataset.id).toBe(dataset!.id);
});
it('AC-161 refuses restart while a reset is pending', async () => {
  const app = await setup(); let finish!: () => void;
  vi.spyOn(app.cache, 'clear').mockImplementation(() => new Promise<void>(resolve => { finish = resolve; }));
  const resetting = app.service.reset(null);
  const response = await app.post();
  expect(response.status).toBe(409); expect(app.restart).not.toHaveBeenCalled();
  finish(); await resetting;
  expect((await app.post()).status).toBe(202);
});
it('AC-161 refuses restart during an import and permits it after completion', async () => {
  const app = await setup(); let finish!: () => void;
  const write = app.cache.write.bind(app.cache);
  vi.spyOn(app.cache, 'write').mockImplementation(async state => { await new Promise<void>(resolve => { finish = resolve; }); await write(state); });
  app.service.import(historyWorkbook(), 'history.xlsx');
  expect((await app.post()).status).toBe(409); expect(app.restart).not.toHaveBeenCalled();
  finish(); await app.service.waitForIdle();
  expect((await app.post()).status).toBe(202);
});
it('AC-162 enforces local request protections and read-only mode', async () => {
  const app = await setup();
  expect((await app.post({})).status).toBe(403);
  expect((await app.post({ 'X-Local-Request': '1', Origin: 'https://example.com' })).status).toBe(403);
  expect(app.restart).not.toHaveBeenCalled();
  const preview = await setup('snapshot');
  expect((await preview.post()).status).toBe(409); expect(preview.restart).not.toHaveBeenCalled();
});
