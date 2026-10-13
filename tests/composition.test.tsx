import { describe, expect, it } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import { parseWorkbook } from '../server/import';
import { buildDataset } from '../server/service';
import { compositionFor, compositionScale } from '../shared/composition';
import { metricsFor } from '../shared/metrics';
import { DAY_MS, STAGES } from '../shared/statuses';
import { CompositionBar, CompositionHeader } from '../src/CompositionChart';
import { AS_OF, workbook } from './fixtures';

function dataset(aggregates: string[], values: unknown[][]) {
  return buildDataset(parseWorkbook(workbook([
    ['Ключ эпика', 'Тип эпика', 'Summary', 'Резолюция', ...aggregates],
    ...values.map((row, index) => [`TEST-${index + 1}`, 'HF', 'Пример', '', ...row]),
  ]), 'composition.xlsx', AS_OF), AS_OF);
}

describe('Excel composition without invented chronology', () => {
  it('keeps the original TTM, excludes all Open, and preserves unknown stage names and column order', () => {
    const data = dataset(['[HF] Time To Market', 'Cycle Time [HF] Открыто', 'Cycle Time [HF] Отложено', 'Cycle Time [HF] Реализация'], [[20, 99, 3, 7]]);
    const epic = data.epics[0], columns = metricsFor(data.epics, 'excel');
    const before = JSON.stringify(epic);
    const item = compositionFor(epic, columns);
    expect(item.totalMs).toBe(10 * DAY_MS); expect(item.ttmMs).toBe(20 * DAY_MS);
    expect(item.segments.map(segment => segment.name)).toEqual(['Отложено', 'Реализация']);
    expect(item.segments.map(segment => segment.offsetMs)).toEqual([0, 3 * DAY_MS]);
    expect(item.segments[0].unknown).toBe(true);
    expect(item.segments[0].color).not.toBe(STAGES[0].color);
    expect(epic.intervals).toEqual([]); expect(epic.start).toBeNull();
    expect(JSON.stringify(epic)).toBe(before);
  });
  it('retains workbook order and missing columns even when the first epic has blank cells', () => {
    const data = dataset(['Cycle Time [HF] Проверка идей', 'Cycle Time [HF] Реализация', 'Cycle Time [HF] Эксперимент'], [['', 7, ''], [2, 0, '']]);
    const columns = metricsFor(data.epics, 'excel');
    expect(columns.slice(2).map(column => column.name)).toEqual(['Проверка идей', 'Реализация', 'Эксперимент']);
    const first = compositionFor(data.epics[0], columns), second = compositionFor(data.epics[1], columns);
    expect(first.missing.map(column => column.name)).toEqual(['Проверка идей', 'Эксперимент']);
    expect(first.totalMs).toBe(7 * DAY_MS);
    expect(second.segments[1].durationMs).toBe(0); expect(second.missing).toHaveLength(1);
  });
  it('distinguishes no provided stages from explicit zero durations', () => {
    const data = dataset(['Cycle Time [HF] Реализация'], [[''], [0]]);
    const columns = metricsFor(data.epics, 'excel');
    expect(compositionFor(data.epics[0], columns).totalMs).toBeNull();
    expect(compositionFor(data.epics[1], columns).totalMs).toBe(0);
    expect(compositionScale(data.epics.map(epic => compositionFor(epic, columns)))).toEqual({ maxMs: DAY_MS, ticks: [0, DAY_MS / 2, DAY_MS] });
  });
  it('does not normalize or truncate a stage sum that exceeds TTM', () => {
    const data = dataset(['[HF] Time To Market', 'Cycle Time [HF] Реализация'], [[20, 30], [100, 5]]);
    const columns = metricsFor(data.epics, 'excel'), items = data.epics.map(epic => compositionFor(epic, columns));
    expect(items[0].totalMs).toBe(30 * DAY_MS); expect(items[0].ttmMs).toBe(20 * DAY_MS);
    expect(compositionScale(items).maxMs).toBe(100 * DAY_MS);
    expect(compositionScale(items).ticks.map(value => value / DAY_MS)).toEqual([0, 20, 40, 60, 80, 100]);
  });
  it('retains sub-second values and supports fractions of a day on the scale', () => {
    const data = dataset(['[HF] Time To Market', 'Cycle Time [HF] Реализация'], [[0.5, 125 / DAY_MS]]);
    const item = compositionFor(data.epics[0], metricsFor(data.epics, 'excel'));
    expect(item.segments[0].durationMs).toBe(125);
    expect(compositionScale([item]).ticks.map(value => value / DAY_MS)).toEqual([0, 0.1, 0.2, 0.3, 0.4, 0.5]);
  });
  it('renders the independent TTM marker and exposes all values to keyboard users', () => {
    const data = dataset(['[HF] Time To Market', 'Cycle Time [HF] Реализация'], [[20, 30]]);
    const epic = data.epics[0], columns = metricsFor(data.epics, 'excel');
    const scale = compositionScale([compositionFor(epic, columns)]);
    const markup = renderToStaticMarkup(<CompositionBar epic={epic} columns={columns} scale={scale} onSelect={() => {}} />);
    expect(markup).toContain('Σ этапов: 30 дн. · TTM: 20 дн.');
    expect(markup).toContain('class="composition-ttm"');
    expect(markup).toContain('aria-label="TEST-1.');
    expect(markup).toContain('а не история переходов');
    expect(markup).not.toContain('end-marker');
    expect(renderToStaticMarkup(<CompositionHeader scale={scale} />)).toContain('Порядок колонок Excel');
  });
  it('does not lose unsupported columns that differ only in casing across old cached epics', () => {
    const data = dataset(['Cycle Time [HF] Проверка идей'], [[2], [3]]);
    data.epics[1].summary.excelColumns = undefined;
    data.epics[1].summary.excelAggregates = { 'cycle time [hf] ПРОВЕРКА ИДЕЙ': 3 };
    const columns = metricsFor(data.epics, 'excel');
    expect(columns.filter(column => column.id.startsWith('extra:'))).toHaveLength(1);
    expect(compositionFor(data.epics[1], columns).totalMs).toBe(3 * DAY_MS);
  });
  it('rejects ambiguous duplicate aggregate columns instead of silently replacing a value', () => {
    expect(() => dataset(['Cycle Time [HF] Реализация', ' cycle time [hf] РЕАЛИЗАЦИЯ '], [[1, 7]])).toThrow(/Повторяются названия/);
  });
});
