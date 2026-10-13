import { z } from 'zod';
import { HIERARCHY_LIMITS } from '../shared/hierarchy';
const timestamp = z.string().refine(v => Number.isFinite(Date.parse(v)));
const warning = z.object({ code: z.string(), message: z.string(), severity: z.enum(['warning', 'error']), key: z.string().optional(), row: z.number().optional() });
const coverage = z.enum(['complete', 'partial', 'unavailable']);
const history = z.object({
  key: z.string(), title: z.string(), historyStart: timestamp, updated: timestamp, currentStatus: z.string(), currentStatusId: z.string().optional(), resolution: z.string(), assignee: z.string(), issueType: z.string(), importedAt: timestamp,
  statusChanges: z.array(z.object({ id: z.string(), at: timestamp, from: z.string(), to: z.string(), fromId: z.string().optional(), toId: z.string().optional(), order: z.number().optional() })),
  flagChanges: z.array(z.object({ id: z.string(), at: timestamp, from: z.boolean(), to: z.boolean() })), currentFlag: z.boolean(), flagAvailable: z.boolean(), historyCount: z.number().int().nonnegative(), warnings: z.array(warning),
  source: z.literal('jira').optional(), statusCoverage: coverage.optional(), flagCoverage: coverage.optional(), initialStateProven: z.boolean().optional(),
  proof: z.object({ expected: z.number().int().nonnegative(), received: z.number().int().nonnegative(), terminal: z.boolean(), adapterVersion: z.string() }).optional(),
});
const node = z.strictObject({ id: z.string().min(1), key: z.string(), title: z.string(), type: z.enum(['epic', 'task', 'subtask', 'unknown']), resolution: z.string().nullable(), created: timestamp.nullable(), currentStatus: z.string(), currentStatusId: z.string().optional(), statusCategories: z.record(z.string(), z.string()), history: history.optional(), historyCoverage: coverage, branchCoverage: coverage, warnings: z.array(warning) });
export const hierarchySchema = z.strictObject({ version: z.literal(1), asOf: timestamp, roots: z.record(z.string(), z.string()), nodes: z.record(z.string(), node), edges: z.array(z.strictObject({ parent: z.string(), child: z.string() })).max(HIERARCHY_LIMITS.edges), coverage, warnings: z.array(warning) }).superRefine((value, ctx) => {
  if (Object.keys(value.nodes).length > HIERARCHY_LIMITS.nodes) ctx.addIssue({ code: 'custom', message: 'Превышен предел узлов' });
  for (const [id, item] of Object.entries(value.nodes)) {
    if (id !== item.id) ctx.addIssue({ code: 'custom', message: 'Идентичность узла не совпадает' });
    const h = item.history;
    if (h?.source === 'jira' && (!h.proof || h.statusCoverage === undefined || h.flagCoverage === undefined || h.initialStateProven === undefined)) ctx.addIssue({ code: 'custom', message: 'История Jira не содержит доказательств полноты' });
  }
  if (Object.values(value.roots).some(id => !value.nodes[id]) || value.edges.some(e => !value.nodes[e.parent] || !value.nodes[e.child])) ctx.addIssue({ code: 'custom', message: 'Ссылка на отсутствующий узел' });
  if (new Set(value.edges.map(e => JSON.stringify([e.parent, e.child]))).size !== value.edges.length) ctx.addIssue({ code: 'custom', message: 'Повтор ребра' });
});
