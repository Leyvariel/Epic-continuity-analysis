import { randomUUID } from 'node:crypto';
import type { ImportedSelection } from '../shared/types';
import { CacheStore, type CacheState } from './cache';
import { AppError, safeError } from './errors';
import { parseWorkbook } from './import';
import type { AnyDataset, ImportJobV3, JiraCacheState, LegacyCacheStateV3 } from '../shared/contracts';
import type { GatewayFactory } from './jira/ports';
import { collectJiraInputs, type JiraRequest } from './jira/pipeline';
import { buildJiraDataset } from './jira/dataset';
import { parseBoardUrl, parseEpicUrl } from './jira/urls';
import { parseKeyCandidates } from './key-candidates';
import { migrateLegacy } from './cache-migrations';
export { buildDataset } from './dataset';

export class DatasetService {
  private state: LegacyCacheStateV3 | JiraCacheState | null = null;
  private cacheError: AppError | null = null;
  private jobs = new Map<string, ImportJobV3>();
  private busy = false;
  private controller: AbortController | null = null;
  private activeTask: Promise<void> = Promise.resolve();
  waitForIdle(): Promise<void> { return this.activeTask; }
  constructor(private readonly cache: CacheStore, private readonly now = () => new Date().toISOString(),
    private readonly gatewayFactory: GatewayFactory = async () => { throw new AppError('PROFILE_UNVERIFIED', 'Адаптер Jira ещё не настроен: сначала нужна разрешённая проверка совместимости API (G0).', 503); }) {}
  async initialize(): Promise<void> {
    try {
      const cached = await this.cache.read();
      if (cached) this.state = cached.calculationProfile === 'jira-v3'
        ? { schemaVersion: 3, calculationProfile: 'jira-v3', inputs: cached.inputs, dataset: buildJiraDataset(cached.inputs, cached.dataset.savedAt, cached.dataset.id) }
        : migrateLegacy(cached.selection, cached.dataset.savedAt, cached.dataset.id);
    } catch (error) { this.cacheError = error instanceof AppError ? error : new AppError('CACHE_INVALID', 'Ошибка чтения кэша.', 500); }
  }
  getDataset(): AnyDataset | null {
    if (this.cacheError && !this.state) throw this.cacheError;
    return this.state?.dataset ?? null;
  }
  getJob(id: string): ImportJobV3 {
    const job = this.jobs.get(id);
    if (!job) throw new AppError('JOB_NOT_FOUND', 'Задание не найдено. После перезапуска откройте последний набор.', 404);
    return job;
  }
  import(buffer: Buffer, filename: string): ImportJobV3 {
    if (this.busy) throw new AppError('BUSY', 'Дождитесь завершения текущего импорта.', 409);
    const selection = parseWorkbook(buffer, filename, this.now());
    this.busy = true;
    const job: ImportJobV3 = { id: randomUUID(), status: 'queued', total: selection.epics.length, completed: 0, currentKey: null, errors: [], dataset: null, createdAt: this.now() };
    this.jobs.set(job.id, job);
    while (this.jobs.size > 20) this.jobs.delete(this.jobs.keys().next().value!);
    this.activeTask = this.run(job, selection).catch(error => {
      job.status = 'failed'; job.currentKey = null; job.errors.push({ ...safeError(error), severity: 'error' });
    }).finally(() => { this.busy = false; });
    return job;
  }
  importJiraFile(buffer: Buffer, filename: string): ImportJobV3 {
    if (!/\.(csv|xlsx)$/i.test(filename)) throw new AppError('INVALID_UPLOAD', 'Нужен файл CSV или XLSX.');
    if (buffer.length > 20 * 1024 * 1024) throw new AppError('FILE_TOO_LARGE', 'Файл превышает 20 МБ.', 413);
    return this.startJira({ kind: 'file', buffer, filename });
  }
  importKeys(text: string): ImportJobV3 {
    if (this.busy) throw new AppError('BUSY', 'Дождитесь завершения текущего задания.', 409);
    return this.startJira({ kind: 'keys', parsed: parseKeyCandidates(text) });
  }
  importBoard(url: string): ImportJobV3 { parseBoardUrl(url); return this.startJira({ kind: 'board', url }); }
  importEpic(url: string): ImportJobV3 { parseEpicUrl(url); return this.startJira({ kind: 'epic', url }); }
  refresh(datasetId: string): ImportJobV3 {
    if (!this.state || this.state.dataset.id !== datasetId) throw new AppError('STALE_DATASET', 'Набор изменился. Откройте последний набор.', 409);
    if (this.state.calculationProfile !== 'jira-v3') throw new AppError('OFFLINE_SOURCE', 'Это прежний автономный набор. Загрузите файл в режиме Jira.', 409);
    return this.startJira({ kind: 'refresh', inputs: this.state.inputs });
  }
  shutdown() { this.controller?.abort(); }
  private startJira(request: JiraRequest): ImportJobV3 {
    if (this.busy) throw new AppError('BUSY', 'Дождитесь завершения текущего задания.', 409);
    this.busy = true;
    const controller = new AbortController(); this.controller = controller;
    const job: ImportJobV3 = { id: randomUUID(), status: 'queued', total: null, completed: 0, currentKey: null, errors: [], dataset: null, createdAt: this.now() };
    this.jobs.set(job.id, job);
    while (this.jobs.size > 20) this.jobs.delete(this.jobs.keys().next().value!);
    // Start after returning the accepted job, including parser failures before credentials.
    this.activeTask = Promise.resolve().then(async () => {
      job.status = 'running';
      const inputs = await collectJiraInputs(request, job, this.gatewayFactory, controller.signal, this.now);
      controller.signal.throwIfAborted(); job.phase = 'calculating';
      const dataset = buildJiraDataset(inputs, this.now());
      const next: JiraCacheState = { schemaVersion: 3, calculationProfile: 'jira-v3', inputs, dataset };
      controller.signal.throwIfAborted(); job.phase = 'committing';
      await this.cache.write(next);
      this.state = next; this.cacheError = null; job.dataset = dataset;
      job.errors = dataset.epics.flatMap(e => e.warnings.filter(w => w.severity === 'error'));
      job.status = 'completed';
    }).catch(error => { controller.abort(); job.status = 'failed'; job.errors.push({ ...safeError(error), severity: 'error' }); })
      .finally(() => { job.currentKey = null; this.busy = false; this.controller = null; });
    return job;
  }
  private async run(job: ImportJobV3, selection: ImportedSelection): Promise<void> {
    job.status = 'running';
    const next = migrateLegacy(selection, this.now());
    const dataset = next.dataset;
    job.completed = dataset.epics.length;
    job.errors = dataset.epics.flatMap(epic => epic.warnings.filter(w => w.severity === 'error'));
    await this.cache.write(next);
    this.state = next; this.cacheError = null;
    job.dataset = dataset; job.status = 'completed';
  }
}
