import { describe, it, expect } from 'vitest';
import { hierarchySchema } from '../server/hierarchy-schema';
const empty = { version: 1, asOf: '2026-09-10T00:00:00+03:00', roots: {}, nodes: {}, edges: [], coverage: 'complete', warnings: [] };
describe('T001: версионированный граф', () => {
  it('принимает явно пустой граф и сохраняет срез', () => expect(hierarchySchema.parse(empty)).toEqual(empty));
  it('отвергает неизвестную версию и повреждённую ссылку', () => {
    expect(hierarchySchema.safeParse({ ...empty, version: 2 }).success).toBe(false);
    expect(hierarchySchema.safeParse({ ...empty, roots: { 'A-1': 'absent' } }).success).toBe(false);
  });
});
