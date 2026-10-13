import { readFile } from 'node:fs/promises';
import { z } from 'zod';
import { JiraClient } from './client';
import { readPat } from './keychain';
import { ServerJiraAdapter, profileSchema } from './adapter';
import { AppError } from '../errors';
import type { GatewayFactory } from './ports';
export function gatewayFromProfile(profilePath: string): GatewayFactory {
  return async signal => {
    let profile: z.infer<typeof profileSchema>;
    try { profile = profileSchema.parse(JSON.parse(await readFile(profilePath, 'utf8'))); }
    catch { throw new AppError('PROFILE_UNVERIFIED', 'Нет проверенного профиля Jira. Сначала выполните согласованную диагностику G0.', 503); }
    const client = new JiraClient(await readPat(signal));
    try {
      const info = z.object({ version: z.string() }).safeParse(await client.get('/rest/api/2/serverInfo', {}, signal));
      if (!info.success || info.data.version !== profile.version) throw new AppError('JIRA_VERSION_CHANGED', 'Версия Jira изменилась. Нужна повторная проверка адаптера.', 503);
      return new ServerJiraAdapter(client, profile);
    } catch (error) { client.close(); throw error; }
  };
}
