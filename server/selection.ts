import { isRejected } from '../shared/statuses';
import type { Decision } from '../shared/contracts';
import type { JiraIssue } from './jira/ports';
export function decideEligibility(issue: Pick<JiraIssue, 'isEpic' | 'flow' | 'resolution' | 'currentStatus'>): Decision {
  if (!issue.isEpic) return 'excluded-not-epic';
  if (issue.flow === 'unknown') return 'unresolved';
  if (issue.flow === 'DF') return 'excluded-df';
  if (isRejected(issue.resolution) || isRejected(issue.currentStatus)) return 'excluded-rejected';
  return 'included';
}
export const decisionReason: Record<Decision, string> = {
  included: 'HF по текущим данным Jira', 'excluded-df': 'DF по текущим данным Jira',
  'excluded-rejected': 'Отклонён по текущим данным Jira', 'excluded-not-epic': 'Задача не является эпиком',
  unresolved: 'Не удалось подтвердить HF и резолюцию в Jira', invalid: 'Некорректный ключ в файле',
};
