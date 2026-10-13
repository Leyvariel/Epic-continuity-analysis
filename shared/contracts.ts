import type { SprintInputs, SprintAnalysis } from './sprints';
import type { HierarchyInput } from './hierarchy';
import type { DataWarning, Dataset as LegacyDataset, EpicSummary, EpicTimeline, TableHistory, ImportedSelection, ImportSource } from './types';

export type Coverage = 'complete' | 'partial' | 'unavailable';
export type SourceDefinition =
  | { kind: 'file'; format: 'csv' | 'xlsx'; filename: string; sheet: string | null; importedAt: string; historyMode: 'jira' }
  | { kind: 'keys'; importedAt: string; historyMode: 'jira' }
  | { kind: 'board'; origin: 'https://hq.tutu.ru'; boardId: string; boardName: string; url: string; visibility: 'persistent-settings'; fingerprint: string; historyMode: 'jira' }
  | { kind: 'epic'; origin: 'https://hq.tutu.ru'; requestedKey: string; key: string; issueId: string; url: string; historyMode: 'jira' };
export interface CandidateControl { metadata: Partial<Record<'title' | 'type' | 'currentStatus' | 'resolution' | 'epicKind', string>>; aggregates: Record<string, number>; columns: string[] }
export interface Candidate { requestedKey: string; rows: number[]; issueId?: string; control?: CandidateControl }
export type Decision = 'included' | 'excluded-df' | 'excluded-rejected' | 'excluded-not-epic' | 'unresolved' | 'invalid';
export interface AuditEntry extends Candidate { key?: string; decision: Decision; reason: string }
export interface SelectionAudit {
  sourceCoverage: Coverage; eligibilityCoverage: Coverage;
  inputRows: number; duplicates: number; resolvedIssues: number; entries: AuditEntry[];
}
export function keyErrorEntries(audit: SelectionAudit): { id: string; entry: AuditEntry }[] {
  const seen = new Set<string>();
  return audit.entries.flatMap((entry, index) => {
    if (entry.decision !== 'invalid' && entry.decision !== 'unresolved') return [];
    if (entry.decision === 'unresolved') {
      const identity = entry.issueId ?? entry.requestedKey;
      if (seen.has(identity)) return [];
      seen.add(identity);
    }
    return [{ id: `error:${index}`, entry }];
  }).sort((a, b) => (a.entry.rows[0] ?? 0) - (b.entry.rows[0] ?? 0));
}
export interface HistorySnapshot extends TableHistory {
  source: 'jira'; statusCoverage: Coverage; flagCoverage: Coverage;
  initialStateProven: boolean;
  proof: { expected: number; received: number; terminal: boolean; adapterVersion: string };
}
export interface JiraDataset extends Omit<LegacyDataset, 'schemaVersion' | 'source'> {
  sprintAnalysis?: SprintAnalysis;
  schemaVersion: 3; source: SourceDefinition; audit: SelectionAudit;
  syncStartedAt: string; syncFinishedAt: string; calculationProfile: 'jira-v3';
}
export interface MigratedLegacyDataset extends Omit<LegacyDataset, 'schemaVersion' | 'source' | 'asOf'> {
  schemaVersion: 3; calculationProfile: 'legacy-v2'; asOf: string | null;
  syncStartedAt: null; syncFinishedAt: null;
  source: ImportSource & { kind: 'file'; format: 'xlsx'; historyMode: 'file' };
}
export interface LegacyCacheStateV3 {
  schemaVersion: 3; calculationProfile: 'legacy-v2'; selection: ImportedSelection; dataset: MigratedLegacyDataset;
}
export type AnyDataset = LegacyDataset | JiraDataset | MigratedLegacyDataset;
export function isJiraDataset(dataset: AnyDataset | null): dataset is JiraDataset { return dataset?.schemaVersion === 3 && dataset.calculationProfile === 'jira-v3'; }
export type JobPhase = 'reading-file' | 'reading-credentials' | 'reading-board' | 'resolving-epic' | 'selecting' | 'reading-history' | 'reading-hierarchy' | 'reading-sprints' | 'calculating' | 'committing';
export interface ImportJobV3 {
  id: string; status: 'queued' | 'running' | 'completed' | 'failed'; phase?: JobPhase;
  total: number | null; completed: number; currentKey: string | null;
  errors: DataWarning[]; dataset: AnyDataset | null; createdAt: string; audit?: SelectionAudit;
  progress?: { found: number; checked: number; selected: number; histories: number };
}
export interface JiraInputs {
  hierarchy?: HierarchyInput;
  sprintInputs?: SprintInputs;
  source: SourceDefinition; candidates: Candidate[]; audit: SelectionAudit;
  asOf: string; syncStartedAt: string; syncFinishedAt: string;
  epics: EpicSummary[]; histories: Record<string, HistorySnapshot>; historyWarnings: Record<string, DataWarning[]>;
  warnings: DataWarning[];
}
export interface JiraCacheState {
  schemaVersion: 3; calculationProfile: 'jira-v3'; inputs: JiraInputs; dataset: JiraDataset;
}
export function defaultMetricsSource(dataset: AnyDataset | null): 'history' | 'excel' {
  return isJiraDataset(dataset) || (dataset?.hierarchy && Object.values(dataset.hierarchy.nodes).some(n => n.timeline.state === 'complete')) || dataset?.epics.some(e => e.ttmMs !== null || e.initialOpenIntervals?.length) ? 'history' : 'excel';
}
export function epicStateLabel(epic: EpicTimeline): string {
  return { 'not-started': 'TTM ещё не начат', running: 'В работе', finished: 'Закрыт', indeterminate: 'Начало или длительность TTM неизвестны', 'not-present': 'Создан после момента среза' }[epic.ttmState];
}
