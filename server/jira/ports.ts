import type { HierarchyInput } from '../../shared/hierarchy';
import type { SprintInputs } from '../../shared/sprints';
import type { DataWarning } from '../../shared/types';
import type { Candidate, HistorySnapshot } from '../../shared/contracts';

/** Values here must be resolved by a verified version-specific adapter, never guessed by the UI. */
export interface JiraIssue {
  isSubtask?: boolean; links?: { parent: string; child: string; childKey?: string }[]; linksKnown?: boolean; hierarchyWarnings?: DataWarning[]; statusCategory?: string;
  id: string; key: string; title: string; flow: 'HF' | 'DF' | 'unknown'; isEpic: boolean;
  resolution: string; currentStatus: string; created: string; updated: string;
  currentStatusId?: string;
  assignee: string; issueType: string;
}
export interface BoardSelection {
  id: string; name: string; fingerprint: string; complete: boolean;
  candidates: Candidate[];
}
export interface JiraGateway {
  readSprintInputs?(graph: HierarchyInput, asOf: string, signal: AbortSignal): Promise<SprintInputs>;
  getStatusCategories?(signal: AbortSignal): Promise<Record<string, string>>;
  getIssue(idOrKey: string, signal: AbortSignal): Promise<JiraIssue>;
  getHistory(issue: JiraIssue, signal: AbortSignal): Promise<HistorySnapshot>;
  readBoard(id: string, signal: AbortSignal): Promise<BoardSelection>;
  close?(): void;
}
export type GatewayFactory = (signal: AbortSignal) => Promise<JiraGateway>;
