import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { startApplication } from '../server/runtime';
import { supervise } from '../server/supervisor';

const entry = fileURLToPath(import.meta.url);
if (process.argv.includes('--server-worker')) {
  console.log(`WORKER_PID=${process.pid}`);
  await startApplication({
    root: path.resolve(path.dirname(entry), '..'), dataDirectory: process.argv[2],
    port: Number(process.argv[3]), production: !process.argv.includes('--development'),
  });
} else {
  if (process.argv.includes('--seed')) {
    const { CacheStore } = await import('../server/cache');
    const { buildJiraDataset } = await import('../server/jira/dataset');
    const { sprintDatasetInputs } = await import('./sprint-dataset-fixture');
    const inputs = sprintDatasetInputs();
    await new CacheStore(process.argv[2]).write({ schemaVersion: 3, calculationProfile: 'jira-v3', inputs, dataset: buildJiraDataset(inputs, inputs.asOf, 'restart-fixture') });
  }
  supervise(entry, [...process.argv.slice(2), '--server-worker']);
}
