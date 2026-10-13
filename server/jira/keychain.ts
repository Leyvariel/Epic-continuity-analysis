import { execFile } from 'node:child_process';
import { AppError } from '../errors';
type Runner = (service: string, signal: AbortSignal) => Promise<string>;
const runSecurity: Runner = (service, signal) => new Promise((resolve, reject) => {
  execFile('/usr/bin/security', ['find-generic-password', '-s', service, '-a', 'leyva@tutu.tech', '-w'], { signal, timeout: 20_000, maxBuffer: 16_384, encoding: 'utf8' }, (error, stdout) => error ? reject(error) : resolve(stdout));
});
export async function readPat(signal: AbortSignal, runner: Runner = runSecurity): Promise<string> {
  const services = ['Code Jira Relations PAT', 'tutu-jira'];
  for (const [index, service] of services.entries()) {
    if (signal.aborted) throw new AppError('ABORTED', 'Операция остановлена.');
    try {
      const pat = (await runner(service, signal)).trim();
      if (!pat || /[\r\n]/.test(pat)) throw new AppError('KEYCHAIN_EMPTY', 'Запись Keychain пуста или имеет некорректный формат.');
      return pat;
    } catch (error) {
      if (error instanceof AppError) throw error;
      if (signal.aborted) throw new AppError('ABORTED', 'Операция остановлена.');
      const code = (error as { code?: unknown })?.code;
      if (code === 44 && index === 0) continue;
      if (code === 44) throw new AppError('KEYCHAIN_NOT_FOUND', 'Согласованная запись PAT не найдена в Keychain.');
      if ((error as { killed?: boolean })?.killed) throw new AppError('KEYCHAIN_TIMEOUT', 'Истекло время ожидания Keychain.');
      throw new AppError('KEYCHAIN_DENIED', 'Keychain не разрешил чтение PAT. Альтернативный доступ не выполнялся.');
    }
  }
  throw new AppError('KEYCHAIN_NOT_FOUND', 'PAT не найден.');
}
