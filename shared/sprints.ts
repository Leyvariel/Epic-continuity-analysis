import type { Coverage } from './contracts';
export const SPRINT_LIMITS = { boards: 100, sprints: 10_000, pages: 200, relations: 50_000, concurrency: 4 } as const;
export interface SprintRecord {
  id: string; name: string; state: 'future' | 'active' | 'closed' | 'unknown';
  startDate: string | null; endDate: string | null; completeDate: string | null; activatedDate: string | null;
  originBoardId: string | null;
}
export interface SprintChange { id: string; at: string; fromIds: string[]; toIds: string[] }
export interface SprintTaskInput {
  issueId: string; observedAt: string; sprintIds: string[]; changes: SprintChange[];
  membershipCoverage: Coverage; rosterCoverage: Coverage; subtaskIds: string[]; uncertainSubtaskIds: string[];
  calendarIds: string[]; calendarCoverage: Coverage; warnings: string[];
}
export interface SprintCalendar { boardId: string; sprintIds: string[]; coverage: Coverage; warnings: string[] }
export interface SprintDiagnostics { primaryNodes:number; addedSubtasks:number; unreadSubtasks:number; limits:string[] }
export interface SprintInputs {
  diagnostics?: SprintDiagnostics;
  version: 1; asOf: string; mode: 'current-subtasks';
  tasks: Record<string, SprintTaskInput>; sprints: Record<string, SprintRecord>; calendars: Record<string, SprintCalendar>;
  warnings: string[];
}
export interface SprintInterval { start: string; end: string }
export interface SprintSegment extends SprintInterval {
  sprintId: string; lifecycle: 'active' | 'closed'; name: string; boardId: string | null; plannedEnd: string | null;
  state: 'work' | 'empty' | 'unknown' | 'active-empty'; taskKeys: string[]; subtaskKeys: string[]; warnings: string[];
  coveredBy: string[];
}
export interface SprintRow {
  issueId: string; segments: SprintSegment[]; warnings: string[];
  /** Display-only filter for task rows; full segments remain available for epic analysis. */
  hiddenSprintIds?: string[];
  /** Confirmed absence of any descendant sprint membership; independent of work statuses. */
  gaps: SprintInterval[]; preliminary: SprintInterval[]; unknown: SprintInterval[];
  phases: (SprintInterval & { status: string })[];
}
export interface SprintAnalysis { diagnostics?: SprintDiagnostics; asOf: string; mode: 'current-subtasks'; rows: Record<string, SprintRow>; warnings: string[] }
