import { buildHierarchy } from './related-timeline';
import { randomUUID } from 'node:crypto';
import type { Dataset, ImportedSelection } from '../shared/types';
import { calculateTimeline, unavailableTimeline } from './timeline';

/** Pinned legacy-v2 numeric rules; Jira proof requirements belong to jira/dataset.ts. */
export function buildDataset(selection: ImportedSelection, savedAt: string, id: string = randomUUID()): Dataset {
  const epics = selection.epics.map(summary => {
    const history = selection.histories[summary.key];
    return history ? calculateTimeline(summary, history, selection.asOf) : {
      ...unavailableTimeline(summary, selection.asOf, selection.historyWarnings[summary.key] ?? []), lastImportedAt: selection.source.importedAt,
    };
  });
  const hierarchy = buildHierarchy(selection.hierarchy);
  return { hierarchy, schemaVersion: 2, id, asOf: selection.asOf, savedAt, source: selection.source, epics,
    quality: (!hierarchy || hierarchy.coverage === 'complete') && epics.every(epic => epic.quality === 'complete') ? 'complete' : 'partial', warnings: selection.warnings };
}
