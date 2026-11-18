// @vitest-environment jsdom
import { afterEach, expect, it, vi } from 'vitest';
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { App } from '../src/App';
import { restartApplication } from '../src/restart';
vi.mock('../src/restart', () => ({ restartApplication: vi.fn() }));
const roots: Root[] = [];
afterEach(async () => {
  for (const root of roots.splice(0)) await act(() => root.unmount());
  document.body.innerHTML = ''; vi.restoreAllMocks(); vi.mocked(restartApplication).mockReset();
});
async function mount(mode = 'application', pending = false) {
  Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
  let finish!: (value: Response) => void;
  vi.spyOn(globalThis, 'fetch').mockImplementation(async () => pending ? new Promise(resolve => { finish = resolve; }) : new Response(JSON.stringify({ dataset: null, mode })));
  const div = document.createElement('div'); document.body.append(div);
  const root = createRoot(div); roots.push(root); await act(() => root.render(<App />));
  return { div, finish: () => finish(new Response(JSON.stringify({ dataset: null, mode }))) };
}
const button = (div: HTMLElement, label: string) => [...div.querySelectorAll<HTMLButtonElement>('button')].find(b => b.textContent === label)!;
it('AC-160/161 locks restart, import and reset while waiting; failure unlocks and shows the error', async () => {
  let reject!: (error: Error) => void;
  vi.mocked(restartApplication).mockImplementation(() => new Promise((_resolve, fail) => { reject = fail; }));
  const { div } = await mount();
  await act(() => button(div, 'Перезапустить приложение').click());
  expect(button(div, 'Перезапуск…').disabled).toBe(true);
  expect(button(div, 'Сбросить все данные').disabled).toBe(true);
  expect(div.querySelector<HTMLInputElement>('input[type=file]')!.disabled).toBe(true);
  expect(div.textContent).toContain('Сохранённый анализ откроется автоматически');
  expect(div.querySelector('.progress')).toBeNull();
  await act(() => button(div, 'Перезапуск…').click());
  expect(restartApplication).toHaveBeenCalledTimes(1);
  await act(() => reject(new Error('Не удалось дождаться перезапуска')));
  expect(button(div, 'Перезапустить приложение').disabled).toBe(false);
  expect(div.querySelector('[role=alert]')?.textContent).toContain('Не удалось дождаться');
});
it.each(['demo', 'snapshot'])('AC-162 hides restart in %s', async mode => {
  const { div } = await mount(mode);
  expect(button(div, 'Перезапустить приложение')).toBeUndefined();
});
it('AC-161 blocks restart during initial load and reset confirmation', async () => {
  const app = await mount('application', true);
  expect(button(app.div, 'Перезапустить приложение').disabled).toBe(true);
  await act(() => app.finish());
  expect(button(app.div, 'Перезапустить приложение').disabled).toBe(false);
  await act(() => button(app.div, 'Сбросить все данные').click());
  expect(button(app.div, 'Перезапустить приложение').disabled).toBe(true);
  await act(() => button(app.div, 'Отмена').click());
  expect(button(app.div, 'Перезапустить приложение').disabled).toBe(false);
});
