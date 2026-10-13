import { analyzeSprints } from '../sprint-analysis';
import { buildHierarchy } from '../related-timeline';
import { randomUUID } from 'node:crypto';
import type { JiraDataset, JiraInputs } from '../../shared/contracts';
import { unavailableTimeline } from '../timeline';
import { calculateJiraTimeline } from './normalize';
export function buildJiraDataset(inputs: JiraInputs, savedAt: string, id: string = randomUUID()): JiraDataset {
  const epics = inputs.epics.map(summary => {
    const issueId = inputs.audit.entries.find(e => e.key === summary.key && e.decision === 'included')?.issueId;
    const history = issueId ? inputs.histories[`jira:${issueId}`] : undefined;
    return history ? calculateJiraTimeline(summary, history, inputs.asOf) : {
      ...unavailableTimeline(summary, inputs.asOf, inputs.historyWarnings[summary.key] ?? []), statusCoverage: 'unavailable' as const, flagCoverage: 'unavailable' as const,
    };
  });
  const hierarchy = buildHierarchy(inputs.hierarchy);
  const sprintAnalysis = inputs.sprintInputs && inputs.hierarchy ? analyzeSprints(inputs.hierarchy, inputs.sprintInputs) : undefined;
  return { ...(sprintAnalysis ? { sprintAnalysis } : {}), hierarchy, schemaVersion: 3, calculationProfile: 'jira-v3', id, asOf: inputs.asOf, savedAt, source: inputs.source,
    syncStartedAt: inputs.syncStartedAt, syncFinishedAt: inputs.syncFinishedAt, audit: inputs.audit, epics, warnings: inputs.warnings,
    quality: (!hierarchy || hierarchy.coverage === 'complete') && inputs.audit.sourceCoverage === 'complete' && inputs.audit.eligibilityCoverage === 'complete' && !inputs.audit.entries.some(e => e.decision === 'invalid') && epics.every(e => e.quality === 'complete') ? 'complete' : 'partial' };
}
