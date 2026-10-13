import { sprintInputsSchema, sprintLinkErrors } from './sprint-schema';
import { hierarchySchema } from '../hierarchy-schema';
import { z } from 'zod';
const timestamp = z.string().regex(/T.*(?:Z|[+-]\d{2}:?\d{2})$/).refine(v => Number.isFinite(Date.parse(v)));
const key = z.string().regex(/^[A-Z][A-Z0-9_]*-\d+$/);
const coverage = z.enum(['complete', 'partial', 'unavailable']);
const warning = z.object({ code: z.string(), message: z.string(), severity: z.enum(['warning', 'error']), key: z.string().optional(), row: z.number().optional() });
const control = z.object({ metadata: z.object({ title: z.string().optional(), type: z.string().optional(), currentStatus: z.string().optional(), resolution: z.string().optional(), epicKind: z.string().optional() }), aggregates: z.record(z.string(), z.number().nonnegative()), columns: z.array(z.string()) });
const candidate = z.object({ requestedKey: key, rows: z.array(z.number().int().positive()), issueId: z.string().min(1).optional(), control: control.optional() });
export const sourceSchema = z.discriminatedUnion('kind', [
  z.object({ kind: z.literal('file'), format: z.enum(['csv', 'xlsx']), filename: z.string(), sheet: z.string().nullable(), importedAt: timestamp, historyMode: z.literal('jira') }),
  z.object({ kind: z.literal('keys'), importedAt: timestamp, historyMode: z.literal('jira') }),
  z.object({ kind: z.literal('board'), origin: z.literal('https://hq.tutu.ru'), boardId: z.string().regex(/^[1-9]\d*$/), boardName: z.string(), url: z.string(), visibility: z.literal('persistent-settings'), fingerprint: z.string(), historyMode: z.literal('jira') }),
  z.object({ kind: z.literal('epic'), origin: z.literal('https://hq.tutu.ru'), requestedKey: key, key, issueId: z.string().min(1), url: z.string(), historyMode: z.literal('jira') }),
]);
export const historySchema = z.object({
  source: z.literal('jira'), statusCoverage: coverage, flagCoverage: coverage, initialStateProven: z.boolean(),
  proof: z.object({ expected: z.number().int().nonnegative(), received: z.number().int().nonnegative(), terminal: z.boolean(), adapterVersion: z.string().min(1) }),
  key, title: z.string(), historyStart: timestamp, updated: timestamp, currentStatus: z.string(), resolution: z.string(), assignee: z.string(), issueType: z.string(), importedAt: timestamp,
  currentStatusId: z.string().optional(),
  statusChanges: z.array(z.object({ id: z.string(), at: timestamp, from: z.string(), to: z.string(), fromId: z.string().optional(), toId: z.string().optional(), order: z.number().int().nonnegative().optional() })),
  flagChanges: z.array(z.object({ id: z.string(), at: timestamp, from: z.boolean(), to: z.boolean() })),
  currentFlag: z.boolean(), flagAvailable: z.boolean(), historyCount: z.number().int().nonnegative(), warnings: z.array(warning),
});
export const jiraInputsSchema = z.object({
  hierarchy: hierarchySchema.optional(),
  sprintInputs: sprintInputsSchema.optional(),
  source: sourceSchema, candidates: z.array(candidate),
  audit: z.object({ sourceCoverage: coverage, eligibilityCoverage: coverage, inputRows: z.number().int().nonnegative(), duplicates: z.number().int().nonnegative(), resolvedIssues: z.number().int().nonnegative(),
    entries: z.array(z.object({ requestedKey: z.string(), rows: z.array(z.number().int().positive()), issueId: z.string().optional(), key: key.optional(), decision: z.enum(['included', 'excluded-df', 'excluded-rejected', 'excluded-not-epic', 'unresolved', 'invalid']), reason: z.string() })) }),
  asOf: timestamp, syncStartedAt: timestamp, syncFinishedAt: timestamp,
  epics: z.array(z.object({ key, title: z.string(), type: z.literal('HF'), resolution: z.string(), sourceRow: z.number().int().positive().optional(), excelAggregates: z.record(z.string(), z.number()), excelColumns: z.array(z.string()).optional(), sourceMetadata: z.record(z.string(), z.string()).optional() })),
  histories: z.record(z.string(), historySchema), historyWarnings: z.record(z.string(), z.array(warning)), warnings: z.array(warning),
}).superRefine((value, ctx) => {
  if (value.hierarchy && Date.parse(value.hierarchy.asOf) !== Date.parse(value.asOf)) ctx.addIssue({ code: 'custom', message: 'Срез иерархии не совпадает со срезом набора' });
  if(value.sprintInputs)for(const message of sprintLinkErrors(value.sprintInputs,value.hierarchy))ctx.addIssue({code:'custom',message});
  const included = new Set(value.audit.entries.filter(e => e.decision === 'included').map(e => e.key));
  if (included.size !== value.epics.length || value.epics.some(e => !included.has(e.key)) || new Set(value.epics.map(e => e.key)).size !== value.epics.length) ctx.addIssue({ code: 'custom', message: 'Selection does not match audit' });
  if (value.source.kind === 'epic' && (value.candidates.length !== 1 || value.candidates[0].issueId !== value.source.issueId)) ctx.addIssue({ code: 'custom', message: 'Single epic identity mismatch' });
  if (value.source.kind === 'keys') {
    const invalid = value.audit.entries.filter(entry => entry.decision === 'invalid');
    const decisions = value.audit.entries.filter(entry => entry.decision !== 'invalid');
    const candidateLineNumbers = value.candidates.flatMap(candidate => candidate.rows);
    const invalidLineNumbers = invalid.flatMap(entry => entry.rows);
    if (!value.audit.entries.length || value.audit.inputRows === 0 || value.audit.sourceCoverage !== 'complete') ctx.addIssue({ code: 'custom', message: 'Empty or incomplete keys selection' });
    if (decisions.length !== value.candidates.length || value.candidates.some(candidate => !candidate.rows.length || decisions.filter(entry => entry.requestedKey === candidate.requestedKey && JSON.stringify(entry.rows) === JSON.stringify(candidate.rows)).length !== 1)) ctx.addIssue({ code: 'custom', message: 'Keys decisions do not match candidates' });
    if (invalid.some(entry => !entry.rows.length || !entry.reason)) ctx.addIssue({ code: 'custom', message: 'Invalid keys audit rows' });
    const allRows = [...candidateLineNumbers, ...invalidLineNumbers];
    // Several comma-separated entries can share one physical line, including invalid entries.
    if (allRows.length !== value.audit.inputRows) ctx.addIssue({ code: 'custom', message: 'Keys input rows do not match audit' });
  }
  if (Date.parse(value.asOf) !== Date.parse(value.syncStartedAt) || Date.parse(value.syncFinishedAt) < Date.parse(value.asOf)) ctx.addIssue({ code: 'custom', message: 'Invalid snapshot bounds' });
});
export const jiraCacheSchema = z.object({ schemaVersion: z.literal(3), calculationProfile: z.literal('jira-v3'), inputs: jiraInputsSchema,
  dataset: z.object({ id: z.string(), savedAt: timestamp }) });
