import { afterEach, describe, expect, it, vi } from 'vitest';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import http from 'node:http';
import { createApp } from '../server/app';
import { CacheStore } from '../server/cache';
import { DatasetService } from '../server/service';
import type { ImportJob } from '../shared/types';
import { AS_OF, workbook, historyWorkbook, weeklyWorkbook } from './fixtures';
import { metricValue } from '../shared/metrics';
import { DAY_MS } from '../shared/statuses';

const cleanup: (() => Promise<unknown>)[] = [];
afterEach(async () => { vi.restoreAllMocks(); for (const callback of cleanup.splice(0).reverse()) await callback(); });

async function setup(directory?: string, asOf = AS_OF, store?: CacheStore) {
  const dir = directory ?? await mkdtemp(path.join(os.tmpdir(), 'hf-api-test-'));
  if (!directory) cleanup.push(() => rm(dir, { recursive: true, force: true }));
  const service = new DatasetService(store ?? new CacheStore(dir), () => asOf);
  await service.initialize();
  const server = http.createServer(createApp(service));
  await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve));
  cleanup.push(() => new Promise<void>((resolve, reject) => server.close(e => e ? reject(e) : resolve())));
  const address = server.address() as { port: number };
  const base = `http://127.0.0.1:${address.port}`;
  const post = (route: string, body?: Buffer, headers?: Record<string, string>) => fetch(`${base}${route}`, {
    method: 'POST', headers: { 'X-Local-Request': '1', 'Content-Type': 'application/octet-stream', 'X-File-Name': encodeURIComponent('Импорт.xlsx'), ...headers }, body: body as BodyInit | undefined,
  });
  const finish = async (response: Response): Promise<ImportJob> => {
    expect(response.status).toBe(202);
    const { id } = await response.json() as { id: string };
    for (let n = 0; n < 100; n++) {
      const job = await (await fetch(`${base}/api/jobs/${id}`)).json() as ImportJob;
      if (['completed', 'failed'].includes(job.status)) return job;
      await new Promise(resolve => setTimeout(resolve, 5));
    }
    throw new Error('Job timed out');
  };
  return { service, base, dir, post, finish };
}

