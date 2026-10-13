import { collectSprintInputs } from './sprints';
import type { HierarchyInput } from '../../shared/hierarchy';
import { z } from 'zod';
import { canonical, normalize } from '../../shared/statuses';
import type { HistorySnapshot } from '../../shared/contracts';
import type { BoardSelection, JiraGateway, JiraIssue } from './ports';
import { AppError } from '../errors';
import { boardProfileSchema, readBoard } from './board';
import { collectPages } from './pagination';
import { HIERARCHY_LIMITS } from '../../shared/hierarchy';

export const profileSchema = z.object({ version: z.literal('9.12.10'), epicTypeIds: z.array(z.string()).min(1), flagFieldId: z.string().regex(/^customfield_\d+$/), flagOptionId: z.string(), historyMode: z.literal('issue-expand'), flowRule: z.literal('status-prefix'), boards: z.array(boardProfileSchema).optional() });
export type JiraProfile = z.infer<typeof profileSchema>;
interface Client { get(path: string, params: Record<string, string>, signal: AbortSignal): Promise<unknown>; close?(): void }
const timestamp = z.string().regex(/T.*(?:Z|[+-]\d{2}:?\d{2})$/).refine(v => Number.isFinite(Date.parse(v)));
const named = z.object({ id: z.string(), name: z.string(), subtask: z.unknown().optional(), statusCategory: z.unknown().optional() });
const issueReference = z.object({ id: z.string().regex(/^\d+$/), key: z.string().regex(/^[A-Z][A-Z0-9_]*-\d+$/) });
const epicMembersPage = z.object({ startAt: z.number().int().nonnegative(), total: z.number().int().nonnegative(), issues: z.array(issueReference) });
const rawIssue = z.object({ id: z.string().regex(/^\d+$/), key: z.string().regex(/^[A-Z][A-Z0-9_]*-\d+$/), fields: z.object({ summary: z.string(), status: named, issuetype: named, resolution: named.nullable(), created: timestamp, updated: timestamp, assignee: z.object({ displayName: z.string() }).nullable().optional() }).catchall(z.unknown()) });
const changeItem = z.object({ field: z.string(), fieldId: z.string().optional(), from: z.string().nullable().optional(), to: z.string().nullable().optional(), fromString: z.string().nullable().optional(), toString: z.string().nullable().optional() });
const rawWithHistory = rawIssue.extend({ changelog: z.object({ startAt: z.number().int().nonnegative(), maxResults: z.number().int().nonnegative(), total: z.number().int().nonnegative(), histories: z.array(z.object({ id: z.string(), created: timestamp, items: z.array(changeItem) })) }) });
function schemaParse<T>(schema: z.ZodType<T>, value: unknown): T {
  const result = schema.safeParse(value);
  if (!result.success) throw new AppError('JIRA_SCHEMA', 'Ответ Jira не соответствует проверенной схеме. Данные не заменены.');
  return result.data;
}
export class ServerJiraAdapter implements JiraGateway {
  constructor(private readonly client: Client, private readonly profile: JiraProfile, private readonly now = () => new Date().toISOString()) { profileSchema.parse(profile); }
  readSprintInputs(graph: HierarchyInput, asOf: string, signal: AbortSignal) { return collectSprintInputs(this.client, this, graph, asOf, signal); }
  close() { this.client.close?.(); }
  private issuePath(idOrKey: string) {
    if (!/^(?:\d+|[A-Z][A-Z0-9_]*-\d+)$/.test(idOrKey)) throw new AppError('INVALID_KEY', 'Некорректный id или ключ Jira.');
    return `/rest/api/2/issue/${idOrKey}`;
  }
  private fields() { return `summary,status,issuetype,resolution,created,updated,assignee,issuelinks,${this.profile.flagFieldId}`; }
  private async epicMembers(id: string, signal: AbortSignal) {
    return collectPages(async startAt => {
      const page = schemaParse(epicMembersPage, await this.client.get(`/rest/agile/1.0/epic/${id}/issue`, {
        startAt: String(startAt), maxResults: '100', fields: 'key', jql: 'ORDER BY key ASC',
      }, signal));
      return { startAt: page.startAt, total: page.total, values: page.issues };
    }, { maxItems: HIERARCHY_LIMITS.nodes, maxPages: 200 });
  }
  async getStatusCategories(signal: AbortSignal): Promise<Record<string, string>> {
    const values = z.array(z.object({ id: z.string(), statusCategory: z.object({ key: z.string() }).optional() })).parse(await this.client.get('/rest/api/2/status', {}, signal));
    return Object.fromEntries(values.flatMap(value => value.statusCategory ? [[value.id, value.statusCategory.key]] : []));
  }
  async getIssue(idOrKey: string, signal: AbortSignal): Promise<JiraIssue> {
    const raw = schemaParse(rawIssue, await this.client.get(this.issuePath(idOrKey), { fields: this.fields() }, signal));
    const status = normalize(raw.fields.status.name);
    const matches = [...status.matchAll(/\[(HF|DF)\]/gi)];
    const flow = matches.length === 1 && /^\[(HF|DF)\]/i.test(status) ? matches[0][1].toUpperCase() as 'HF' | 'DF' : 'unknown';
    const links: NonNullable<JiraIssue['links']> = [], hierarchyWarnings: NonNullable<JiraIssue['hierarchyWarnings']> = [];
    let linksKnown = Array.isArray(raw.fields.issuelinks);
    const target = issueReference;
    const linkSchema = z.object({ type: z.object({ outward: z.string(), inward: z.string() }), outwardIssue: target.optional(), inwardIssue: target.optional() });
    for (const value of Array.isArray(raw.fields.issuelinks) ? raw.fields.issuelinks : []) {
      const result = linkSchema.safeParse(value);
      if (!result.success) { linksKnown = false; continue; }
      const link = result.data, labels = [canonical(link.type.outward), canonical(link.type.inward)];
      if (!labels.includes('contains') || !labels.includes('is contained in')) continue;
      for (const [other, label] of [[link.outwardIssue, labels[0]], [link.inwardIssue, labels[1]]] as const) {
        if (!other) continue;
        links.push(label === 'contains' ? { parent: raw.id, child: other.id, childKey: other.key } : { parent: other.id, child: raw.id, childKey: raw.key });
      }
    }
    const isEpic = this.profile.epicTypeIds.includes(raw.fields.issuetype.id);
    if (isEpic && raw.fields.issuetype.subtask !== true) {
      try {
        // Epic Link membership is separate from issuelinks, including in the Jira UI.
        const members = await this.epicMembers(raw.id, signal);
        const seen = new Set(links.filter(edge => edge.parent === raw.id).map(edge => edge.child));
        for (const member of members) if (!seen.has(member.id)) {
          links.push({ parent: raw.id, child: member.id, childKey: member.key }); seen.add(member.id);
        }
      } catch (error) {
        signal.throwIfAborted();
        if (error instanceof AppError && ['JIRA_UNAUTHORIZED', 'JIRA_NETWORK', 'RATE_LIMITED', 'ABORTED', 'IDENTITY_CHANGED', 'PROFILE_UNVERIFIED', 'JIRA_VERSION_CHANGED'].includes(error.code)) throw error;
        linksKnown = false;
        hierarchyWarnings.push({ code: 'EPIC_MEMBERSHIP_UNAVAILABLE', key: raw.key, message: 'Не удалось подтвердить полный состав эпика по Epic Link. Показаны доступные явные связи; обновите набор для повторной загрузки.', severity: 'warning' });
      }
    }
    if (!linksKnown) hierarchyWarnings.push({ code: 'LINKS_UNKNOWN', key: raw.key, message: 'Состав связей не подтверждён.', severity: 'warning' });
    const category = z.object({ key: z.string() }).safeParse(raw.fields.status.statusCategory);
    const isSubtask = typeof raw.fields.issuetype.subtask === 'boolean' ? raw.fields.issuetype.subtask : undefined;
    return { links, linksKnown, hierarchyWarnings, isSubtask, ...(category.success ? { statusCategory: category.data.key } : {}), id: raw.id, key: raw.key, title: raw.fields.summary, isEpic, flow,
      currentStatus: raw.fields.status.name, currentStatusId: raw.fields.status.id, resolution: raw.fields.resolution?.name ?? '',
      created: raw.fields.created, updated: raw.fields.updated, assignee: raw.fields.assignee?.displayName ?? '', issueType: raw.fields.issuetype.name };
  }
  async getHistory(issue: JiraIssue, signal: AbortSignal): Promise<HistorySnapshot> {
    const raw = schemaParse(rawWithHistory, await this.client.get(this.issuePath(issue.id), { fields: this.fields(), expand: 'changelog' }, signal));
    if (raw.id !== issue.id) throw new AppError('IDENTITY_CHANGED', 'Jira вернула историю другой задачи.');
    const { changelog, fields } = raw;
    const complete = changelog.startAt === 0 && changelog.total === changelog.histories.length && new Set(changelog.histories.map(h => h.id)).size === changelog.total;
    const statusChanges: HistorySnapshot['statusChanges'] = [], flagChanges: HistorySnapshot['flagChanges'] = [];
    let statusValid = true, flagValid = true;
    const readFlag = (value: string | null | undefined) => {
      if (value === null || value === '') return false;
      if (value === undefined) { flagValid = false; return false; }
      try { const ids: unknown = JSON.parse(value); if (Array.isArray(ids)) return ids.some(id => String(id) === this.profile.flagOptionId); }
      catch { /* Unknown encodings are unavailable, not false flags. */ }
      flagValid = false; return false;
    };
    const ordered = [...changelog.histories].sort((a, b) => Date.parse(a.created) - Date.parse(b.created) || a.id.localeCompare(b.id, 'en', { numeric: true }));
    let order = 0;
    for (const record of ordered) for (const [itemIndex, item] of record.items.entries()) {
      const id = `${record.id}:${itemIndex}`, at = new Date(record.created).toISOString();
      if (item.field === 'status' || item.fieldId === 'status') {
        if (!item.from || !item.to || !item.fromString || !item.toString) statusValid = false;
        else statusChanges.push({ id, at, fromId: item.from, toId: item.to, from: item.fromString, to: item.toString, order: order++ });
      } else if (item.field === 'Flagged' || item.fieldId === this.profile.flagFieldId) {
        flagChanges.push({ id, at, from: readFlag(item.from), to: readFlag(item.to) });
      }
    }
    const flagField = z.array(z.object({ id: z.string(), value: z.string() })).nullable().safeParse(fields[this.profile.flagFieldId]);
    const flagAvailable = flagField.success;
    const statusCoverage = complete && statusValid ? 'complete' : 'partial';
    const flagCoverage = !flagAvailable ? 'unavailable' : complete && flagValid ? 'complete' : 'partial';
    return { source: 'jira', key: raw.key, title: fields.summary, historyStart: new Date(fields.created).toISOString(), updated: fields.updated,
      currentStatus: fields.status.name, currentStatusId: fields.status.id, resolution: fields.resolution?.name ?? '', assignee: fields.assignee?.displayName ?? '', issueType: fields.issuetype.name,
      importedAt: this.now(), statusChanges, flagChanges, currentFlag: flagField.success && !!flagField.data?.some(v => v.id === this.profile.flagOptionId), flagAvailable,
      historyCount: changelog.histories.length, statusCoverage, flagCoverage, initialStateProven: complete && statusValid,
      proof: { expected: changelog.total, received: changelog.histories.length, terminal: complete, adapterVersion: `server-${this.profile.version}-issue-expand-v1` },
      warnings: statusCoverage !== 'complete' ? [{ code: 'INCOMPLETE_HISTORY', message: 'Jira не предоставила доказанную полную историю; усечение не принято за успешный результат.', severity: 'error', key: raw.key }] : [],
    };
  }
  async readBoard(id: string, signal: AbortSignal): Promise<BoardSelection> {
    const board = this.profile.boards?.find(board => board.id === id);
    if (!board) throw new AppError('BOARD_PROFILE_UNVERIFIED', 'Для этой доски ещё не проверены постоянные настройки видимости. Файл и отдельный эпик доступны независимо.', 503);
    return readBoard(this.client.get.bind(this.client), board, signal);
  }
}
