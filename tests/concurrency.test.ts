import { describe, expect, it } from 'vitest';
import { mapConcurrent } from '../server/jira/concurrency';
describe('Ограниченная очередь Jira', () => {
  it('не превышает лимит и сохраняет порядок результата при разной скорости задач', async () => {
    let active = 0, peak = 0;
    const result = await mapConcurrent([1, 2, 3, 4, 5], 4, new AbortController().signal, async n => {
      peak = Math.max(peak, ++active);
      await new Promise(resolve => setTimeout(resolve, 6 - n)); active--; return n * 2;
    });
    expect(peak).toBe(4); expect(result).toEqual([2, 4, 6, 8, 10]);
  });
  it('после ошибки прекращает запуск новых задач и дожидается остановки активных', async () => {
    const started: number[] = []; let stopped = false;
    await expect(mapConcurrent([1, 2, 3, 4], 2, new AbortController().signal, async (n, signal) => {
      started.push(n);
      if (n === 1) { await new Promise(resolve => setTimeout(resolve, 1)); throw new Error('stop'); }
      await new Promise<void>(resolve => signal.addEventListener('abort', () => { stopped = true; resolve(); }, { once: true }));
      return n;
    })).rejects.toThrow('stop');
    expect(started).toEqual([1, 2]); expect(stopped).toBe(true);
  });
});