describe('offline APIs and cache', () => {
  it('imports and restores weekly reports, preserving current TTM and source limitations', async () => {
    const app = await setup();
    const job = await app.finish(await app.post('/api/import', weeklyWorkbook()));
    expect(job.status).toBe('completed');
    expect(job.dataset?.epics).toHaveLength(1);
    expect(metricValue(job.dataset!.epics[0], 'ttm', 'excel')).toBeCloseTo(56.6 * DAY_MS, 5);
    const restored = await setup(app.dir);
    expect(restored.service.getDataset()).toEqual(job.dataset);
    expect(restored.service.getDataset()?.warnings).toContainEqual(expect.objectContaining({ code: 'MISSING_RESOLUTION' }));
  });
  it('imports asynchronously, repeats import and restores from cache', async () => {
    const app = await setup();
    expect(await (await fetch(`${app.base}/api/dataset`)).json()).toEqual({ dataset: null });
    const first = await app.finish(await app.post('/api/import', historyWorkbook()));
    expect(first.status).toBe('completed'); expect(first.dataset?.quality).toBe('complete');
    expect(first.dataset?.epics[0].ttmMs).toBe(15 * 86400000);
    const second = await app.finish(await app.post('/api/import', historyWorkbook()));
    expect(second.dataset?.epics).toHaveLength(1); expect(second.dataset?.id).not.toBe(first.dataset?.id);
    const restored = await setup(app.dir);
    expect(restored.service.getDataset()).toEqual(second.dataset);
    expect(await readFile(path.join(app.dir, 'dataset.json'), 'utf8')).toContain('statusChanges');
  });
  it('keeps aggregates separate and never carries old history into a new file', async () => {
    const app = await setup();
    await app.finish(await app.post('/api/import', historyWorkbook()));
    const job = await app.finish(await app.post('/api/import', workbook()));
    expect(job.dataset?.quality).toBe('partial'); expect(job.dataset?.epics[0].ttmMs).toBeNull();
    expect(job.dataset?.epics[0].summary.excelAggregates['[HF] Time To Market']).toBe(999);
    expect(job.dataset?.epics[0].intervals).toEqual([]);
    expect(job.errors[0].code).toBe('NO_HISTORY_TABLE');
    const restored = await setup(app.dir, '2026-09-25T00:00:00Z');
    expect(restored.service.getDataset()).toEqual(job.dataset);
  });
  it('freezes open durations at the supplied asOf across restart', async () => {
    const app = await setup();
    const job = await app.finish(await app.post('/api/import', historyWorkbook([
      ['TEST-1', '[HF] Реализация', '2026-09-02T09:00:00Z', ''],
    ])));
    expect(job.dataset?.epics[0].isOpen).toBe(true);
    const restored = await setup(app.dir, '2026-09-25T00:00:00Z');
    expect(restored.service.getDataset()?.epics[0].ttmMs).toBe(job.dataset?.epics[0].ttmMs);
    expect(restored.service.getDataset()?.asOf).toBe(AS_OF);
  });
  it('returns 409 for overlapping imports', async () => {
    const directory = await mkdtemp(path.join(os.tmpdir(), 'hf-busy-'));
    cleanup.push(() => rm(directory, { recursive: true, force: true }));
    const store = new CacheStore(directory);
    const original = store.write.bind(store);
    let release!: () => void;
    const gate = new Promise<void>(resolve => { release = resolve; });
    vi.spyOn(store, 'write').mockImplementation(async state => { await gate; await original(state); });
    const app = await setup(directory, AS_OF, store);
    const first = await app.post('/api/import', workbook());
    expect((await app.post('/api/import', workbook())).status).toBe(409);
    release(); expect((await app.finish(first)).status).toBe('completed');
  });
  it('blocks cross-origin, forged Host and missing local header; validates refresh content type', async () => {
    const app = await setup();
    expect((await app.post('/api/import', workbook(), { Origin: 'https://example.test' })).status).toBe(403);
    const forgedHostStatus = await new Promise<number | undefined>((resolve, reject) => {
      const req = http.request(`${app.base}/api/dataset`, { headers: { Host: 'attacker.test' } }, response => { response.resume(); resolve(response.statusCode); });
      req.on('error', reject); req.end();
    });
    expect(forgedHostStatus).toBe(403);
    expect((await app.post('/api/import', workbook(), { 'Sec-Fetch-Site': 'cross-site' })).status).toBe(403);
    expect((await fetch(`${app.base}/api/import`, { method: 'POST' })).status).toBe(403);
    expect((await app.post('/api/import', workbook(), { 'Content-Type': 'text/plain' })).status).toBe(415);
    expect((await fetch(`${app.base}/api/jobs/missing`)).status).toBe(404);
    expect((await app.post('/api/refresh')).status).toBe(415);
  });
  it('does not replace cache on malformed import; corrupt cache is recoverable', async () => {
    const app = await setup();
    const first = await app.finish(await app.post('/api/import', workbook()));
    expect((await app.post('/api/import', Buffer.from('bad'))).status).toBe(400);
    expect(app.service.getDataset()?.id).toBe(first.dataset?.id);
    await writeFile(path.join(app.dir, 'dataset.json'), '{invalid');
    const broken = await setup(app.dir);
    expect((await fetch(`${broken.base}/api/dataset`)).status).toBe(500);
    expect((await broken.finish(await broken.post('/api/import', workbook()))).status).toBe('completed');
    expect((await fetch(`${broken.base}/api/dataset`)).status).toBe(200);
  });
  it('does not publish a dataset whose cache write failed, nor leak native errors', async () => {
    const directory = await mkdtemp(path.join(os.tmpdir(), 'hf-cache-fail-'));
    cleanup.push(() => rm(directory, { recursive: true, force: true }));
    const store = new CacheStore(directory), app = await setup(directory, AS_OF, store);
    const first = await app.finish(await app.post('/api/import', historyWorkbook()));
    vi.spyOn(store, 'write').mockRejectedValue(new Error('private-internal-sentinel'));
    const failed = await app.finish(await app.post('/api/import', workbook()));
    expect(failed.status).toBe('failed'); expect(JSON.stringify(failed)).not.toContain('private-internal-sentinel');
    expect(app.service.getDataset()?.id).toBe(first.dataset?.id);
  });
  it('imports and rebuilds without any outbound fetch calls', async () => {
    const directory = await mkdtemp(path.join(os.tmpdir(), 'hf-offline-'));
    cleanup.push(() => rm(directory, { recursive: true, force: true }));
    const forbidden = vi.spyOn(globalThis, 'fetch').mockRejectedValue(new Error('Network forbidden'));
    const service = new DatasetService(new CacheStore(directory), () => AS_OF);
    await service.initialize(); const job = service.import(historyWorkbook(), 'local.xlsx');
    while (job.status === 'running' || job.status === 'queued') await new Promise(resolve => setTimeout(resolve, 5));
    expect(job.dataset?.quality).toBe('complete'); expect(forbidden).not.toHaveBeenCalled();
  });
});
