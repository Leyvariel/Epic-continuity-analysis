import express from 'express';
import type { ErrorRequestHandler } from 'express';
import { AppError, safeError } from './errors';
import type { DatasetService } from './service';
import { PREVIEW_MESSAGE, type ApplicationMode } from '../shared/runtime';

export function createApp(service: DatasetService, nonce?: string, mode: ApplicationMode = 'application') {
  const app = express();
  app.disable('x-powered-by');
  // The same checks apply to static files, Vite and API routes (DNS rebinding / CSRF).
  app.use((req, res, next) => {
    const origin = `http://127.0.0.1:${req.socket.localPort}`;
    if (req.headers.host !== `127.0.0.1:${req.socket.localPort}` ||
      (req.headers.origin && req.headers.origin !== origin) || req.headers['sec-fetch-site'] === 'cross-site') {
      res.status(403).json({ error: { code: 'LOCAL_ONLY', message: 'Доступ разрешён только с локальной страницы приложения.' } }); return;
    }
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('Referrer-Policy', 'no-referrer');
    res.setHeader('X-Frame-Options', 'DENY');
    // No third-party fonts, scripts, images, analytics or outbound browser connections.
    res.setHeader('Content-Security-Policy', `default-src 'self'; script-src 'self'${nonce ? ` 'nonce-${nonce}'` : ''}; style-src 'self' 'unsafe-inline'; img-src 'self' data:; connect-src 'self' ws://127.0.0.1:*; frame-ancestors 'none'; base-uri 'none'; form-action 'self'`);
    if (req.path.startsWith('/api/')) res.setHeader('Cache-Control', 'no-store');
    if (req.method === 'POST' && req.headers['x-local-request'] !== '1') {
      res.status(403).json({ error: { code: 'LOCAL_HEADER', message: 'Отсутствует заголовок локального запроса.' } }); return;
    }
    if (mode !== 'application' && req.method === 'POST' && req.path.startsWith('/api/')) {
      res.status(409).json({ error: { code: 'READ_ONLY_PREVIEW', message: PREVIEW_MESSAGE } }); return;
    }
    next();
  });
  app.get('/api/dataset', (_req, res) => res.json({ dataset: service.getDataset(), ...(mode === 'application' ? {} : { mode }) }));
  app.get('/api/jobs/:id', (req, res) => res.json(service.getJob(req.params.id)));
  app.post('/api/import', express.raw({ type: ['application/vnd.openxmlformats-officedocument.spreadsheetml.sheet', 'application/octet-stream', 'text/csv'], limit: '20mb' }), (req, res) => {
    if (!Buffer.isBuffer(req.body)) throw new AppError('INVALID_UPLOAD', 'Передайте XLSX как тело запроса (application/octet-stream).', 415);
    let filename: string;
    try { filename = decodeURIComponent(String(req.headers['x-file-name'] ?? 'import.xlsx')); }
    catch { throw new AppError('INVALID_FILENAME', 'Некорректное имя файла.'); }
    const mode = req.headers['x-history-source'];
    if (mode !== undefined && mode !== 'file' && mode !== 'jira') throw new AppError('INVALID_HISTORY_SOURCE', 'Неизвестный источник истории.');
    if (mode !== 'jira' && !/\.xlsx$/i.test(filename)) throw new AppError('INVALID_UPLOAD', 'CSV поддерживается только с историей Jira.');
    const job = mode === 'jira' ? service.importJiraFile(req.body, filename) : service.import(req.body, filename);
    res.status(202).json({ id: job.id });
  });
  const json = express.json({ limit: '16kb' });
  app.post('/api/keys/import', json, (req, res) => {
    if (!req.is('application/json')) throw new AppError('INVALID_CONTENT_TYPE', 'Нужен JSON.', 415);
    if (!req.body || Array.isArray(req.body) || typeof req.body !== 'object' || typeof req.body.text !== 'string' || Object.keys(req.body).length !== 1)
      throw new AppError('INVALID_INPUT', 'Передайте единственное строковое поле text.');
    res.status(202).json({ id: service.importKeys(req.body.text).id });
  });
  for (const kind of ['board', 'epic'] as const) app.post(`/api/${kind}/import`, json, (req, res) => {
    if (!req.is('application/json')) throw new AppError('INVALID_CONTENT_TYPE', 'Нужен JSON.', 415);
    if (!req.body || typeof req.body.url !== 'string' || Object.keys(req.body).some(key => key !== 'url')) throw new AppError('INVALID_INPUT', 'Передайте единственное поле url.');
    const job = kind === 'board' ? service.importBoard(req.body.url) : service.importEpic(req.body.url);
    res.status(202).json({ id: job.id });
  });
  app.post('/api/refresh', json, (req, res) => {
    if (!req.is('application/json')) throw new AppError('INVALID_CONTENT_TYPE', 'Нужен JSON.', 415);
    if (!req.body || typeof req.body.datasetId !== 'string' || Object.keys(req.body).some(key => key !== 'datasetId')) throw new AppError('INVALID_INPUT', 'Передайте единственное поле datasetId.');
    res.status(202).json({ id: service.refresh(req.body.datasetId).id });
  });
  app.use('/api', (_req, res) => res.status(404).json({ error: { code: 'NOT_FOUND', message: 'Локальный API не найден.' } }));
  const handler: ErrorRequestHandler = (error: unknown, _req, res, _next) => {
    if (typeof error === 'object' && error && 'type' in error && error.type === 'entity.too.large') {
      res.status(413).json({ error: { code: 'BODY_TOO_LARGE', message: 'Тело запроса превышает допустимый размер.' } }); return;
    }
    if (typeof error === 'object' && error && 'type' in error && error.type === 'entity.parse.failed') { res.status(400).json({ error: { code: 'INVALID_JSON', message: 'Некорректный JSON.' } }); return; }
    res.status(error instanceof AppError ? error.status : 500).json({ error: safeError(error) });
  };
  app.use(handler);
  return app;
}
