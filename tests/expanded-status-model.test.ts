import { describe, expect, it } from 'vitest';
import { STAGES, DAY_MS, statusInfo } from '../shared/statuses';
import { calculateTimeline } from '../server/timeline';
import { calculateJiraTimeline } from '../server/jira/normalize';
import { jiraHistory } from './jira-fixtures';
import { modelHistory } from './status-model-fixtures';

describe('FR-043/044: expanded status catalogue and independent durations', () => {
  it('retains the eight original identities and recognises six distinct additions', () => {
    const old = ['preparation', 'validation', 'scoring', 'solution', 'ready', 'implementation', 'experiment', 'evaluation'];
    expect(STAGES.filter(s => old.includes(s.id)).map(s => s.id)).toEqual(old);
    const additions = [
      ['[HF] Проверка идей', 'idea-check'], ['Решили делать', 'decided'], ['[HF] Отложено', 'deferred'],
      ['[HF] Запланировано', 'planned'], ['Тестирование эпика', 'epic-testing'], ['Релиз', 'release'],
    ];
    for (const [name, kind] of additions) expect(statusInfo(name).kind).toBe(kind);
    expect(new Set(STAGES.map(s => s.id)).size).toBe(14);
    expect(statusInfo('[DF] Реализация').kind).toBe('unknown');
  });
  it('AC-097: sums repeated testing without losing either interval or old stage totals', () => {
    const f = modelHistory([['[HF] Подготовка', 1], ['Тестирование эпика', 2], ['[HF] Реализация', 1], ['Тестирование эпика', 3]]);
    const epic = calculateTimeline(f.summary, f.history, f.asOf);
    expect(epic.durations).toMatchObject({ preparation: DAY_MS, implementation: DAY_MS, 'epic-testing': 5 * DAY_MS, release: 0 });
    expect(epic.intervals.filter(s => s.status === 'Тестирование эпика').map(s => s.durationMs)).toEqual([2 * DAY_MS, 3 * DAY_MS]);
  });
  it('AC-098: partial Jira history never turns a newly recognised status into a proven number', () => {
    const f = modelHistory([['[HF] Подготовка', 1], ['Релиз', 3]]);
    const h = jiraHistory({ ...f.history, statusCoverage: 'partial' });
    expect(calculateJiraTimeline(f.summary, h, f.asOf).durations).toBeNull();
  });
});
