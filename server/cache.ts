import { hierarchySchema } from './hierarchy-schema';
import { chmod, mkdir, readFile, rename, writeFile, unlink } from 'node:fs/promises';
import { randomUUID } from 'node:crypto';
import path from 'node:path';
import { z } from 'zod';
import type { Dataset, ImportedSelection } from '../shared/types';
import { AppError } from './errors';
import type { JiraCacheState, LegacyCacheStateV3 } from '../shared/contracts';
import { jiraCacheSchema } from './jira/cache-schema';
import { migrateLegacy } from './cache-migrations';

export interface CacheState {
  schemaVersion: 2;
  selection: ImportedSelection;
  dataset: Dataset;
}

const warning = z.object({ code: z.string(), message: z.string(), severity: z.enum(['warning', 'error']), key: z.string().optional(), row: z.number().optional() });
const summary = z.object({ key: z.string().regex(/^[A-Z][A-Z0-9_]*-\d+$/), title: z.string(), type: z.literal('HF'), resolution: z.string(), sourceRow: z.number(), excelAggregates: z.record(z.string(), z.number()), excelColumns: z.array(z.string()).optional(), sourceMetadata: z.record(z.string(), z.string()).optional() });
const timestamp = z.string().refine(value => Number.isFinite(Date.parse(value)));
const source = z.object({ filename: z.string(), sheet: z.string(), importedAt: timestamp, totalRows: z.number(), excludedDF: z.number(), excludedRejected: z.number(), invalidRows: z.number(), duplicates: z.number() });
const snapshot = z.object({
  key: z.string(), title: z.string(), historyStart: timestamp, updated: timestamp, currentStatus: z.string(), resolution: z.string(),
  assignee: z.string(), issueType: z.string(), importedAt: timestamp,
  statusChanges: z.array(z.object({ id: z.string(), at: timestamp, from: z.string(), to: z.string() })),
  flagChanges: z.array(z.object({ id: z.string(), at: timestamp, from: z.boolean(), to: z.boolean() })),
  currentFlag: z.boolean(), flagAvailable: z.boolean(), historyCount: z.number(), warnings: z.array(warning),
});
// Read raw inputs, then rebuild all derived timelines. Never trust serialized computed values.
const inputsSchema = z.object({
  schemaVersion: z.literal(2), selection: z.object({ hierarchy: hierarchySchema.optional(), source, epics: z.array(summary), warnings: z.array(warning),
    asOf: timestamp, histories: z.record(z.string(), snapshot), historyWarnings: z.record(z.string(), z.array(warning)) }).superRefine((value, ctx) => { if (value.hierarchy && Date.parse(value.hierarchy.asOf) !== Date.parse(value.asOf)) ctx.addIssue({ code: 'custom', message: 'Срезы набора и иерархии различаются' }); }),
  dataset: z.object({ schemaVersion: z.literal(2), id: z.string(), savedAt: timestamp }),
});
export type CachedInputs = z.infer<typeof inputsSchema>;
const legacyV3Schema = inputsSchema.extend({ schemaVersion: z.literal(3), calculationProfile: z.literal('legacy-v2'), dataset: z.object({ id: z.string(), savedAt: timestamp }) });

export class CacheStore {
  constructor(private readonly directory: string) {}
  async read(): Promise<z.infer<typeof legacyV3Schema> | z.infer<typeof jiraCacheSchema> | null> {
    let data: string;
    try { data = await readFile(path.join(this.directory, 'dataset.json'), 'utf8'); }
    catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') return null;
      throw new AppError('CACHE_READ', 'Не удалось прочитать локальный кэш.', 500);
    }
    let parsed: CachedInputs | z.infer<typeof legacyV3Schema> | z.infer<typeof jiraCacheSchema>;
    try {
      const raw = JSON.parse(data);
      parsed = raw.schemaVersion === 3 ? raw.calculationProfile === 'legacy-v2' ? legacyV3Schema.parse(raw) : jiraCacheSchema.parse(raw) : inputsSchema.parse(raw);
    } catch { throw new AppError('CACHE_INVALID', 'Локальный кэш повреждён или имеет неизвестный профиль расчёта. Исходный файл сохранён.', 500); }
    if (parsed.schemaVersion === 2) {
      try { await writeFile(path.join(this.directory, 'dataset.v2.backup.json'), data, { mode: 0o600, flag: 'wx' }); }
      catch (error) { if ((error as NodeJS.ErrnoException).code !== 'EEXIST') throw new AppError('CACHE_MIGRATION', 'Не удалось создать резервную копию v2; исходный кэш сохранён.', 500); }
      const migrated = migrateLegacy(parsed.selection, parsed.dataset.savedAt, parsed.dataset.id);
      await this.write(migrated);
      return legacyV3Schema.parse(migrated);
    }
    return parsed;
  }
  async write(state: CacheState | JiraCacheState | LegacyCacheStateV3): Promise<void> {
    const temporary = path.join(this.directory, `dataset-${randomUUID()}.tmp`);
    try {
      await mkdir(this.directory, { recursive: true, mode: 0o700 });
      await chmod(this.directory, 0o700);
      if (state.schemaVersion === 3) { if (state.calculationProfile === 'jira-v3') jiraCacheSchema.parse(state); else legacyV3Schema.parse(state); }
      await writeFile(temporary, JSON.stringify(state), { mode: 0o600, flag: 'wx' });
      await rename(temporary, path.join(this.directory, 'dataset.json'));
    } catch { throw new AppError('CACHE_WRITE', 'Не удалось сохранить кэш. Предыдущий сохранённый набор не заменён.', 500); }
    finally { await unlink(temporary).catch(() => {}); }
  }
}
