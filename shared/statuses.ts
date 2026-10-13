import type { Stage, StatusKind } from './types';

export const DAY_MS = 86_400_000;
export const TIME_ZONE = 'Europe/Moscow';
export const STAGES: { id: Stage; name: string; code: string; color: string; text: string }[] = [
  { id: 'preparation', name: 'Подготовка', code: 'П', color: '#087f45', text: '#fff' },
  { id: 'validation', name: 'Валидация', code: 'В', color: '#315ba8', text: '#fff' },
  { id: 'scoring', name: 'Скоринг', code: 'С', color: '#d3d6dc', text: '#252d3a' },
  { id: 'solution', name: 'Проработка решения', code: 'ПР', color: '#af8000', text: '#fff' },
  { id: 'ready', name: 'Готово к реализации', code: 'ГР', color: '#929aa8', text: '#111827' },
  { id: 'implementation', name: 'Реализация', code: 'Р', color: '#b40b16', text: '#fff' },
  { id: 'experiment', name: 'Эксперимент', code: 'Э', color: '#a452de', text: '#fff' },
  { id: 'evaluation', name: 'Оценка результата', code: 'ОР', color: '#f3ef8b', text: '#36351b' },
];

export function normalize(value: unknown): string {
  return String(value ?? '').replace(/_x000D_/g, '').replace(/[\s\u00a0\u202f]+/gu, ' ').trim();
}

export function canonical(value: unknown): string {
  return normalize(value).toLocaleLowerCase('ru').replace(/ё/g, 'е');
}

export function statusInfo(status: string): { kind: StatusKind; code: string; color: string; text: string } {
  const raw = canonical(status);
  // A DF or mixed status must never be silently interpreted as an HF stage.
  if (/\bdf\b/i.test(raw)) return { kind: 'unknown', code: '?', color: '#d1d5db', text: '#374151' };
  const name = raw.replace(/^\[hf\]\s*/i, '').trim();
  const stage = STAGES.find(s => canonical(s.name) === name);
  if (stage) return { ...stage, kind: stage.id };
  if (['открыт', 'открыто', 'open'].includes(name)) return { kind: 'open', code: '↩О', color: '#e9e5fd', text: '#504095' };
  if (['закрыт', 'закрыто', 'closed'].includes(name)) return { kind: 'closed', code: 'З', color: '#d1d5db', text: '#374151' };
  return { kind: 'unknown', code: '?', color: '#d1d5db', text: '#374151' };
}

export function isActive(kind: StatusKind): kind is Stage {
  return STAGES.some(stage => stage.id === kind);
}

export function isRejected(resolution: string): boolean {
  return ['отклонено', 'отклонен', 'rejected', 'не будет выполняться'].includes(canonical(resolution).replace(/^\[(hf|df)\]\s*/, ''));
}

export function emptyDurations(): Record<Stage, number> {
  return Object.fromEntries(STAGES.map(s => [s.id, 0])) as Record<Stage, number>;
}
