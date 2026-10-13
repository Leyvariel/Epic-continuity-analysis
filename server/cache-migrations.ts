import type { LegacyCacheStateV3 } from '../shared/contracts';
import type { ImportedSelection } from '../shared/types';
import { buildDataset } from './dataset';
export function migrateLegacy(selection: ImportedSelection, savedAt: string, id?: string): LegacyCacheStateV3 {
  const old = buildDataset(selection, savedAt, id);
  return { schemaVersion: 3, calculationProfile: 'legacy-v2', selection, dataset: {
    ...old, schemaVersion: 3, calculationProfile: 'legacy-v2', asOf: Object.keys(selection.histories).length || selection.hierarchy ? selection.asOf : null,
    syncStartedAt: null, syncFinishedAt: null, source: { ...selection.source, kind: 'file', format: 'xlsx', historyMode: 'file' },
  } };
}
