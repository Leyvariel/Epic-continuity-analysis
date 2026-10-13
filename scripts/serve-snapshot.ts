import express from 'express';
import http from 'node:http';
import path from 'node:path';
import { createApp } from '../server/app';
import { CacheStore } from '../server/cache';
import { DatasetService } from '../server/service';

const directory = process.argv[2];
if (!directory) throw new Error('Укажите каталог сохранённого снимка.');
const service = new DatasetService(new CacheStore(path.resolve(directory)));
await service.initialize();
if (!service.getDataset()) throw new Error('В каталоге нет сохранённого набора.');
const app = createApp(service, undefined, 'snapshot');
app.use(express.static(path.resolve('dist')));
const server = http.createServer(app);
server.listen(4330, '127.0.0.1', () => console.log('Снимок: http://127.0.0.1:4330 (только просмотр)'));
for (const signal of ['SIGINT', 'SIGTERM'] as const) process.once(signal, () => server.close());
