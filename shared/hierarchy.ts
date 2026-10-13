import type { DataWarning, TableHistory } from './types';
import type { HistorySnapshot } from './contracts';
export type HierarchyCoverage = 'complete' | 'partial' | 'unavailable';
export interface HierarchyNodeInput {
  id: string; key: string; title: string; type: 'epic' | 'task' | 'subtask' | 'unknown';
  resolution: string | null; created: string | null; currentStatus: string; currentStatusId?: string;
  statusCategories: Record<string, string>; history?: TableHistory | HistorySnapshot;
  historyCoverage: HierarchyCoverage; branchCoverage: HierarchyCoverage; warnings: DataWarning[];
}
export interface HierarchyInput {
  version: 1; asOf: string; roots: Record<string, string>; nodes: Record<string, HierarchyNodeInput>;
  edges: { parent: string; child: string }[]; coverage: HierarchyCoverage; warnings: DataWarning[];
}
export interface RelatedInterval { status: string; start: string; end: string; durationMs: number }
export interface RelatedTimeline {
  state: 'complete' | 'unavailable' | 'not-present'; intervals: RelatedInterval[];
  start: string | null; end: string | null; closed: boolean; terminalStatus: string | null;
  closureSource: 'category' | 'name' | null; warnings: DataWarning[];
}
export interface HierarchyNode extends HierarchyNodeInput { timeline: RelatedTimeline }
export interface Hierarchy extends Omit<HierarchyInput, 'nodes'> { nodes: Record<string, HierarchyNode> }
export const HIERARCHY_LIMITS = { nodes: 10_000, edges: 50_000, page: 200 } as const;
