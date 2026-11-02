import { canonical, isRejected } from '../shared/statuses';
import type { Decision } from '../shared/contracts';
import type { JiraIssue } from './jira/ports';
type EligibilityIssue = Pick<JiraIssue, 'isEpic' | 'flow' | 'resolution' | 'currentStatus'> & Partial<Pick<JiraIssue, 'key' | 'currentStatusId'>>;
const HOTELS_STATUSES: Record<string, string> = { 'решили делать': '21467', 'тестирование эпика': '22135', 'релиз': '20871' };
export function hasHotelsStatusException(issue: Pick<EligibilityIssue, 'isEpic' | 'currentStatus' | 'currentStatusId' | 'key'>): boolean {
  const id = HOTELS_STATUSES[canonical(issue.currentStatus)];
  return issue.isEpic && /^HOTELS-\d+$/.test(issue.key ?? '') && !!id && (!issue.currentStatusId || issue.currentStatusId === id);
}
export function decideEligibility(issue: EligibilityIssue): Decision {
  if (!issue.isEpic) return 'excluded-not-epic';
  if (issue.flow === 'unknown' && !hasHotelsStatusException(issue)) return 'unresolved';
  if (issue.flow === 'DF') return 'excluded-df';
  if (isRejected(issue.resolution) || isRejected(issue.currentStatus)) return 'excluded-rejected';
  return 'included';
}
export function reasonForDecision(issue: EligibilityIssue, decision: Decision): string {
  return decision === 'included' && hasHotelsStatusException(issue)
    ? 'Разрешённый статус эпика HOTELS без [HF]' : decisionReason[decision];
}
export const decisionReason: Record<Decision, string> = {
  included: 'HF по текущим данным Jira', 'excluded-df': 'DF по текущим данным Jira',
  'excluded-rejected': 'Отклонён по текущим данным Jira', 'excluded-not-epic': 'Задача не является эпиком',
  unresolved: 'Не удалось подтвердить HF и резолюцию в Jira', invalid: 'Некорректный ключ в файле',
};
