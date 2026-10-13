import { mkdtemp, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { vi } from 'vitest';
import { DatasetService } from '../server/service';
import { CacheStore } from '../server/cache';
import { jiraIssue, jiraHistory } from './jira-fixtures';
import { CUT, at, history } from './hierarchy-fixtures';

export async function linkedJiraDataset() {
  const directory = await mkdtemp(path.join(os.tmpdir(), 'linked-jira-fixture-'));
  try {
    const gateway = {
      getIssue: vi.fn(async (id: string) => {
        const epic = ['A-1', 'B-1'].includes(id), status = epic ? `[${id === 'A-1' ? 'HF' : 'DF'}] Реализация` : 'Готово';
        return jiraIssue({ id, key: id, title: id === 'A-1' ? 'Корень' : id === 'B-1' ? 'DF' : id === 'C-1' ? 'Задача' : 'Подзадача',
          isEpic: epic, isSubtask: id === 'S-1', flow: id === 'B-1' ? 'DF' : 'HF',
          created: at(1), updated: CUT, currentStatus: status,
          links: id === 'A-1' ? [{ parent: id, child: 'B-1', childKey: 'B-1' }]
            : id === 'B-1' ? [{ parent: id, child: 'C-1', childKey: 'C-1' }, { parent: id, child: 'S-1', childKey: 'S-1' }] : [],
        });
      }),
      getHistory: vi.fn(async (issue: ReturnType<typeof jiraIssue>) => jiraHistory({ ...history(issue.key), updated: CUT,
        ...(issue.isEpic ? { currentStatus: issue.currentStatus, statusChanges: [] } : {}),
      })),
      readBoard: vi.fn(),
    };
    const service = new DatasetService(new CacheStore(directory), () => CUT, async () => gateway);
    const job = service.importEpic('https://hq.tutu.ru/browse/A-1');
    await service.waitForIdle();
    if (job.status !== 'completed') throw new Error(JSON.stringify(job.errors));
    return service.getDataset()!;
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
}
