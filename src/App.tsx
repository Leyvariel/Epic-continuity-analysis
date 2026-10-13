import {SprintRows,sprintBounds} from './SprintRows';
import type {SprintAnalysis,SprintRow} from '../shared/sprints';
import type { Hierarchy } from '../shared/hierarchy';
import { childrenOf, eligibleHierarchyIds, hierarchyIndex } from '../shared/hierarchy-view';
import { HierarchyRows, branchKey } from './HierarchyRows';
import { relatedLabels } from './RelatedStatusBar';
import { Fragment, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { CSSProperties } from 'react';
import { calendarRange, dateTime, position, preciseDuration } from '../shared/calendar';
import type { CalendarRange } from '../shared/calendar';
import { DAY_MS, STAGES, statusInfo } from '../shared/statuses';
import { HEAT_BANDS, HEAT_COLORS, heatFor } from '../shared/heatmap';
import type { EpicTimeline } from '../shared/types';
import { defaultMetricsSource, epicStateLabel, isJiraDataset, keyErrorEntries, type AnyDataset as Dataset, type AuditEntry, type ImportJobV3 as ImportJob } from '../shared/contracts';
import { displayIntervals } from '../shared/display';
import { SourceForm, type SourceInput } from './SourceForm';
import { DatasetSummary, SelectionDetails } from './DatasetSummary';

import { BASE_METRICS, metricsFor, metricValue } from '../shared/metrics';
import type { Metric, MetricColumn, MetricsSource } from '../shared/metrics';
import { segmentLabels } from '../shared/layout';
import { compositionFor, compositionScale } from '../shared/composition';
import { CompositionBar, CompositionHeader, COMPOSITION_WIDTH } from './CompositionChart';
import { LocalApiError, readImportStatus, request } from './api';
import { PREVIEW_MESSAGE, WORKING_APP_URL, type ApplicationMode } from '../shared/runtime';
type Sort = Metric | 'key' | 'title';
type Zoom = 'day' | 'week' | 'month';
const ZOOM: Record<Zoom, { label: string; pixels: number }> = { day: { label: 'День', pixels: 26 }, week: { label: 'Неделя', pixels: 8 }, month: { label: 'Месяц', pixels: 3 } };
const QUALITY = { complete: 'Без разрывов', partial: 'Неполные данные' };
const COVERAGE = { complete: 'Полная', partial: 'Неполная', unavailable: 'Недоступна' };
const METRICS = BASE_METRICS;
const days = (value: number | null) => value === null ? '—' : new Intl.NumberFormat('ru-RU', { minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(value / DAY_MS);

export function App() {
  const [dataset, setDataset] = useState<Dataset | null>(null);
  const [loading, setLoading] = useState(true);
  const [mode, setMode] = useState<ApplicationMode>('application');
  const [error, setError] = useState('');
  const [statusMessage, setStatusMessage] = useState('');
  const [job, setJob] = useState<ImportJob | null>(null);
  const [starting, setStarting] = useState(false);
  const [sourceChoice, setSourceChoice] = useState<MetricsSource | null>(null);
  const metricsSource: MetricsSource = sourceChoice ?? defaultMetricsSource(dataset);
  const metrics = useMemo(() => metricsFor(dataset?.epics ?? [], metricsSource), [dataset, metricsSource]);
  const [query, setQuery] = useState('');
  const [assignee, setAssignee] = useState('');
  const [sort, setSort] = useState<{ field: Sort; descending: boolean }>({ field: 'ttm', descending: true });
  const [zoom, setZoom] = useState<Zoom>('week');
  const [selectedKey, setSelectedKey] = useState<string | null>(null);
  const [showRules, setShowRules] = useState(false);
  const closeEpic = useCallback(() => setSelectedKey(null), []);
  const closeRules = useCallback(() => setShowRules(false), []);
  const active = starting || job?.status === 'queued' || job?.status === 'running';

  useEffect(() => {
    let live = true;
    const controller = new AbortController();
    request<{ dataset: Dataset | null; mode?: ApplicationMode }>('/api/dataset', { signal: controller.signal }).then(body => { if (live) { setDataset(body.dataset); setMode(body.mode ?? 'application'); } })
      .catch(e => { if (live) setError(e.message); }).finally(() => { if (live) setLoading(false); });
    return () => { live = false; controller.abort(); };
  }, []);
  useEffect(() => {
    if (!job || !['queued', 'running'].includes(job.status)) return;
    let stopped = false;
    const controller = new AbortController();
    let timer: ReturnType<typeof setTimeout>;
    const poll = async () => {
      try {
        const result = await readImportStatus(job.id, controller.signal);
        if (stopped) return;
        if (result.kind === 'restored') {
          setDataset(result.dataset); setJob(null); setSelectedKey(null); setSourceChoice(null); setAssignee(''); setQuery(''); setSort({ field: 'ttm', descending: true }); setError('');
          setStatusMessage('Состояние импорта потеряно после перезапуска сервера. Открыт последний сохранённый набор; при необходимости загрузите файл повторно.');
          return;
        }
        const next = result.job;
        setJob(next);
        setError('');
        if (next.status === 'completed') { setDataset(next.dataset); setSelectedKey(null); setSourceChoice(null); setAssignee(''); setQuery(''); setSort({ field: 'ttm', descending: true }); }
        if (next.status === 'failed') setError(next.errors.map(e => e.message).join(' '));
      } catch (e) {
        if (!stopped) {
          setError((e as Error).message);
          if (e instanceof LocalApiError) setJob(null);
          else timer = setTimeout(poll, 3000);
        }
      }
    };
    timer = setTimeout(poll, 700);
    return () => { stopped = true; clearTimeout(timer); controller.abort(); };
  }, [job]);

  const startJob = async (source: SourceInput) => {
    setStarting(true); setError(''); setStatusMessage('');
    try {
      const result = source.kind === 'file' ? await request<{ id: string }>('/api/import', {
        method: 'POST', headers: { 'X-Local-Request': '1', 'Content-Type': 'application/octet-stream', 'X-File-Name': encodeURIComponent(source.file.name), 'X-History-Source': source.historyMode ?? 'jira' }, body: source.file,
      }) : await request<{ id: string }>(source.kind === 'refresh' ? '/api/refresh' : `/api/${source.kind}/import`, {
        method: 'POST', headers: { 'X-Local-Request': '1', 'Content-Type': 'application/json' }, body: JSON.stringify(source.kind === 'refresh' ? { datasetId: source.datasetId } : source.kind === 'keys' ? { text: source.text } : { url: source.url }),
      });
      // Polling can recover even if the first status request is interrupted.
      setJob({ id: result.id, status: 'queued', total: null, completed: 0, currentKey: null, errors: [], dataset: null, createdAt: new Date().toISOString() });
    } catch (e) { setError((e as Error).message); }
    finally { setStarting(false); }
  };
  const filtered = useMemo(() => {
    const term = query.trim().toLocaleLowerCase('ru');
    return [...(dataset?.epics ?? [])].filter(epic => `${epic.summary.key} ${epic.metadata?.title ?? epic.summary.title}`.toLocaleLowerCase('ru').includes(term) && (!assignee || epicAssignee(epic) === assignee)).sort((a, b) => {
      let difference: number;
      if (sort.field === 'key' || sort.field === 'title') {
        const field = sort.field;
        difference = a.summary[field].localeCompare(b.summary[field], 'ru', { numeric: true });
      } else {
        const av = metricValue(a, sort.field, metricsSource), bv = metricValue(b, sort.field, metricsSource);
        if (av === null || bv === null) return av === bv ? a.summary.key.localeCompare(b.summary.key) : av === null ? 1 : -1;
        difference = av - bv;
      }
      return (sort.descending ? -difference : difference) || a.summary.key.localeCompare(b.summary.key);
    });
  }, [dataset, query, sort, metricsSource, assignee]);
  const keyErrors = useMemo(() => {
    if (!isJiraDataset(dataset) || dataset.source.kind !== 'keys') return [];
    return keyErrorEntries(dataset.audit);
  }, [dataset]);
  const visibleErrors = keyErrors.filter(({ entry }) => !assignee && (!query.trim() || `${entry.requestedKey} ${entry.key ?? ''} ${entry.reason}`.toLocaleLowerCase('ru').includes(query.trim().toLocaleLowerCase('ru'))));
  const localOnly = isJiraDataset(dataset) && dataset.source.kind === 'keys' && keyErrors.length > 0 && dataset.audit.entries.every(entry => entry.decision === 'invalid');
  const sprintAnalysis = isJiraDataset(dataset) ? dataset.sprintAnalysis : undefined;
  // Keep the calendar range stable while searching and sorting.
  const range = useMemo(() => dataset ? calendarRange(dataset.epics, dataset.asOf ?? dataset.savedAt, [...(dataset.hierarchy ? [...eligibleHierarchyIds(dataset.hierarchy)].map(id => dataset.hierarchy!.nodes[id].timeline).filter(t => t.state === 'complete') : []), ...sprintBounds(sprintAnalysis)]) : null, [dataset, sprintAnalysis]);
  const aggregateScale = useMemo(() => {
    const epics = dataset?.epics ?? [], columns = metricsFor(epics, 'excel');
    return compositionScale(epics.map(epic => compositionFor(epic, columns)));
  }, [dataset]);
  const assignees = useMemo(() => [...new Set((dataset?.epics ?? []).map(epicAssignee))].sort((a, b) => a.localeCompare(b, 'ru')), [dataset]);
  const selected = dataset?.epics.find(e => e.summary.key === selectedKey);
  const sortBy = (field: Sort) => setSort(previous => ({ field, descending: previous.field === field ? !previous.descending : field !== 'key' && field !== 'title' }));
  const completeCount = dataset?.epics.filter(e => e.quality === 'complete').length ?? 0;
  const hasHistory = sprintBounds(sprintAnalysis).length > 0 || (dataset?.epics.some(epic => epic.metadata !== null) ?? false) || !!dataset?.hierarchy && Object.values(dataset.hierarchy.nodes).some(n => n.timeline.state === 'complete');
  const ttmValues = filtered.map(epic => metricValue(epic, 'ttm', metricsSource)).filter((value): value is number => value !== null).sort((a, b) => a - b);
  const middle = Math.floor(ttmValues.length / 2);
  const median = ttmValues.length ? ttmValues.length % 2 ? ttmValues[middle] : (ttmValues[middle - 1] + ttmValues[middle]) / 2 : null;
  const changeSource = (source: MetricsSource) => {
    setSourceChoice(source);
    if (!['key', 'title'].includes(sort.field) && !metricsFor(dataset?.epics ?? [], source).some(metric => metric.id === sort.field)) setSort({ field: 'ttm', descending: true });
  };

  return <div className="app">
    <header className="app-header">
      <div><div className="eyebrow">ПРОДУКТОВЫЕ ПРОЦЕССЫ <span>Локально</span></div><h1>Анализ HF-эпиков</h1><p>История этапов и Time to Market по данным Jira</p></div>
      <div className="actions"><button onClick={() => setShowRules(true)}>Правила расчёта</button>
        {mode === 'application' && isJiraDataset(dataset) && <button className="primary" disabled={active} onClick={() => void startJob({ kind: 'refresh', datasetId: dataset.id })}>Обновить</button>}
      </div>
    </header>
    {!loading && (mode === 'application' ? <SourceForm busy={active} onSubmit={startJob} /> : <div className="notice preview-notice" role="status"><strong>{mode === 'demo' ? 'Демонстрационные данные.' : 'Сохранённый снимок.'}</strong> {PREVIEW_MESSAGE} <a href={WORKING_APP_URL}>Открыть основное приложение</a></div>)}
    {error && <div className="notice error" role="alert">{error}</div>}
    {statusMessage && <div className="notice" role="status">{statusMessage}</div>}
    {job?.status === 'failed' && dataset && <div className="notice">Новая загрузка не завершена. Показан предыдущий сохранённый набор.</div>}
    {job?.status === 'failed' && job.audit && <SelectionDetails audit={job.audit} />}
    {active && <div className="progress" role="status"><div><strong>{phaseLabel(job?.phase)}</strong><span>{job?.currentKey ?? 'Подготовка'} · {job?.completed ?? 0} из {job?.total ?? '…'}</span></div><progress value={job?.total == null ? undefined : job.phase === 'selecting' ? job.progress?.checked ?? job.completed : job.completed} max={job?.total || 1} />{job?.progress && <small>Найдено: {job.progress.found} · признаки проверены: {job.progress.checked} · отобрано HF: {job.progress.selected} · историй получено: {job.progress.histories}</small>}{dataset && <small>До завершения загрузки показан предыдущий набор.</small>}</div>}
    {loading ? <div className="empty">Загрузка последнего локального набора…</div> : !dataset ? <main className="empty">{mode !== 'application' ? <h2>Нет сохранённых данных для просмотра</h2> : <><div className="empty-symbol">↗</div><h2>Выберите эпики для анализа</h2><p>Вставьте список ключей, загрузите CSV/XLSX или вставьте ссылку на доску либо отдельный эпик.</p><p className="hint">История берётся из Jira. Последний результат сохраняется на этом компьютере.</p></>}</main> : <main>
      <section className="dataset-meta" aria-label="Состояние набора">
        <div><strong>{filtered.length}<small> / {dataset.epics.length}</small></strong><span>HF-эпиков в выборке</span></div>
        <div><strong>{days(median)}<small> дн.</small></strong><span>{localOnly ? 'медиана TTM · нет данных' : `медиана TTM · ${metricsSource === 'excel' ? 'Excel' : 'история'} · ${ttmValues.length} значений`}</span></div>
        <div><strong>{days(ttmValues.at(-1) ?? null)}<small> дн.</small></strong><span>максимальный TTM выборки</span></div>
        <div className="snapshot"><strong>{dateTime(localOnly ? dataset.savedAt : hasHistory || isJiraDataset(dataset) ? dataset.asOf : dataset.source.importedAt)} МСК</strong><span>{localOnly ? `время проверки ввода · ошибок ${keyErrors.length}` : `${hasHistory || isJiraDataset(dataset) ? 'момент среза истории' : 'время импорта · момент среза не указан'} · полная история: ${completeCount} / ${dataset.epics.length}`}</span></div>
      </section>
      <DatasetSummary dataset={dataset} />
      {isJiraDataset(dataset) && !localOnly && <div className="sprint-notice">{sprintAnalysis ? <>Анализ по текущему составу подзадач. Удалённые и ушедшие подзадачи не восстанавливаются; обнаруженный перенос отмечается как неизвестность. Спринты показаны целиком: ✓ работа, ○ нет работы в закрытом спринте, ◌ активный без работы, ? недостаточно данных. Тёмная отметка вплотную под полосой статусов эпика — доказанное отсутствие включённых в спринт дочерних задач. Пустой спринт сам по себе не означает брешь: включённая задача без работы или задача в пересекающемся спринте исключает её. Недостаточность данных отметкой бреши не обозначается. Бреши показаны только на этапах «Проверка идей», «Валидация», «Реализация» и «Оценка результата».{sprintAnalysis.diagnostics&&<p>Основной граф: {sprintAnalysis.diagnostics.primaryNodes} узлов · добавлено подзадач: {sprintAnalysis.diagnostics.addedSubtasks} · непрочитано: {sprintAnalysis.diagnostics.unreadSubtasks}</p>}{sprintAnalysis.warnings.map((w,i)=><p key={i}>{w}</p>)}</> : 'Спринты не загружены. Обновите набор для анализа спринтов.'}</div>}
      {dataset.quality !== 'complete' && !localOnly && <div className="notice">Данные частичные: проверьте результаты отбора и замечания к эпикам. Неизвестные интервалы не достраиваются.{dataset.epics.some(e => Object.keys(e.summary.excelAggregates).length) && ' Агрегаты из файла доступны отдельно и не определяют последовательность этапов.'}</div>}
      {metrics.some(metric => metric.id.startsWith('extra:')) && <div className="notice">Колонки со знаком «?» сохранены из файла. Для этих названий нет согласованных порогов heatmap; цветовая оценка не применяется.</div>}
      {dataset.warnings.length > 0 && <details className="warnings"><summary>Замечания импорта и отбора ({dataset.warnings.length})</summary><ul>{dataset.warnings.map((w, i) => <li key={i}>{w.key && `${w.key}: `}{w.row && `Строка ${w.row}: `}{w.message}</li>)}</ul></details>}
      {!localOnly && !dataset.hierarchy && <div className="notice">Данные о связях не загружены. {isJiraDataset(dataset) ? 'Обновите набор для раскрытия связанных элементов.' : 'Повторно импортируйте XLSX с листами связей и метаданных.'}</div>}
      {dataset.hierarchy?.warnings.map((w,i)=><div className="notice" key={`hierarchy-${i}`}>⚠ {w.message}</div>)}
      {dataset.hierarchy && <p className="hierarchy-help">Стрелки раскрывают связанные эпики и задачи. Поиск, исполнитель и сортировка применяются к исходным эпикам; их дети показаны вместе с родителем.</p>}
      <div className="toolbar"><label className="search"><span>⌕</span><input aria-label="Поиск по ключу или названию" placeholder="Найти эпик по ключу или названию" value={query} onChange={e => setQuery(e.target.value)} /></label>
        {!localOnly && <label className="sort">Режим <select aria-label="Источник длительностей" value={metricsSource} onChange={e => changeSource(e.target.value as MetricsSource)}>{dataset.epics.some(e => Object.keys(e.summary.excelAggregates).length) && <option value="excel">Состав из Excel</option>}<option value="history">Календарь по истории</option></select></label>}
        <label className="sort">Исполнитель <select aria-label="Фильтр по исполнителю" value={assignee} onChange={e => setAssignee(e.target.value)}><option value="">Все</option>{assignees.map(name => <option key={name} value={name}>{name}</option>)}</select></label>
        <label className="sort">Сортировка <select aria-label="Сортировка" value={sort.field} onChange={e => sortBy(e.target.value as Sort)}><option value="key">Ключ</option><option value="title">Название</option>{metrics.map(m => <option key={m.id} value={m.id}>{m.name}</option>)}</select><button aria-label="Изменить направление сортировки" onClick={() => setSort(s => ({ ...s, descending: !s.descending }))}>{sort.descending ? '↓' : '↑'}</button></label>
        {!localOnly && metricsSource === 'history' && <div className="zoom" aria-label="Масштаб календаря">{(Object.keys(ZOOM) as Zoom[]).map(z => <button key={z} aria-pressed={z === zoom} onClick={() => setZoom(z)}>{ZOOM[z].label}</button>)}</div>}
        {(query || assignee) && <button onClick={() => { setQuery(''); setAssignee(''); }}>Сбросить фильтры</button>}
      </div>
      {!localOnly && <div className="legends"><span className="legend-caption">Этапы:</span>{(metricsSource === 'excel' ? metrics.filter(metric => !['ttm', 'open'].includes(metric.id)) : STAGES).map(metric => <span key={metric.id}><i className={metric.id.startsWith('extra:') ? 'hatch' : ''} style={{ backgroundColor: STAGES.find(stage => stage.id === metric.id)?.color ?? '#d1d5db' }} />{metric.code} {metric.name}</span>)}{metricsSource === 'history' ? <><span><i className="initial-swatch" />До начала TTM</span><span><i className="return-swatch" />↩О Возврат в открыто</span><span><i className="hatch" />Неизвестный / промежуточное закрытие</span><span>⚑ Impediment</span>{sprintAnalysis && <span><i className="gap-swatch" />Брешь: нет включённых задач · под статусом</span>}</> : <span><i className="ttm-swatch" />TTM из Excel</span>}</div>}
      <div className="table-note"><span>{localOnly ? 'Ошибочные строки показаны без метрик и календарной истории.' : metricsSource === 'excel' ? 'Слева: предоставленные агрегаты Excel, дни. TTM сохранён как в файле; возврат в открыто неизвестен.' : 'Слева: длительности по истории, дни. Цвет ячейки оценивает длительность, цвет полосы обозначает статус.'}</span><span>{filtered.length + visibleErrors.length} из {dataset.epics.length + keyErrors.length} строк · Europe/Moscow</span></div>
      {metricsSource === 'excel' && <div className="composition-note">Справа — сумма длительностей этапов на общей шкале дней. Порядок блоков соответствует колонкам Excel и не показывает последовательность переходов. Пунктир — исходный TTM, который может отличаться от суммы.</div>}
      {range && <TimelineTable sprintAnalysis={sprintAnalysis} key={dataset.id} hierarchy={dataset.hierarchy} epics={filtered} errors={visibleErrors} localOnly={localOnly} range={range} zoom={zoom} onSelect={setSelectedKey} sort={sort} sortBy={sortBy} selectedKey={selectedKey} metricsSource={metricsSource} metrics={metrics} aggregateScale={aggregateScale} />}
      {!localOnly && <footer>{metricsSource === 'history' ? 'TTM по истории: первый активный HF-статус → окончательное закрытие или момент среза. Impediment не вычитается.' : 'Из Excel: исходные значения могут использовать другое определение TTM и вычитание impediment.'}</footer>}
    </main>}
    {selected && <EpicPanel epic={selected} columns={metricsFor(dataset?.epics ?? [], 'excel')} onClose={closeEpic} />}
    {showRules && <RulesPanel onClose={closeRules} />}
  </div>;
}

const epicAssignee = (epic: EpicTimeline) => epic.metadata?.assignee || epic.summary.sourceMetadata?.assignee || 'Не указан';
const phaseLabel = (phase: ImportJob['phase']) => phase ? ({ 'reading-file': 'Чтение файла', 'reading-credentials': 'Подключение к Jira', 'reading-board': 'Получение состава доски', 'resolving-epic': 'Получение эпика', selecting: 'Проверка HF и резолюции', 'reading-history': 'Чтение истории', 'reading-hierarchy': 'Чтение связанных элементов', 'reading-sprints': 'Чтение спринтов и подзадач', calculating: 'Расчёт', committing: 'Сохранение' })[phase] : 'Подготовка загрузки';

function TimelineTable({ sprintAnalysis, hierarchy, epics, errors, localOnly, range, zoom, onSelect, sort, sortBy, selectedKey, metricsSource, metrics, aggregateScale }: {
  sprintAnalysis?: SprintAnalysis; hierarchy?: Hierarchy; epics: EpicTimeline[]; errors: { id: string; entry: AuditEntry }[]; localOnly: boolean; range: CalendarRange; zoom: Zoom; onSelect: (key: string) => void;
  sort: { field: Sort; descending: boolean }; sortBy: (field: Sort) => void; selectedKey: string | null; metricsSource: MetricsSource; metrics: MetricColumn[];
  aggregateScale: ReturnType<typeof compositionScale>;
}) {
  const hierarchyAdjacency = useMemo(() => hierarchy ? hierarchyIndex(hierarchy) : undefined, [hierarchy]);
  const [open, setOpen] = useState<Set<string>>(() => new Set());
  const toggle = (path: string[]) => setOpen(previous => {
    const next = new Set(previous), key = branchKey(path);
    if(next.has(key)){const prefix=key.slice(0,-1)+',';for(const stored of next)if(stored===key || stored.startsWith(prefix))next.delete(stored);}else next.add(key);
    return next;
  });
  const pixels = ZOOM[zoom].pixels;
  const hasHistory = sprintBounds(sprintAnalysis).length > 0 || epics.some(epic => displayIntervals(epic).length > 0) || !!hierarchy && Object.values(hierarchy.nodes).some(n => n.timeline.state === 'complete');
  const relatedWidth = hierarchy ? [...eligibleHierarchyIds(hierarchy)].reduce((max,id) => relatedLabels(hierarchy.nodes[id],range,pixels).reduce((m,l)=>Math.max(m,l.labelLeft+l.labelWidth),max),0) : 0;
  const width = metricsSource === 'excel' ? COMPOSITION_WIDTH : Math.max(500, relatedWidth + 20, position(range.end, range.start, pixels) + 90,
    ...epics.flatMap(epic => segmentLabels(displayIntervals(epic), range.start, pixels).filter(label => label.narrow).map(label => label.labelLeft + label.labelWidth)));
  const pos = (ms: number) => position(ms, range.start, pixels);
  const grid = { '--calendar-width': `${width}px`, '--day-width': `${pixels}px`, '--metric-count': metrics.length } as CSSProperties;
  return <div className="timeline-scroll" tabIndex={0} aria-label={`Таблица длительностей и ${metricsSource === 'excel' ? 'состав этапов' : 'календарь'}, прокручиваются по горизонтали и вертикали`} style={grid}>
    <div className="timeline-table">
      <div className="timeline-header">
        <div className="left-area metric-grid">
          <button className="key-heading" onClick={() => sortBy('key')}>Эпик {sort.field === 'key' && (sort.descending ? '↓' : '↑')}<small>Название / состояние данных</small></button>
          {metrics.map(m => <button key={m.id} title={m.name} aria-label={`Сортировать: ${m.name}`} onClick={() => sortBy(m.id)} className={sort.field === m.id ? 'sorted' : ''}><b>{m.code}</b><small>{m.id === 'ttm' ? 'дни' : m.id === 'open' ? 'Возврат' : m.name}</small>{sort.field === m.id && <span>{sort.descending ? '↓' : '↑'}</span>}</button>)}
        </div>
        {metricsSource === 'excel' ? <CompositionHeader scale={aggregateScale} /> : <div className="calendar-header" style={{ width }}>
          {hasHistory ? [range.quarters, range.months, range.days].map((cells, row) => <div className={`calendar-tier tier-${row}`} key={row}>{cells.map(cell => <div key={cell.start} className={cell.weekend ? 'weekend' : ''} style={{ left: pos(cell.start), width: pos(cell.end) - pos(cell.start) }} title={dateTime(new Date(cell.start).toISOString())}>{row < 2 || zoom === 'day' || (zoom === 'week' && Number(cell.label) % 7 === 1) ? cell.label : ''}</div>)}</div>) : <div className="calendar-placeholder">{localOnly ? 'Для ошибочных строк нет календаря' : 'Календарь появится после загрузки точной истории'}</div>}
        </div>}
      </div>
      {epics.map(epic => <Fragment key={epic.summary.key}><div className={`epic-row ${sprintAnalysis ? 'with-sprints' : ''} ${selectedKey === epic.summary.key ? 'selected-row' : ''}`}>
        <div className="left-area metric-grid">
          {metricsSource==='history' && hierarchy && hierarchy.roots[epic.summary.key] && (()=>{const id=hierarchy.roots[epic.summary.key],n=hierarchy.nodes[id],result=childrenOf(hierarchy,id,[],hierarchyAdjacency),expanded=open.has(branchKey([id])),empty=!result.children.length && n.branchCoverage==='complete'&&!result.warnings.length;return <button className="disclosure root-disclosure" disabled={empty} aria-expanded={expanded} aria-label={`${expanded?'Свернуть':'Раскрыть'} ${epic.summary.key}`} title={empty?'Нет связанных элементов':undefined} onClick={()=>toggle([id])}>{empty?'·':expanded?'▾':'▸'}</button>;})()}
          <button className="epic-title" onClick={() => onSelect(epic.summary.key)}><strong>{epic.summary.key}<span>{epic.warnings.length > 0 && '⚠'}</span></strong><span className="title-text">{epic.metadata?.title ?? epic.summary.title}</span><small>{metricsSource === 'excel' ? `Из Excel · ${epic.summary.sourceMetadata?.currentStatus ?? 'статус не указан'}` : `${QUALITY[epic.quality]} · ${epicStateLabel(epic)}`}</small></button>
          {metrics.map(metric => {
            const value = metricValue(epic, metric.id, metricsSource), heat = metric.id.startsWith('extra:') ? 'none' : heatFor(metric.id as Parameters<typeof heatFor>[0], value === null ? null : value / DAY_MS);
            return <button key={metric.id} onClick={() => onSelect(epic.summary.key)} className={`metric heat-${heat}`} style={{ backgroundColor: HEAT_COLORS[heat] }} title={`${metric.name}: ${value === null ? 'нет данных' : preciseDuration(value)}${metricsSource === 'history' && epic.ttmMs === null && value !== null ? ' · длительность этапа по полной истории; начало TTM неизвестно' : ''}`}><span>{days(value)}</span></button>;
          })}
          <div className="flag-caption">{metricsSource === 'excel' ? <>Исполнитель <b>{epicAssignee(epic)}</b></> : <>⚑ Impediment <b>{epic.ttmState === 'not-started' ? 'TTM ещё не начат' : epic.impedimentMs === null ? 'нет данных' : `${days(epic.impedimentMs)} дн.`}</b></>}</div>
        </div>
        {metricsSource === 'excel' ? <CompositionBar epic={epic} columns={metrics} scale={aggregateScale} onSelect={() => onSelect(epic.summary.key)} /> : <EpicBar sprintRow={sprintAnalysis?.rows[hierarchy?.roots[epic.summary.key] ?? '']} epic={epic} range={range} pixels={pixels} width={width} onSelect={() => onSelect(epic.summary.key)} />}
      </div>{metricsSource==='history' && hierarchy && hierarchy.roots[epic.summary.key] && <HierarchyRows sprintAnalysis={sprintAnalysis} index={hierarchyAdjacency!} graph={hierarchy} parent={hierarchy.roots[epic.summary.key]} open={open} toggle={toggle} range={range} pixels={pixels} width={width}/>}</Fragment>)}
      {errors.map(({ id, entry }) => <div key={id} className="error-row">
        <div className="left-area metric-grid">
          <div className="error-title"><strong>{entry.requestedKey}</strong><span>Ошибка · Строка {entry.rows.join(', ')}</span></div>
          {metrics.map(metric => <div key={metric.id} className="metric error-metric" aria-label={`${metric.name}: нет значения`}>—</div>)}
          <div className="flag-caption error-reason">{entry.reason}</div>
        </div>
        <div className="error-calendar" style={{ width }} aria-label="Для этой строки нет календарной истории" />
      </div>)}
      {!epics.length && !errors.length && <div className="no-results">По этому запросу эпиков нет.</div>}
    </div>
  </div>;
}

function EpicBar({ sprintRow, epic, range, pixels, width, onSelect }: { sprintRow?: SprintRow; epic: EpicTimeline; range: CalendarRange; pixels: number; width: number; onSelect: () => void }) {
  const pos = (value: string) => position(Date.parse(value), range.start, pixels);
  const segments = displayIntervals(epic);
  const labels = segmentLabels(segments, range.start, pixels);
  const phaseBars = segments.length ? segments : sprintRow?.phases ?? [];
  const gapPieces = (sprintRow?.gaps ?? []).flatMap(gap => phaseBars.flatMap(phase => {
    const start = Math.max(Date.parse(gap.start), Date.parse(phase.start));
    const end = Math.min(Date.parse(gap.end), Date.parse(phase.end));
    return start < end ? [{ start: new Date(start).toISOString(), end: new Date(end).toISOString(), status: phase.status }] : [];
  }));
  return <div className="row-calendar" style={{width}}><div className={`calendar-body ${segments.length ? '' : 'no-history'}`} style={{ width }}>
    {range.months.map(month => <span className="month-rule" key={month.start} style={{ left: position(month.start, range.start, pixels) }} />)}
    {segments.map((segment, i) => {
      const { left, width: segmentWidth, narrow, labelLeft, lane } = labels[i];
      const style = segment.role !== 'ttm' ? { color: '#e2e8f0', text: '#52647b' } : statusInfo(segment.status);
      const tooltip = `${segment.status}${segment.role !== 'ttm' ? ' · до начала TTM, не входит в расчёт' : segment.openEnded ? ' · В работе' : ''}\n${dateTime(segment.start)} → ${dateTime(segment.end)} МСК\n${preciseDuration(segment.durationMs)}`;
      return <div key={`${segment.start}-${i}`}>
        <button aria-label={tooltip} title={tooltip} onClick={onSelect} className={`status-segment ${segment.role !== 'ttm' ? 'initial-open' : ''} ${['unknown', 'closed'].includes(segment.kind) ? 'hatch' : ''} ${segment.openEnded ? 'open-ended' : ''}`} style={{ left, width: segmentWidth, backgroundColor: style.color, color: style.text }}>{!narrow && segment.code}</button>
        {narrow && <><svg className="callout-line" aria-hidden="true"><path d={`M ${left + segmentWidth / 2} 88 L ${left + segmentWidth / 2} ${20 + lane * 20} L ${labelLeft + 11} ${20 + lane * 20}`} /></svg><button onClick={onSelect} title={tooltip} aria-label={tooltip} className="callout" style={{ left: labelLeft, top: 5 + lane * 20, borderColor: style.color }}>{segment.code}</button></>}
      </div>;
    })}
    {gapPieces.map((gap, i) => {
      const label = `Брешь: ни одна дочерняя задача не была включена в спринт · ${gap.status}\n${dateTime(gap.start)} → ${dateTime(gap.end)} МСК`;
      return <button key={`gap-${i}`} className={`epic-sprint-gap ${segments.length ? '' : 'phase-gap'}`} onClick={onSelect} style={{left:pos(gap.start),width:pos(gap.end)-pos(gap.start)}} title={label} aria-label={label}/>;
    })}
    {epic.end && <button onClick={onSelect} className={`end-marker ${epic.isOpen ? 'in-progress' : ''}`} style={{ left: pos(epic.end) + (epic.isOpen ? 12 : 2) }} title={`${epic.isOpen ? 'В работе на момент расчёта' : 'Окончательное закрытие'}: ${dateTime(epic.end)} МСК`}>{epic.isOpen ? 'В работе' : '🏁'}</button>}
    {!segments.length && sprintRow?.phases.map((s,i)=>{
      const style=statusInfo(s.status);
      return <span key={i} className={`phase-fallback ${['unknown','closed'].includes(style.kind)?'hatch':''}`} style={{left:pos(s.start),width:pos(s.end)-pos(s.start),backgroundColor:style.color,color:style.text}} title={`${s.status} · ${dateTime(s.start)} → ${dateTime(s.end)} МСК`} aria-label={s.status}>{s.status}</span>;
    })}
    {!segments.length && <button className="unavailable" onClick={onSelect}>{epicStateLabel(epic)} · открыть детали</button>}
    <div className="impediment-track">
      {epic.impediments.map((interval, i) => {
        const left = pos(interval.start), intervalWidth = pos(interval.end) - left;
        const tooltip = `Impediment\n${dateTime(interval.start)} → ${dateTime(interval.end)} МСК\n${preciseDuration(interval.durationMs)}`;
        return <div key={i}><button onClick={onSelect} className={`impediment-bar ${interval.openEnded ? 'ongoing-flag' : ''}`} style={{ left, width: intervalWidth }} title={tooltip} aria-label={tooltip} />{intervalWidth < 12 && <button onClick={onSelect} className="flag-callout" style={{ left }} title={tooltip} aria-label={tooltip}>⚑</button>}</div>;
      })}
    </div>
  </div><SprintRows row={sprintRow} range={range} pixels={pixels} width={width}/></div>;
}

function usePanelClose(onClose: () => void, panel: React.RefObject<HTMLElement | null>) {
  useEffect(() => {
    const previous = document.activeElement as HTMLElement | null;
    panel.current?.focus();
    const handler = (event: KeyboardEvent) => {
      if (event.key === 'Escape') onClose();
      if (event.key === 'Tab') {
        const focusable = panel.current?.querySelectorAll<HTMLElement>('button, a[href], input, select, summary, [tabindex="0"]');
        if (!focusable?.length) return;
        const first = focusable[0], last = focusable[focusable.length - 1];
        if (event.shiftKey && (document.activeElement === first || document.activeElement === panel.current)) { event.preventDefault(); last.focus(); }
        if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first.focus(); }
      }
    };
    document.addEventListener('keydown', handler);
    return () => { document.removeEventListener('keydown', handler); previous?.focus(); };
  }, [onClose, panel]);
}

function EpicPanel({ epic, columns, onClose }: { epic: EpicTimeline; columns: MetricColumn[]; onClose: () => void }) {
  const panel = useRef<HTMLElement>(null);
  const composition = compositionFor(epic, columns);
  const difference = composition.totalMs === null || composition.ttmMs === null ? null : composition.totalMs - composition.ttmMs;
  usePanelClose(onClose, panel);
  return <div className="overlay" onMouseDown={e => { if (e.target === e.currentTarget) onClose(); }}><aside className="panel" role="dialog" aria-modal="true" aria-labelledby="epic-panel-title" ref={panel} tabIndex={-1}>
    <div className="panel-top"><a href={`https://hq.tutu.ru/browse/${encodeURIComponent(epic.summary.key)}`} target="_blank" rel="noreferrer">{epic.summary.key} ↗</a><button onClick={onClose} aria-label="Закрыть детали">✕</button></div>
    <h2 id="epic-panel-title">{epic.metadata?.title ?? epic.summary.title}</h2>
    <dl>
      <dt>Данные получены (МСК)</dt><dd>{dateTime(epic.lastImportedAt)}</dd>
      {epic.statusCoverage && <><dt>История статусов</dt><dd>{COVERAGE[epic.statusCoverage]}</dd></>}
      {epic.flagCoverage && <><dt>История impediment</dt><dd>{COVERAGE[epic.flagCoverage]}</dd></>}
      <dt>Продукт</dt><dd>{epic.summary.sourceMetadata?.product || '—'}</dd>
      <dt>Статус при загрузке</dt><dd>{epic.metadata?.currentStatus ?? epic.summary.sourceMetadata?.currentStatus ?? '—'}</dd>
      <dt>Резолюция</dt><dd>{epic.metadata?.resolution || epic.summary.resolution || '—'}</dd>
      <dt>Исполнитель</dt><dd>{epicAssignee(epic)}</dd>
      <dt>Тип задачи</dt><dd>{epic.metadata?.issueType || epic.summary.sourceMetadata?.issueType || '—'}</dd>
      {epic.summary.sourceMetadata?.epicKind && <><dt>Вид эпика</dt><dd>{epic.summary.sourceMetadata.epicKind}</dd></>}
      {epic.summary.sourceMetadata?.reportGroup && <><dt>Группа в отчёте</dt><dd>{epic.summary.sourceMetadata.reportGroup}</dd></>}
    </dl>
    {Object.keys(epic.summary.excelAggregates).length > 0 && <><h3>Длительности из Excel</h3>
    <dl><dt>Исходный TTM</dt><dd>{composition.ttmMs === null ? 'Нет данных' : preciseDuration(composition.ttmMs)}</dd>
      <dt>Сумма известных этапов без Открыто</dt><dd>{composition.totalMs === null ? 'Нет данных' : preciseDuration(composition.totalMs)}</dd>
      <dt>Разница суммы и TTM</dt><dd>{difference === null ? '—' : Math.abs(difference) < 1 ? 'Менее 1 мс' : `${difference < 0 ? '−' : '+'}${preciseDuration(Math.abs(difference))}`}</dd>
      <dt>Вычитание impediment в выгрузке</dt><dd>{epic.summary.sourceMetadata?.impedimentSubtracted ?? 'Не указано'}</dd>
    </dl>
    <p>Сумма содержит предоставленные длительности этапов. Пропуски не считаются нулём; TTM не подгоняется под сумму. Совпадение сумм не подтверждает последовательность или отсутствие повторных входов.</p>
    <div className="stage-breakdown">{composition.segments.map(segment => <div key={segment.id}><span><i className={segment.unknown ? 'hatch' : ''} style={{ backgroundColor: segment.color }} />{segment.name}</span><strong title={preciseDuration(segment.durationMs)}>{days(segment.durationMs)} дн.</strong></div>)}</div>
    {composition.missing.length > 0 && <p>Нет значений: {composition.missing.map(column => column.name).join(', ')}.</p>}
    </>}
    <h3>Календарная история</h3><p className={`quality-${epic.quality}`}>{QUALITY[epic.quality]} · {epicStateLabel(epic)}</p>
    <dl><dt>Момент среза (МСК)</dt><dd>{epic.metadata ? dateTime(epic.asOf) : 'Нет истории'}</dd><dt>Начало предоставленной истории</dt><dd>{dateTime(epic.metadata?.historyStart ?? null)}</dd><dt>TTM по истории</dt><dd>{epic.ttmMs === null ? 'Нет расчёта' : preciseDuration(epic.ttmMs)}</dd><dt>Сумма сегментов истории</dt><dd>{epic.ttmMs === null ? '—' : preciseDuration(epic.intervals.reduce((sum, s) => sum + s.durationMs, 0))}</dd><dt>Impediment по истории</dt><dd>{epic.impedimentMs === null ? 'Нет данных' : preciseDuration(epic.impedimentMs)}</dd></dl>
    <h3>Замечания ({epic.warnings.length})</h3>{epic.warnings.length ? <ul className="panel-warnings">{epic.warnings.map((warning, i) => <li key={i}>{warning.message}</li>)}</ul> : <p>Разрывов и неизвестных статусов не обнаружено.</p>}
    {displayIntervals(epic).some(s => s.role !== 'ttm') && <><h3>До начала TTM — вне расчёта</h3><ol className="transitions">{displayIntervals(epic).filter(s => s.role !== 'ttm').map((s, i) => <li key={i}><strong>{s.status}</strong><span>{dateTime(s.start)} → {dateTime(s.end)} МСК</span><span>{preciseDuration(s.durationMs)}</span></li>)}</ol></>}
    {epic.intervals.length > 0 && <><h3>Сегменты TTM</h3><ol className="transitions">{epic.intervals.map((s, i) => <li key={i}><strong>{s.code} · {s.status}</strong><span>{dateTime(s.start)} → {dateTime(s.end)} МСК</span><span>{preciseDuration(s.durationMs)}{s.openEnded && ' · В работе'}</span></li>)}</ol></>}
    <details><summary>Все переходы статусов ({epic.transitions.length})</summary><ol className="transitions">{epic.transitions.map(t => <li key={t.id}><strong>{t.from} → {t.to}</strong><span>{dateTime(t.at)} МСК</span></li>)}</ol></details>
    <details><summary>Все исходные агрегаты Excel</summary><p>Включая Открыто, которое нельзя разделить на первоначальное ожидание и возвраты.</p><dl>{Object.entries(epic.summary.excelAggregates).map(([name, value]) => <div className="aggregate" key={name}><dt>{name}</dt><dd>{value} дн.</dd></div>)}</dl></details>
  </aside></div>;
}

function RulesPanel({ onClose }: { onClose: () => void }) {
  const panel = useRef<HTMLElement>(null);
  usePanelClose(onClose, panel);
  return <div className="overlay" onMouseDown={e => { if (e.target === e.currentTarget) onClose(); }}><aside className="panel" role="dialog" aria-modal="true" aria-labelledby="rules-title" tabIndex={-1} ref={panel}>
    <div className="panel-top"><h2 id="rules-title">Правила расчёта</h2><button onClick={onClose} aria-label="Закрыть правила">✕</button></div>
    <h3>Источники выборки</h3><p>Четыре режима: CSV/XLSX с ключами, прямой список ключей, ссылка на Jira-доску или на отдельный эпик. Доска задаёт постоянную видимую выборку без быстрых фильтров; файл и прямой ввод — исходные списки кандидатов; отдельная ссылка — одну задачу независимо от доски.</p>
    <p>Для исходной выборки HF и резолюция проверяются по выбранному источнику. DF и отклонённые исходные эпики исключаются. Связанные DF и обычные задачи доступны по стрелке; подзадачи и отклонённые строки скрыты. Допустимые потомки отклонённого эпика остаются видны с пояснением.</p>
    <h3>Состав из Excel</h3><p>Числа берутся из TTM и Cycle Time [HF] без изменения. Справа — сумма длительностей на общей абсолютной шкале дней, с отдельной пунктирной отметкой TTM. Порядок блоков соответствует колонкам файла, а не переходам статусов. Это не календарная шкала. Открыто исключено из состава, поскольку первоначальное ожидание и возвраты в агрегате неразделимы; исходный TTM сохраняется целиком.</p>
    <p>Неизвестные названия этапов показаны нейтральной штриховкой без порогов heatmap. Пропуск остаётся неизвестным, ноль остаётся нулём. Сумма этапов может отличаться от TTM. Медиана и максимум считаются по текущим фильтрам и выбранному источнику; значения без TTM исключаются из этих двух показателей.</p>
    <h3>Календарь по истории</h3>
    <p>TTM начинается с первого активного HF-статуса. Первоначальное Открыто и «Решили делать» до первого активного этапа видны вне расчёта. Если работа ещё не началась, TTM отсутствует. Конец — последний переход в окончательный Закрыт либо единый момент среза для незакрытых эпиков.</p>
    <p>Повторные этапы остаются отдельными сегментами. Открыто внутри TTM учитывается как ↩О, включая незавершённый возврат. Время промежуточного закрытия при переоткрытии сохраняется. Неизвестные и DF-статусы внутри HF-истории показаны серой штриховкой.</p>
    <p>Impediment не вычитается из TTM. Его интервалы ограничены границами TTM. Точные даты, время и длительности доступны в подсказках и деталях эпика. Короткие сегменты имеют выносные подписи; ширина полосы не увеличивается.</p>
    <p>Источник истории файла выбирается явно: Jira или автономный XLSX без сети. Последний набор восстанавливается из локального кэша. История не достраивается из агрегатов. Повторный импорт полностью заменяет набор; история из прежнего файла не подмешивается.</p><h3>Связанные элементы</h3><p>Изначально ветки свёрнуты. Стрелка раскрывает один уровень связанных эпиков и задач, повторное нажатие сворачивает ветку. Дочерние строки показывают статусы от создания до окончательного закрытия либо среза без числовых длительностей. Повторное открытие сохраняется в истории. При недоступности одной истории остальные полосы остаются видны.</p><p>Закрытие определяется категорией статуса, а при её отсутствии — названием: для эпиков [HF] Закрыт или [DF] Закрыт, для задач — распознанными названиями завершения. Неопределённая граница отмечается предупреждением. Поиск и сортировка относятся к исходным эпикам.</p><h3>Спринты и фокус</h3><p>Задача должна состоять в спринте во время работы. Если у неё сейчас есть Jira Sub-task, работа определяется их категорией «В работе»; иначе — категорией самой задачи. Учитываются закрытые и начавшиеся активные спринты, каждый по собственным датам. Любая подтверждённая работа покрывает целый спринт; активный спринт ограничен срезом. Брешь на полосе эпика означает, что ни одна дочерняя задача не была включена в закрытый спринт. Включение хотя бы одной задачи убирает брешь независимо от её рабочих статусов. Неизвестность и предварительное отсутствие работы на полосе эпика не отображаются; сведения о неполных данных сохраняются у спринтов. Метрики TTM и Cycle Time не изменяются.</p><h3>Автономный XLSX со связями</h3><p>Основной лист сохраняет исходные HF-эпики. В Параметрах нужны общий asOf и hierarchyVersion = 1. Листы Элементы и Связи задают метаданные и отношения contains / is contained in; лист История — точные интервалы. Категория статуса на срезе необязательна. Старые книги без связей продолжают открываться.</p>
    <h3>Совместимость прежней истории в XLSX</h3><p>Лист «История»: Ключ эпика, Статус, Начало, Окончание. Строки должны непрерывно покрывать историю. Пустое окончание разрешено только для последнего статуса. Закрытие — отдельная строка «[HF] Закрыт» с точным началом.</p><p>Лист «Параметры»: в первой колонке asOf, во второй — момент среза с точным временем. Лист «Impediment»: Ключ эпика, Начало, Окончание. Пустой лист с этими заголовками означает, что флагов не было; отсутствие листа означает, что данные о флагах неизвестны.</p>
    <h3>Пороги heatmap, дни</h3><p>Нижняя граница включается. Для скоринга: до 30 включительно — без цвета; более 30 — оранжевый. Для возврата в открыто цветовая оценка не применяется.</p>
    {Object.entries(HEAT_BANDS).map(([id, bands]) => <div className="heat-rule" key={id}><strong>{METRICS.find(m => m.id === id)?.name}</strong><div>{bands.map(([lower, heat], index) => <span key={lower} style={{ background: HEAT_COLORS[heat], color: heat === 'burgundy' ? 'white' : undefined }}>{lower}–{bands[index + 1]?.[0] ?? '∞'}</span>)}</div></div>)}
  </aside></div>;
}
