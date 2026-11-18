import { request } from './api';

export async function restartApplication(reload: () => void = () => window.location.reload()): Promise<void> {
  const accepted = await request<{ instanceId: string }>('/api/restart', {
    method: 'POST', headers: { 'X-Local-Request': '1' }, signal: AbortSignal.timeout(3000),
  });
  if (typeof accepted.instanceId !== 'string' || !accepted.instanceId) throw new Error('Сервер не подтвердил перезапуск. Обновите страницу и повторите действие.');
  const deadline = Date.now() + 30_000;
  while (Date.now() < deadline) {
    await new Promise(resolve => setTimeout(resolve, Math.min(500, deadline - Date.now())));
    if (Date.now() >= deadline) break;
    try {
      const current = await request<{ instanceId: string }>('/api/runtime', { signal: AbortSignal.timeout(Math.max(1, Math.min(2000, deadline - Date.now()))) });
      if (typeof current.instanceId === 'string' && current.instanceId && current.instanceId !== accepted.instanceId) {
        reload(); return;
      }
    } catch { /* Temporary unavailability is expected while the server restarts. */ }
  }
  throw new Error('Не удалось дождаться перезапуска за 30 секунд. Показан прежний анализ. Проверьте, что приложение запущено, и обновите страницу.');
}
