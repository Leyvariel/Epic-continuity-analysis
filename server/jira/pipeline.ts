import { collectHierarchy, issueSignature } from './hierarchy';
import type { AuditEntry, Candidate, HistorySnapshot, ImportJobV3, JiraInputs, SourceDefinition } from '../../shared/contracts';
import type { ParsedKeys } from '../key-candidates';
import type { EpicSummary } from '../../shared/types';
import type { GatewayFactory, JiraGateway, JiraIssue, BoardSelection } from './ports';
import { AppError, safeError } from '../errors';
import { decideEligibility, decisionReason } from '../selection';
import { parseFileCandidates } from '../file-candidates';
import { JIRA_ORIGIN, parseBoardUrl, parseEpicUrl } from './urls';
import { historySchema, jiraInputsSchema } from './cache-schema';
import { mapConcurrent } from './concurrency';

export type JiraRequest = { kind: 'file'; buffer: Buffer; filename: string } | { kind: 'keys'; parsed: ParsedKeys } | { kind: 'board' | 'epic'; url: string } | { kind: 'refresh'; inputs: JiraInputs };
const fatal = (error: unknown) => error instanceof AppError && ['JIRA_UNAUTHORIZED', 'ABORTED', 'PROFILE_UNVERIFIED', 'RATE_LIMITED', 'JIRA_NETWORK', 'JIRA_VERSION_CHANGED', 'IDENTITY_CHANGED'].includes(error.code);
function boardSignature(board: BoardSelection) {
  return JSON.stringify([board.fingerprint, [...new Set(board.candidates.map(c => c.issueId ?? c.requestedKey))].sort()]);
}
async function stableBoard(gateway: JiraGateway, id: string, signal: AbortSignal) {
  for (let attempt = 0; attempt < 2; attempt++) {
    const first = await gateway.readBoard(id, signal), second = await gateway.readBoard(id, signal);
    if (!first.complete || !second.complete) throw new AppError('BOARD_INCOMPLETE', 'Не подтверждена полная выборка доски.');
    if (first.candidates.length > 10_000 || second.candidates.length > 10_000) throw new AppError('SELECTION_TOO_LARGE', 'На доске больше 10 000 кандидатов.');
    if (boardSignature(first) === boardSignature(second)) return second;
  }
  throw new AppError('BOARD_CHANGED', 'Постоянная выборка доски меняется во время чтения. Повторите загрузку.');
}

