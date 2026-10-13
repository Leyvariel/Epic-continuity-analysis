import { describe, expect, it } from 'vitest';
import { parseBoardUrl, parseEpicUrl } from '../server/jira/urls';
import { calculateJiraTimeline } from '../server/jira/normalize';
import { decideEligibility } from '../server/selection';
import type { HistorySnapshot } from '../shared/contracts';
import { AS_OF, snapshot, summary } from './fixtures';
import { displayIntervals } from '../shared/display';

export const history = (changes: Partial<HistorySnapshot> = {}): HistorySnapshot => ({ ...snapshot(), source: 'jira', statusCoverage: 'complete', flagCoverage: 'complete', initialStateProven: true,
  proof: { expected: 3, received: 3, terminal: true, adapterVersion: 'fake-v1' }, ...changes });

describe('Дано Jira-источник → валидируем источник и доказательства расчёта', () => {
  it('сохраняет порядок нулевых интервалов при объединении Открыто и Решили делать на календаре', () => {
    const data = history({ statusChanges: [
      { id: '1', order: 0, at: '2026-09-02T09:00:00Z', from: '[HF] Открыт', to: 'Решили делать' },
      { id: '2', order: 1, at: '2026-09-02T09:00:00Z', from: 'Решили делать', to: '[HF] Открыт' },
      { id: '3', order: 2, at: '2026-09-02T09:00:00Z', from: '[HF] Открыт', to: '[HF] Подготовка' },
      { id: '4', order: 3, at: '2026-09-17T09:00:00Z', from: '[HF] Подготовка', to: '[HF] Закрыт' },
    ] });
    expect(displayIntervals(calculateJiraTimeline(summary, data, AS_OF)).map(s => s.status)).toEqual(['[HF] Открыт', 'Решили делать', '[HF] Открыт', '[HF] Подготовка']);
  });
  it('полнота флагов остаётся отдельной причиной частичного результата до начала TTM', () => {
    const data = history({ currentStatus: '[HF] Открыт', statusChanges: [], flagCoverage: 'unavailable', flagAvailable: false });
    const result = calculateJiraTimeline(summary, data, AS_OF);
    expect(result.ttmState).toBe('not-started'); expect(result.ttmMs).toBeNull();
    expect(result.quality).toBe('partial'); expect(result.warnings.some(w => w.code === 'FLAG_HISTORY_INCOMPLETE')).toBe(true);
  });
  it('S11: Решили делать до первого активного этапа видно, но исключено из TTM', () => {
    const data = history({ statusChanges: [
      { id: '1', at: '2026-09-02T09:00:00Z', from: '[HF] Открыт', to: 'Решили делать' },
      { id: '2', at: '2026-09-05T09:00:00Z', from: 'Решили делать', to: '[HF] Подготовка' },
      { id: '3', at: '2026-09-17T09:00:00Z', from: '[HF] Подготовка', to: '[HF] Закрыт' },
    ] });
    const result = calculateJiraTimeline(summary, data, AS_OF);
    expect(result.ttmMs).toBe(12 * 86400000);
    expect(result.preTtmIntervals?.[0].status).toBe('Решили делать');
    expect(result.initialOpenIntervals).toHaveLength(1);
  });
  it('доска задаётся rapidView, projectKey/quickFilter не ограничивают выборку', () => {
    expect(parseBoardUrl('https://hq.tutu.ru/secure/RapidBoard.jspa?rapidView=1482&projectKey=HOTELS&quickFilter=1').boardId).toBe('1482');
    expect(() => parseBoardUrl('https://hq.tutu.ru/secure/RapidBoard.jspa?rapidView=1&rapidView=2')).toThrow();
    expect(() => parseEpicUrl('https://evil.test/browse/TEST-1')).toThrow();
    expect(() => parseEpicUrl('https://user@hq.tutu.ru/browse/TEST-1')).toThrow();
    expect(parseEpicUrl('https://hq.tutu.ru/browse/TEST-1?foo=1').url).toBe('https://hq.tutu.ru/browse/TEST-1');
  });
  it('отклонённый HF исключён, неизвестный тип не становится DF', () => {
    expect(decideEligibility({ isEpic: true, flow: 'HF', resolution: 'Отклонено', currentStatus: '[HF] Закрыт' })).toBe('excluded-rejected');
    expect(decideEligibility({ isEpic: true, flow: 'HF', resolution: 'Не будет выполняться', currentStatus: '[HF] Закрыт' })).toBe('excluded-rejected');
    expect(decideEligibility({ isEpic: true, flow: 'HF', resolution: 'Сделано', currentStatus: '[HF] Закрыт' })).toBe('included');
    expect(decideEligibility({ isEpic: true, flow: 'unknown', resolution: '', currentStatus: '[HF] Реализация' })).toBe('unresolved');
  });
  it('обрезанная история Открыто не даёт not-started', () => {
    const result = calculateJiraTimeline(summary, history({ statusChanges: [], currentStatus: '[HF] Открыт', statusCoverage: 'partial' }), AS_OF);
    expect(result.ttmState).toBe('indeterminate');
    expect(result.initialOpenIntervals).toEqual([]);
  });
  it('конец пагинации и начальное состояние проверяются независимо от флага complete', () => {
    expect(calculateJiraTimeline(summary, history({ initialStateProven: false }), AS_OF).ttmMs).toBeNull();
    expect(calculateJiraTimeline(summary, history({ proof: { expected: 4, received: 3, terminal: false, adapterVersion: 'fake' } }), AS_OF).ttmMs).toBeNull();
  });
  it('разрыв после asOf тоже означает недоказанную историю', () => {
    const data = history();
    data.statusChanges.push({ id: '4', at: '2026-09-19T09:00:00Z', from: 'Другое', to: '[HF] Закрыт' });
    expect(calculateJiraTimeline(summary, data, AS_OF).ttmMs).toBeNull();
  });
  it('недоступный флаг не отменяет TTM; созданный после среза не присутствовал в нём', () => {
    const result = calculateJiraTimeline(summary, history({ flagCoverage: 'unavailable' }), AS_OF);
    expect(result.ttmMs).toBe(15 * 86400000); expect(result.impedimentMs).toBeNull();
    expect(calculateJiraTimeline(summary, history({ historyStart: '2026-09-19T00:00:00Z' }), AS_OF).ttmState).toBe('not-present');
  });
  it('переименование статуса с сохранённым id не создаёт ложный разрыв', () => {
    const data = history({ statusChanges: [
      { id: 'a', at: '2026-09-02T09:00:00Z', from: '[HF] Открыт', fromId: '1', to: '[HF] Подготовка', toId: '2', order: 0 },
      { id: 'b', at: '2026-09-05T09:00:00Z', from: 'Подготовка (новое имя)', fromId: '2', to: '[HF] Закрыт', toId: '3', order: 1 },
    ] });
    expect(calculateJiraTimeline(summary, data, AS_OF).ttmMs).toBe(3 * 86400000);
  });
  it('разрыв цепочки impediment после среза делает только флаги недостоверными', () => {
    const data = history({ currentFlag: false, flagChanges: [
      { id: '1', at: '2026-09-19T00:00:00Z', from: false, to: true },
      { id: '2', at: '2026-09-20T00:00:00Z', from: false, to: false },
    ] });
    const result = calculateJiraTimeline(summary, data, AS_OF);
    expect(result.ttmMs).toBe(15 * 86400000); expect(result.impedimentMs).toBeNull();
    expect(result.flagCoverage).toBe('partial');
  });
});
