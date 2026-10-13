import { vi } from 'vitest';
import type { HistorySnapshot } from '../shared/contracts';
import type { JiraGateway, JiraIssue } from '../server/jira/ports';
import { snapshot } from './fixtures';
export const jiraIssue = (changes: Partial<JiraIssue> = {}): JiraIssue => ({ isSubtask: false, linksKnown: true, links: [], id: '10001', key: 'TEST-1', title: 'HF из Jira', flow: 'HF', isEpic: true, resolution: '', currentStatus: '[HF] Закрыт', created: snapshot().historyStart, updated: snapshot().updated, assignee: '', issueType: 'Большая задача', ...changes });
export const jiraHistory = (changes: Partial<HistorySnapshot> = {}): HistorySnapshot => ({ ...snapshot(), source: 'jira', statusCoverage: 'complete', flagCoverage: 'complete', initialStateProven: true,
  proof: { expected: 3, received: 3, terminal: true, adapterVersion: 'fake-v1' }, ...changes });
export function fakeGateway() {
  return {
    getIssue: vi.fn<JiraGateway['getIssue']>().mockResolvedValue(jiraIssue()),
    getHistory: vi.fn<JiraGateway['getHistory']>().mockResolvedValue(jiraHistory()),
    readBoard: vi.fn<JiraGateway['readBoard']>().mockResolvedValue({ id: '1482', name: 'Тестовая доска', fingerprint: 'stable', complete: true, candidates: [{ requestedKey: 'TEST-1', rows: [] }] }),
    close: vi.fn(),
  };
}