export async function collectJiraInputs(request: JiraRequest, job: ImportJobV3, factory: GatewayFactory, signal: AbortSignal, now: () => string): Promise<JiraInputs> {
  let source: SourceDefinition | undefined;
  let candidates: Candidate[] = [], invalidRows: number[] = [], totalRows = 0, preservedInvalid: AuditEntry[] = [];
  const warnings: JiraInputs['warnings'] = [];
  const definition = request.kind === 'refresh' ? request.inputs.source : null;
  if (request.kind === 'file') {
    job.phase = 'reading-file';
    const file = parseFileCandidates(request.buffer, request.filename);
    candidates = file.candidates; invalidRows = file.invalidRows; totalRows = file.totalRows;
    warnings.push(...file.warnings);
    source = { kind: 'file', format: file.format, filename: request.filename.split(/[\\/]/).pop() || 'import', sheet: file.sheet, importedAt: job.createdAt, historyMode: 'jira' };
  } else if (request.kind === 'keys') {
    source = { kind: 'keys', importedAt: job.createdAt, historyMode: 'jira' };
    candidates = structuredClone(request.parsed.candidates); preservedInvalid = structuredClone(request.parsed.invalid); totalRows = request.parsed.inputRows;
  } else if (definition?.kind === 'keys' && request.kind === 'refresh') {
    source = definition; candidates = structuredClone(request.inputs.candidates); totalRows = request.inputs.audit.inputRows;
    preservedInvalid = structuredClone(request.inputs.audit.entries.filter(entry => entry.decision === 'invalid'));
  } else if (definition?.kind === 'file' && request.kind === 'refresh') {
    source = definition; candidates = structuredClone(request.inputs.candidates); totalRows = request.inputs.audit.inputRows;
    invalidRows = request.inputs.audit.entries.filter(e => e.decision === 'invalid').flatMap(e => e.rows);
  }
  const audit: JiraInputs['audit'] = { sourceCoverage: 'complete', eligibilityCoverage: 'complete', inputRows: totalRows, duplicates: 0, resolvedIssues: 0,
    entries: [...preservedInvalid, ...invalidRows.map(row => ({ requestedKey: '', rows: [row], decision: 'invalid' as const, reason: decisionReason.invalid }))] };
  job.audit = audit; job.total = candidates.length;
  if (source?.kind === 'keys' && !candidates.length) {
    signal.throwIfAborted();
    audit.eligibilityCoverage = 'partial';
    job.phase = 'selecting';
    job.progress = { found: 0, checked: 0, selected: 0, histories: 0 };
    return jiraInputsSchema.parse({ source, candidates, audit, asOf: job.createdAt, syncStartedAt: job.createdAt, syncFinishedAt: now(),
      epics: [], histories: {}, historyWarnings: {}, warnings });
  }
  job.phase = 'reading-credentials';
  const gateway = await factory(signal);
  try {
    if (request.kind === 'board' || definition?.kind === 'board') {
      job.phase = 'reading-board';
      const parsed = parseBoardUrl(request.kind === 'board' ? request.url : definition?.kind === 'board' ? definition.url : '');
      const board = await stableBoard(gateway, parsed.boardId, signal);
      candidates = board.candidates.map(c => ({ ...c, rows: [] })); totalRows = candidates.length;
      source = { kind: 'board', origin: JIRA_ORIGIN, boardId: parsed.boardId, boardName: board.name, url: parsed.url, visibility: 'persistent-settings', fingerprint: board.fingerprint, historyMode: 'jira' };
      if (parsed.ignoredParameters) warnings.push({ code: 'BOARD_PARAMETERS_IGNORED', message: 'Используются постоянные настройки доски; дополнительные параметры ссылки не применяются.', severity: 'warning' });
    } else if (request.kind === 'epic' || definition?.kind === 'epic') {
      job.phase = 'resolving-epic';
      const parsed = parseEpicUrl(request.kind === 'epic' ? request.url : definition?.kind === 'epic' ? definition.url : '');
      candidates = [{ requestedKey: parsed.requestedKey, rows: [], ...(definition?.kind === 'epic' ? { issueId: definition.issueId } : {}) }]; totalRows = 1;
    }
    audit.inputRows = totalRows;
    job.total = candidates.length; job.phase = 'selecting';
    const progress = job.progress = { found: candidates.length, checked: 0, selected: 0, histories: 0 };
    const epics: EpicSummary[] = [], histories: Record<string, HistorySnapshot> = {}, historyWarnings: JiraInputs['historyWarnings'] = {};
    const groups = new Map<string, { issue: JiraIssue; candidates: Candidate[] }>();
    const resolved = await mapConcurrent(candidates, 4, signal, async (candidate, signal) => {
      signal.throwIfAborted(); job.currentKey = candidate.requestedKey;
      let issue: JiraIssue;
      try { issue = await gateway.getIssue(candidate.issueId ?? candidate.requestedKey, signal); }
      catch (error) {
        if (fatal(error)) throw error;
        signal.throwIfAborted();
        progress.checked++;
        return { candidate, error: safeError(error) };
      }
      if (candidate.issueId && candidate.issueId !== issue.id) throw new AppError('IDENTITY_CHANGED', 'Jira вернула другую задачу для сохранённого id.');
      candidate.issueId = issue.id;
      progress.checked++;
      return { candidate, issue };
    });
    for (const result of resolved) {
      const { candidate, issue } = result;
      if (!issue) { audit.entries.push({ ...candidate, decision: 'unresolved', reason: result.error!.message }); job.completed++; continue; }
      const group = groups.get(issue.id);
      if (group) { group.issue = issue; group.candidates.push(candidate); }
      else groups.set(issue.id, { issue, candidates: [candidate] });
    }
    if ([...groups.values()].filter(g => decideEligibility(g.issue) === 'included').length > 1000) throw new AppError('SELECTION_TOO_LARGE', 'Больше 1000 HF-эпиков: выборка не усечена, загрузка остановлена.');
    if (source?.kind === 'board' && (audit.entries.some(entry => entry.decision === 'unresolved') || [...groups.values()].some(group => decideEligibility(group.issue) === 'unresolved'))) {
      audit.entries.push(...[...groups.values()].flatMap(group => group.candidates.map(candidate => {
        const decision = decideEligibility(group.issue);
        return { ...candidate, key: group.issue.key, decision, reason: decisionReason[decision] };
      })));
      audit.resolvedIssues = groups.size; audit.eligibilityCoverage = 'partial';
      throw new AppError('SELECTION_UNRESOLVED', 'Не удалось определить HF для всей выборки доски. Причины указаны в отборе; истории не загружались.');
    }
    progress.selected = [...groups.values()].filter(g => decideEligibility(g.issue) === 'included').length;
    job.phase = 'reading-history';
    const processed = await mapConcurrent([...groups.values()], 4, signal, async (group, signal) => {
      signal.throwIfAborted();
      let issue = group.issue;
      const candidate = group.candidates[0];
      job.currentKey = issue.key;
      let decision = decideEligibility(issue);
      let history: HistorySnapshot | undefined;
      if (decision === 'included') {
        for (let attempt = 0; attempt < 2; attempt++) {
          history = undefined;
          try { history = historySchema.parse(await gateway.getHistory(issue, signal)); }
          catch (error) { if (fatal(error)) throw error; historyWarnings[issue.key] = [{ ...safeError(error), key: issue.key, severity: 'error' }]; }
          // Re-evaluate eligibility even when history failed: current metadata is the source of truth.
          let after: JiraIssue;
          try { after = await gateway.getIssue(issue.id, signal); }
          catch (error) { if (fatal(error)) throw error; decision = 'unresolved'; history = undefined; break; }
          if (after.id !== issue.id) throw new AppError('IDENTITY_CHANGED', 'Изменилась идентичность задачи при проверке.');
          decision = decideEligibility(after);
          const stable = issueSignature(after) === issueSignature(issue) && (!history || history.updated === issue.updated);
          if (issue.key !== after.key && historyWarnings[issue.key]) {
            historyWarnings[after.key] = historyWarnings[issue.key].map(warning => ({ ...warning, key: after.key }));
            delete historyWarnings[issue.key];
          }
          issue = after;
          if (decision !== 'included') { history = undefined; break; }
          if (stable) break;
          if (attempt === 1 && history) {
            history = { ...history, statusCoverage: 'partial', warnings: [...history.warnings, { code: 'ISSUE_CHANGED', message: 'Задача менялась во время чтения истории.', key: issue.key, severity: 'error' }] };
          }
        }
      }
      if (history) progress.histories++;
      job.completed += group.candidates.length;
      return { group, candidate, issue, decision, history };
    });
    for (const { group, candidate, issue, decision, history } of processed) {
      if (request.kind === 'epic' || definition?.kind === 'epic') source = { kind: 'epic', origin: JIRA_ORIGIN, requestedKey: candidate.requestedKey, key: issue.key, issueId: issue.id, url: `${JIRA_ORIGIN}/browse/${issue.key}`, historyMode: 'jira' };
      audit.entries.push(...group.candidates.map(item => ({ ...item, key: issue.key, decision, reason: decisionReason[decision] })));
      if (decision === 'included') {
        const controls = group.candidates.flatMap(candidate => candidate.control ? [candidate.control] : []);
        const control = controls[0];
        if (controls.some(other => JSON.stringify(other) !== JSON.stringify(control))) warnings.push({ code: 'CONTROL_ALIAS_CONFLICT', key: issue.key, message: 'Контрольные поля нескольких ключей одной задачи различаются; показаны значения первого кандидата.', severity: 'warning' });
        if (control && Object.entries(control.metadata).some(([field, value]) => field !== 'epicKind' && value !== ({ type: issue.flow, title: issue.title, resolution: issue.resolution, currentStatus: issue.currentStatus } as Record<string, string>)[field])) warnings.push({ code: 'FILE_JIRA_DIFFERENCE', key: issue.key, message: 'Контрольные поля файла отличаются от текущей Jira; отбор и история определены по Jira.', severity: 'warning' });
        epics.push({ key: issue.key, title: issue.title, type: 'HF', resolution: issue.resolution, ...(candidate.rows.length ? { sourceRow: candidate.rows[0] } : {}), excelAggregates: control?.aggregates ?? {}, ...(control ? { excelColumns: control.columns, sourceMetadata: control.metadata } : {}) });
        if (history) histories[`jira:${issue.id}`] = { ...history, key: issue.key, title: issue.title, resolution: issue.resolution, assignee: issue.assignee, issueType: issue.issueType };
      }
    }
    progress.selected = epics.length;
    audit.resolvedIssues = new Set(audit.entries.flatMap(e => e.issueId ? [e.issueId] : [])).size;
    audit.duplicates = Math.max(0, candidates.reduce((n, c) => n + Math.max(1, c.rows.length), 0) - new Set(candidates.map(c => c.issueId ?? c.requestedKey)).size);
    audit.eligibilityCoverage = audit.entries.some(e => e.decision === 'unresolved' || (source?.kind === 'keys' && e.decision === 'invalid')) ? 'partial' : 'complete';
    if (!source || (source.kind !== 'file' && source.kind !== 'keys' && audit.eligibilityCoverage !== 'complete') || (source.kind !== 'keys' && candidates.length && !audit.entries.some(e => e.decision !== 'unresolved' && e.decision !== 'invalid'))) throw new AppError('SELECTION_UNRESOLVED', 'Не удалось подтвердить требуемую выборку в Jira.');
    if (epics.length > 1000) throw new AppError('SELECTION_TOO_LARGE', 'Больше 1000 HF-эпиков: выборка не усечена, загрузка остановлена.');
    if (epics.length && !Object.values(histories).some(h => h.statusCoverage !== 'unavailable')) throw new AppError('HISTORY_UNAVAILABLE', 'История всех выбранных HF-эпиков недоступна. Предыдущий набор сохранён.');
    job.phase = 'reading-hierarchy';
    const hierarchy = await collectHierarchy(gateway, processed.filter(p => p.decision === 'included').map(p => ({ issue: p.issue, history: p.history, historyAttempted: true })), job.createdAt, signal);
    let sprintInputs: JiraInputs['sprintInputs'];
    if (gateway.readSprintInputs) { job.phase = 'reading-sprints'; sprintInputs = await gateway.readSprintInputs(hierarchy, job.createdAt, signal); }
    return jiraInputsSchema.parse({ hierarchy, ...(sprintInputs ? { sprintInputs } : {}), source, candidates, audit, asOf: job.createdAt, syncStartedAt: job.createdAt, syncFinishedAt: now(), epics, histories, historyWarnings, warnings });
  } finally { gateway.close?.(); }
}
