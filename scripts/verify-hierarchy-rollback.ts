import assert from 'node:assert/strict';
import { mkdtemp, readFile, writeFile, rm, access } from 'node:fs/promises';
import { pathToFileURL } from 'node:url';
import os from 'node:os';
import path from 'node:path';
import * as XLSX from 'xlsx';
import { CacheStore } from '../server/cache';
import { DatasetService } from '../server/service';
import { linkedWorkbook } from '../tests/linked-workbook';
import { CUT } from '../tests/hierarchy-fixtures';

// Только синтетическая книга и временный кэш. Пользовательский кэш не читается.
const before = process.argv[2];
if (!before) throw new Error('Укажите каталог резервной копии исходников до изменения.');
await access(path.join(before, 'server/cache.ts'));
const oldCache = await import(pathToFileURL(path.join(before, 'server/cache.ts')).href);
const oldService = await import(pathToFileURL(path.join(before, 'server/service.ts')).href);
const directory = await mkdtemp(path.join(os.tmpdir(), 'epic-rollback-check-'));
const noJira = async () => { throw new Error('Проверка отката не читает Jira.'); };
try {
  const book = XLSX.read(linkedWorkbook(), { type: 'buffer' });
  delete book.Sheets['Элементы']; delete book.Sheets['Связи'];
  book.SheetNames = book.SheetNames.filter(name => !['Элементы', 'Связи'].includes(name));
  book.Sheets['Параметры'] = XLSX.utils.aoa_to_sheet([['asOf', CUT]]);
  const previous = new oldService.DatasetService(new oldCache.CacheStore(directory), () => CUT, noJira);
  previous.import(XLSX.write(book, { type: 'buffer', bookType: 'xlsx' }), 'before.xlsx');
  await previous.waitForIdle();
  const previousDataset = previous.getDataset();
  assert(previousDataset);
  const savedBefore = await readFile(path.join(directory, 'dataset.json'));
  const next = new DatasetService(new CacheStore(directory), () => CUT, noJira);
  await next.initialize();
  assert.equal(next.getDataset()?.hierarchy, undefined);
  next.import(linkedWorkbook(), 'after.xlsx'); await next.waitForIdle();
  assert(next.getDataset()?.hierarchy);
  // Откат возвращает вместе исходники и сырой кэш, не только формат или dist.
  await writeFile(path.join(directory, 'dataset.json'), savedBefore, { mode: 0o600 });
  const restored = new oldService.DatasetService(new oldCache.CacheStore(directory), () => CUT, noJira);
  await restored.initialize();
  assert.deepEqual(restored.getDataset(), previousDataset);
  console.log(JSON.stringify({ result: 'passed', oldCacheLoads: true, newHierarchySaves: true, rollbackRestoresDataset: true, jiraCalls: 0 }));
} finally {
  await rm(directory, { recursive: true, force: true });
}
