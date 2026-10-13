import { afterEach, describe, expect, it } from 'vitest';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { CacheStore } from '../server/cache';
import { DatasetService, buildDataset } from '../server/service';
import { parseWorkbook } from '../server/import';
import { AS_OF, historyWorkbook, workbook } from './fixtures';
const directories: string[] = [];
afterEach(async () => { for (const dir of directories.splice(0)) await rm(dir, { recursive: true, force: true }); });
async function oldCache(withHistory = true) {
  const dir = await mkdtemp(path.join(os.tmpdir(), 'hf-migrate-')); directories.push(dir);
  const selection = parseWorkbook(withHistory ? historyWorkbook() : workbook(), 'legacy.xlsx', AS_OF);
  const old = { schemaVersion: 2, selection, dataset: buildDataset(selection, AS_OF, 'old-id') };
  const raw = JSON.stringify(old); await writeFile(path.join(dir, 'dataset.json'), raw);
  return { dir, old, raw };
}
describe('AC-12: старый кэш → миграция без подмены чисел и происхождения', () => {
  it('v2 мигрируется в v3 с однократной точной резервной копией; TTM и срез сохранены', async () => {
    const { dir, old, raw } = await oldCache();
    const service = new DatasetService(new CacheStore(dir)); await service.initialize();
    const data = service.getDataset();
    expect(data?.schemaVersion).toBe(3); expect(data?.id).toBe('old-id');
    expect(data?.asOf).toBe(AS_OF); expect(data?.epics[0].ttmMs).toBe(old.dataset.epics[0].ttmMs);
    expect(await readFile(path.join(dir, 'dataset.v2.backup.json'), 'utf8')).toBe(raw);
    expect(JSON.parse(await readFile(path.join(dir, 'dataset.json'), 'utf8')).calculationProfile).toBe('legacy-v2');
    const next = new DatasetService(new CacheStore(dir)); await next.initialize(); expect(next.getDataset()).toEqual(data);
    expect(() => next.refresh(data!.id)).toThrow(/автономный/i);
  });
  it('для агрегатов без истории время импорта не становится моментом среза', async () => {
    const { dir } = await oldCache(false), service = new DatasetService(new CacheStore(dir));
    await service.initialize(); expect(service.getDataset()?.asOf).toBeNull();
  });
  it('неизвестный профиль не переинтерпретируется и не перезаписывается', async () => {
    const { dir } = await oldCache();
    const raw = JSON.stringify({ schemaVersion: 3, calculationProfile: 'future' });
    await writeFile(path.join(dir, 'dataset.json'), raw);
    await expect(new CacheStore(dir).read()).rejects.toMatchObject({ code: 'CACHE_INVALID' });
    expect(await readFile(path.join(dir, 'dataset.json'), 'utf8')).toBe(raw);
  });
});
