// @vitest-environment jsdom
import { afterEach, expect, it, vi } from 'vitest';
import { act } from 'react';
import { createRoot } from 'react-dom/client';
import http from 'node:http';
import { mkdtemp, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { createApp } from '../server/app';
import { DatasetService } from '../server/service';
import { CacheStore } from '../server/cache';
import { App } from '../src/App';

const cleanup: (() => Promise<unknown>)[] = [];
afterEach(async () => { for (const fn of cleanup.splice(0).reverse()) await fn(); vi.restoreAllMocks(); });
it.each(['demo', 'snapshot'] as const)('%s: явно обозначает просмотр и блокирует загрузки без обращения к Jira', async mode => {
  Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
  const directory = await mkdtemp(path.join(os.tmpdir(), 'hf-preview-'));
  cleanup.push(() => rm(directory, { recursive: true, force: true }));
  const gateway = vi.fn().mockRejectedValue(new Error('Jira must not be called'));
  const service = new DatasetService(new CacheStore(directory), undefined, gateway);
  await service.initialize();
  const server = http.createServer(createApp(service, undefined, mode));
  await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve));
  cleanup.push(() => new Promise<void>(resolve => server.close(() => resolve())));
  const base = `http://127.0.0.1:${(server.address() as { port: number }).port}`;
  const realFetch = globalThis.fetch.bind(globalThis);
  vi.spyOn(globalThis, 'fetch').mockImplementation((url, init) => realFetch(typeof url === 'string' && url.startsWith('/') ? base + url : url, init));
  const container = document.createElement('div'); document.body.append(container);
  const root = createRoot(container);
  cleanup.push(async () => { await act(async () => root.unmount()); container.remove(); });
  await act(async () => { root.render(<App />); });
  for (let i = 0; i < 50 && !container.querySelector('.preview-notice'); i++) await act(async () => { await new Promise(resolve => setTimeout(resolve, 10)); });
  expect(container.querySelector('.preview-notice')?.textContent).toContain('только просмотр');
  expect(container.querySelector('.preview-notice a')?.getAttribute('href')).toBe('http://127.0.0.1:4317');
  expect(container.querySelector('form')).toBeNull();
  expect([...container.querySelectorAll('button')].some(b => b.textContent === 'Обновить')).toBe(false);
  for (const route of ['keys/import', 'epic/import', 'board/import', 'import', 'refresh']) {
    const response = await realFetch(`${base}/api/${route}`, { method: 'POST', headers: { 'X-Local-Request': '1', 'Content-Type': 'application/json' }, body: JSON.stringify({ text: 'CARSDIS-6\nCARSDIS-18\nCARSDIS-26' }) });
    expect(response.status).toBe(409);
    expect((await response.json()).error.code).toBe('READ_ONLY_PREVIEW');
  }
  expect(gateway).not.toHaveBeenCalled();
  expect(service.getDataset()).toBeNull();
});
