import { spawn } from 'node:child_process';
import http from 'node:http';
import os from 'node:os';
import path from 'node:path';
import { once } from 'node:events';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { afterEach, expect, it } from 'vitest';
import { CacheStore } from '../server/cache';
import { DatasetService } from '../server/service';
import { historyWorkbook } from './fixtures';

const cleanup: (() => Promise<unknown>)[] = [];
afterEach(async () => { for (const fn of cleanup.splice(0).reverse()) await fn(); });
async function freePort() {
  const server = http.createServer();
  await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve));
  const { port } = server.address() as { port: number };
  await new Promise<void>(resolve => server.close(() => resolve())); return port;
}
async function waitFor<T>(read: () => Promise<T>, accept: (value: T) => boolean): Promise<T> {
  const deadline = Date.now() + 10000;
  while (Date.now() < deadline) {
    try { const result = await read(); if (accept(result)) return result; } catch { /* Startup/restart gap. */ }
    await new Promise(resolve => setTimeout(resolve, 50));
  }
  throw new Error('Server readiness timed out');
}
it.each([false, true])('AC-160 restarts a real process with preserved cache; development=%s', async development => {
  const dir = await mkdtemp(path.join(os.tmpdir(), 'hf-runtime-'));
  cleanup.push(() => rm(dir, { recursive: true, force: true }));
  const service = new DatasetService(new CacheStore(dir)); await service.initialize();
  service.import(historyWorkbook(), 'history.xlsx'); await service.waitForIdle();
  const original = await readFile(path.join(dir, 'dataset.json'));
  const port = await freePort(), base = `http://127.0.0.1:${port}`;
  const child = spawn(process.execPath, ['--import', 'tsx', 'tests/restart-fixture.ts', dir, String(port), ...(development ? ['--development'] : [])], { stdio: ['ignore', 'pipe', 'pipe'] });
  let output = ''; child.stdout.on('data', data => { output += data; }); child.stderr.on('data', data => { output += data; });
  let stopped = false;
  cleanup.push(async () => {
    if (!stopped && child.exitCode === null) { const exited = once(child, 'exit'); child.kill('SIGTERM'); await exited; }
  });
  const runtime = () => fetch(`${base}/api/runtime`, { signal: AbortSignal.timeout(1000) }).then(r => r.json() as Promise<{ instanceId: string }>);
  const before = await waitFor(runtime, value => !!value.instanceId);
  const response = await fetch(`${base}/api/restart`, { method: 'POST', headers: { 'X-Local-Request': '1' } });
  expect(response.status).toBe(202); expect(await response.json()).toEqual(before);
  const after = await waitFor(runtime, value => !!value.instanceId && value.instanceId !== before.instanceId);
  expect(after.instanceId).not.toBe(before.instanceId);
  const pids = [...output.matchAll(/WORKER_PID=(\d+)/g)].map(match => match[1]);
  expect(pids).toHaveLength(2); expect(pids[0]).not.toBe(pids[1]);
  expect((await (await fetch(`${base}/api/dataset`)).json()).dataset.id).toBe(service.getDataset()!.id);
  expect(await readFile(path.join(dir, 'dataset.json'))).toEqual(original);
  const exited = once(child, 'exit'); child.kill('SIGTERM'); await exited; stopped = true;
  await expect(runtime()).rejects.toThrow();
}, 15000);
it('does not loop after a startup failure', async () => {
  const child = spawn(process.execPath, ['--import', 'tsx', 'tests/restart-fixture.ts', os.tmpdir(), '1'], { stdio: 'ignore' });
  expect((await once(child, 'exit'))[0]).toBe(1);
});
