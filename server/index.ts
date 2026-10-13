import http from 'node:http';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { randomBytes } from 'node:crypto';
import express from 'express';
import { createApp } from './app';
import { CacheStore } from './cache';
import { DatasetService } from './service';
import { gatewayFromProfile } from './jira/config';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const production = process.argv.includes('--production');
const port = Number(process.env.PORT ?? 4317);
if (!Number.isInteger(port) || port < 1024 || port > 65535) throw new Error('PORT должен быть от 1024 до 65535.');
const service = new DatasetService(new CacheStore(path.join(root, '.local-data')), undefined, gatewayFromProfile(path.join(root, '.local-data', 'jira-profile.json')));
await service.initialize();
const nonce = production ? undefined : randomBytes(24).toString('base64');
const app = createApp(service, nonce);
const server = http.createServer(app);
let closeVite: (() => Promise<void>) | undefined;
if (production) {
  app.use(express.static(path.join(root, 'dist'), { index: 'index.html' }));
} else {
  const { createServer } = await import('vite');
  const vite = await createServer({ root, html: { cspNonce: nonce }, server: { middlewareMode: true, hmr: { server, host: '127.0.0.1' } }, appType: 'spa' });
  closeVite = () => vite.close();
  app.use(vite.middlewares);
}
server.on('error', () => {
  console.error('Не удалось запустить локальный сервер. Возможно, порт уже занят.'); process.exitCode = 1;
  void closeVite?.();
});
server.listen(port, '127.0.0.1', () => console.log(`HF · История эпиков: http://127.0.0.1:${port}`));
for (const signal of ['SIGINT', 'SIGTERM'] as const) process.once(signal, () => {
  service.shutdown();
  server.close(); void closeVite?.().finally(() => process.exit(0));
  setTimeout(() => process.exit(0), 2000).unref();
});
