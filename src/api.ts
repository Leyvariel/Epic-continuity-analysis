import type { AnyDataset as Dataset, ImportJobV3 as ImportJob } from '../shared/contracts';

export class LocalApiError extends Error {
  constructor(message: string, readonly status: number, readonly code?: string) { super(message); }
}

export async function request<T>(path: string, init?: RequestInit): Promise<T> {
  let response: Response;
  try { response = await fetch(path, init); }
  catch { throw new Error('Локальный сервер недоступен. Проверьте, что приложение запущено.'); }
  const body = await response.json().catch(() => null);
  if (!response.ok) throw new LocalApiError(body?.error?.message ?? `Ошибка локального сервера (${response.status}).`, response.status, body?.error?.code);
  if (body === null) throw new Error('Локальный сервер вернул некорректный ответ.');
  return body as T;
}

export type ImportStatus = { kind: 'job'; job: ImportJob } | { kind: 'restored'; dataset: Dataset | null };
export async function readImportStatus(id: string, signal?: AbortSignal): Promise<ImportStatus> {
  try { return { kind: 'job', job: await request<ImportJob>(`/api/jobs/${encodeURIComponent(id)}`, signal ? { signal } : undefined) }; }
  catch (error) {
    if (!(error instanceof LocalApiError) || error.status !== 404 || error.code !== 'JOB_NOT_FOUND') throw error;
    // In-memory jobs disappear on restart; the atomically saved dataset survives.
    const { dataset } = await request<{ dataset: Dataset | null }>('/api/dataset', signal ? { signal } : undefined);
    return { kind: 'restored', dataset };
  }
}
