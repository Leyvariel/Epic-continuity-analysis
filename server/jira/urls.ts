import { AppError } from '../errors';
import { ISSUE_KEY } from '../import';
export const JIRA_ORIGIN = 'https://hq.tutu.ru' as const;
function localJiraUrl(value: string): URL {
  let url: URL;
  try { url = new URL(value); } catch { throw new AppError('INVALID_URL', 'Нужна полная Jira-ссылка.'); }
  if (url.origin !== JIRA_ORIGIN || url.username || url.password) throw new AppError('INVALID_URL', 'Разрешены ссылки https://hq.tutu.ru без данных авторизации.');
  return url;
}
export function parseBoardUrl(value: string) {
  const url = localJiraUrl(value), ids = url.searchParams.getAll('rapidView');
  if (url.pathname !== '/secure/RapidBoard.jspa' || ids.length !== 1 || !/^[1-9]\d*$/.test(ids[0])) throw new AppError('INVALID_BOARD_URL', 'Нужна ссылка на доску с одним числовым rapidView.');
  return { boardId: ids[0], url: `${JIRA_ORIGIN}/secure/RapidBoard.jspa?rapidView=${ids[0]}`, ignoredParameters: [...url.searchParams.keys()].some(key => key !== 'rapidView') || !!url.hash };
}
export function parseEpicUrl(value: string) {
  const url = localJiraUrl(value), match = /^\/browse\/([^/]+)$/.exec(url.pathname);
  if (!match || !ISSUE_KEY.test(match[1])) throw new AppError('INVALID_EPIC_URL', 'Нужна ссылка вида https://hq.tutu.ru/browse/KEY-123.');
  return { requestedKey: match[1], url: `${JIRA_ORIGIN}/browse/${match[1]}` };
}
