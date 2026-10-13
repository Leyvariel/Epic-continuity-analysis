import { createHash } from 'node:crypto';
import { z } from 'zod';
import { AppError } from '../errors';
import { collectPages } from './pagination';
import type { BoardSelection } from './ports';

export const boardProfileSchema = z.object({ id: z.string().regex(/^[1-9]\d*$/), completedVisibility: z.literal('all'), configurationFingerprint: z.string().regex(/^[a-f0-9]{64}$/), filterFingerprint: z.string().regex(/^[a-f0-9]{64}$/) });
export type BoardProfile = z.infer<typeof boardProfileSchema>;
const configSchema = z.object({ id: z.number().int().positive(), name: z.string(), type: z.literal('kanban'), filter: z.object({ id: z.string().regex(/^\d+$/) }), subQuery: z.object({ query: z.string() }), columnConfig: z.object({ columns: z.array(z.object({ statuses: z.array(z.object({ id: z.string() })) })) }) });
const filterSchema = z.object({ id: z.string(), jql: z.string() });
const pageSchema = z.object({ startAt: z.number().int().nonnegative(), total: z.number().int().nonnegative(), issues: z.array(z.object({ id: z.string().regex(/^\d+$/), key: z.string().regex(/^[A-Z][A-Z0-9_]*-\d+$/), fields: z.object({ status: z.object({ id: z.string() }) }) })) });
export const fingerprint = (value: unknown) => createHash('sha256').update(JSON.stringify(value)).digest('hex');
type Get = (path: string, params: Record<string, string>, signal: AbortSignal) => Promise<unknown>;
export async function readBoard(get: Get, profile: BoardProfile, signal: AbortSignal): Promise<BoardSelection> {
  const definition = async () => {
    const raw = await get(`/rest/agile/1.0/board/${profile.id}/configuration`, {}, signal);
    if (fingerprint(raw) !== profile.configurationFingerprint) throw new AppError('BOARD_PROFILE_CHANGED', 'Настройки доски изменились. Проверьте постоянную видимость перед новой загрузкой.');
    const parsed = configSchema.safeParse(raw);
    if (!parsed.success || String(parsed.data.id) !== profile.id) throw new AppError('BOARD_SCHEMA', 'Не подтверждена схема Kanban-доски.');
    const config = parsed.data;
    const filter = filterSchema.safeParse(await get(`/rest/api/2/filter/${config.filter.id}`, {}, signal));
    if (!filter.success || filter.data.id !== config.filter.id || fingerprint(filter.data) !== profile.filterFingerprint) throw new AppError('BOARD_PROFILE_CHANGED', 'Постоянный фильтр доски изменился. Требуется повторная проверка.');
    return config;
  };
  const config = await definition();
  const subquery = config.subQuery.query.trim();
  const tasks = await collectPages(async startAt => {
    const result = pageSchema.safeParse(await get(`/rest/agile/1.0/board/${profile.id}/issue`, { startAt: String(startAt), maxResults: '100', fields: 'status,issuetype,resolution', jql: `${subquery ? `(${subquery}) ` : ''}ORDER BY key ASC` }, signal));
    if (!result.success) throw new AppError('BOARD_SCHEMA', 'Некорректная страница задач доски.');
    return { ...result.data, values: result.data.issues };
  }, { maxItems: 10_000, maxPages: 500 });
  await definition();
  const mapped = new Set(config.columnConfig.columns.flatMap(column => column.statuses.map(status => status.id)));
  return { id: profile.id, name: config.name, fingerprint: fingerprint(profile), complete: true,
    candidates: tasks.filter(task => mapped.has(task.fields.status.id)).map(task => ({ issueId: task.id, requestedKey: task.key, rows: [] })) };
}
