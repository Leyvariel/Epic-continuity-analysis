import type { HierarchyInput, Hierarchy } from './hierarchy';
export type Stage = 'preparation' | 'validation' | 'scoring' | 'solution' | 'ready' | 'implementation' | 'experiment' | 'evaluation';
export type StatusKind = Stage | 'open' | 'closed' | 'unknown';
export type Quality = 'complete' | 'partial';

export interface DataWarning {
  code: string;
  message: string;
  severity: 'warning' | 'error';
  key?: string;
  row?: number;
}

export interface EpicSummary {
  key: string;
  title: string;
  type: 'HF';
  resolution: string;
  sourceRow?: number;
  excelAggregates: Record<string, number>;
  excelColumns?: string[];
  sourceMetadata?: Record<string, string>;
}

export interface ImportSource {
  filename: string;
  sheet: string;
  importedAt: string;
  totalRows: number;
  excludedDF: number;
  excludedRejected: number;
  invalidRows: number;
  duplicates: number;
}

export interface ImportedSelection {
  hierarchy?: HierarchyInput;
  source: ImportSource;
  epics: EpicSummary[];
  warnings: DataWarning[];
  asOf: string;
  histories: Record<string, TableHistory>;
  historyWarnings: Record<string, DataWarning[]>;
}

export interface StatusInterval {
  order?: number;
  status: string;
  kind: StatusKind;
  code: string;
  start: string;
  end: string;
  durationMs: number;
  openEnded: boolean;
}

export interface ImpedimentInterval {
  start: string;
  end: string;
  durationMs: number;
  openEnded: boolean;
}

export interface StatusChange {
  id: string;
  at: string;
  from: string;
  to: string;
  fromId?: string;
  toId?: string;
  order?: number;
}

export interface FlagChange {
  id: string;
  at: string;
  from: boolean;
  to: boolean;
}

// Normalized history supplied in a local table. No external data sources.
export interface TableHistory {
  key: string;
  title: string;
  historyStart: string;
  updated: string;
  currentStatus: string;
  currentStatusId?: string;
  resolution: string;
  assignee: string;
  issueType: string;
  importedAt: string;
  statusChanges: StatusChange[];
  flagChanges: FlagChange[];
  currentFlag: boolean;
  flagAvailable: boolean;
  historyCount: number;
  warnings: DataWarning[];
}

export interface EpicTimeline {
  statusCoverage?: 'complete' | 'partial' | 'unavailable';
  flagCoverage?: 'complete' | 'partial' | 'unavailable';
  ttmState: 'not-started' | 'running' | 'finished' | 'indeterminate' | 'not-present';
  initialOpenIntervals: StatusInterval[];
  preTtmIntervals?: StatusInterval[];
  summary: EpicSummary;
  metadata: Omit<TableHistory, 'statusChanges' | 'flagChanges' | 'warnings'> | null;
  quality: Quality;
  asOf: string;
  lastImportedAt: string | null;
  start: string | null;
  end: string | null;
  ttmMs: number | null;
  isOpen: boolean;
  returnToOpenMs: number | null;
  durations: Record<Stage, number> | null;
  intervals: StatusInterval[];
  impediments: ImpedimentInterval[];
  impedimentMs: number | null;
  transitions: StatusChange[];
  warnings: DataWarning[];
}

export interface Dataset {
  hierarchy?: Hierarchy;
  schemaVersion: 2;
  id: string;
  asOf: string;
  savedAt: string;
  quality: Quality;
  source: ImportSource;
  epics: EpicTimeline[];
  warnings: DataWarning[];
}

export interface ImportJob {
  id: string;
  status: 'queued' | 'running' | 'completed' | 'failed';
  total: number;
  completed: number;
  currentKey: string | null;
  errors: DataWarning[];
  dataset: Dataset | null;
  createdAt: string;
}
