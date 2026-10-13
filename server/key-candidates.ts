import type { AuditEntry, Candidate } from '../shared/contracts';
import { ISSUE_KEY } from './import';
import { AppError } from './errors';

export interface ParsedKeys { candidates: Candidate[]; invalid: AuditEntry[]; inputRows: number }

export function parseKeyCandidates(text: string): ParsedKeys {
  const candidates = new Map<string, Candidate>();
  const invalid: AuditEntry[] = [];
  let inputRows = 0;
  text.replace(/^\uFEFF/, '').split(/\r\n|\n|\r/).forEach((line, index) => {
    const trimmed = line.trim();
    if (!trimmed || trimmed === 'New grid' || /^\|\s*:?-{3,}:?\s*\|$/.test(trimmed)) return;
    const cell = /^\|([^|]*)\|$/.exec(trimmed);
    if (trimmed.includes('|') && !cell) {
      inputRows++;
      invalid.push({ requestedKey: line, rows: [index + 1], decision: 'invalid', reason: 'Строка содержит несколько столбцов или неверное оформление таблицы.' });
      return;
    }
    const content = cell ? cell[1] : line;
    for (const part of content.split(',')) {
      const value = part.trim().toUpperCase();
      if (!value) continue;
      inputRows++;
      if (!ISSUE_KEY.test(value)) {
        invalid.push({ requestedKey: content.includes(',') ? part : line, rows: [index + 1], decision: 'invalid', reason: 'Некорректный формат ключа Jira.' });
        continue;
      }
      const existing = candidates.get(value);
      if (existing) existing.rows.push(index + 1);
      else {
        if (candidates.size >= 1000) throw new AppError('SELECTION_TOO_LARGE', 'В одном списке допускается не более 1000 уникальных ключей; список не усечён.');
        candidates.set(value, { requestedKey: value, rows: [index + 1] });
      }
    }
  });
  if (!inputRows) throw new AppError('EMPTY_KEYS', 'Введите хотя бы один ключ или строку с ошибкой.');
  return { candidates: [...candidates.values()], invalid, inputRows };
}
