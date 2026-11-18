import http from 'node:http';
import path from 'node:path';
import { randomBytes } from 'node:crypto';
import express from 'express';
import { createApp } from './app';
import { CacheStore } from './cache';
import { DatasetService } from './service';
import { gatewayFromProfile } from './jira/config';
import { RESTART_EXIT_CODE } from './supervisor';

export async function startApplication(options: { root: string; production: boolean; port: number; dataDirectory?: string }): Promise<void> {
  const { root, production, port } = options;
  if (!Number.isInteger(port) || port < 1024 || port > 65535) throw new Error('PORT должен быть от 1024 до 65535.');
  const directory = options.dataDirectory ?? path.join(root, '.local-data');
  const service = new DatasetService(new CacheStore(directory), undefined, gatewayFromProfile(path.join(directory, 'jira-profile.json')));
  let server: http.Server | undefined;
  let closeVite: (() => Promise<void>) | undefined;
  let stopping = false;
  const stop = (code = 0) => {
    if (stopping) return;
    stopping = true;
    service.shutdown();
    setTimeout(() => process.exit(code), 2000).unref();
    const closeHttp = new Promise<void>(resolve => {
      if (server?.listening) { server.close(() => resolve()); server.closeIdleConnections(); }
      else resolve();
    });
    void Promise.allSettled([closeHttp, closeVite?.()]).then(() => process.exit(code));
  };
  for (const signal of ['SIGINT', 'SIGTERM'] as const) process.once(signal, () => stop());
  process.once('disconnect', () => stop());
  await service.initialize();
  if (stopping) return;
  const nonce = production ? undefined : randomBytes(24).toString('base64');
  const app = createApp(service, nonce, 'application', process.connected ? () => stop(RESTART_EXIT_CODE) : undefined);
  server = http.createServer(app);
  if (production) app.use(express.static(path.join(root, 'dist'), { index: 'index.html' }));
  else {
    const { createServer } = await import('vite');
    const vite = await createServer({ root, html: { cspNonce: nonce }, server: { middlewareMode: true, hmr: { server, host: '127.0.0.1' } }, appType: 'spa' });
    closeVite = () => vite.close();
    app.use(vite.middlewares);
  }
  if (stopping) { await closeVite?.(); return; }
  server.on('error', () => {
    console.error('Не удалось запустить локальный сервер. Возможно, порт уже занят.');
    stop(1);
  });
  server.listen(port, '127.0.0.1', () => console.log(`HF · История эпиков: http://127.0.0.1:${port}`));
}
