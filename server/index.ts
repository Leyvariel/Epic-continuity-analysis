import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { supervise } from './supervisor';

const entry = fileURLToPath(import.meta.url);
if (process.argv.includes('--server-worker')) {
  const { startApplication } = await import('./runtime');
  await startApplication({
    root: path.resolve(path.dirname(entry), '..'),
    production: process.argv.includes('--production'),
    port: Number(process.env.PORT ?? 4317),
  });
} else supervise(entry, [...process.argv.slice(2), '--server-worker']);
