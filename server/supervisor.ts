import { fork, type ChildProcess } from 'node:child_process';

export const RESTART_EXIT_CODE = 75;

// Only the reserved exit code requests a replacement; crashes remain visible.
export function supervise(entry: string, args: string[]): void {
  let child: ChildProcess;
  let stopping = false;
  let deadline: ReturnType<typeof setTimeout> | undefined;
  const start = () => {
    child = fork(entry, args, { stdio: ['inherit', 'inherit', 'inherit', 'ipc'] });
    child.once('error', () => {
      console.error('Не удалось запустить процесс приложения.');
      process.exitCode = 1;
    });
    child.once('exit', code => {
      clearTimeout(deadline);
      if (!stopping && code === RESTART_EXIT_CODE) start();
      else process.exitCode = stopping ? 0 : code ?? 1;
    });
  };
  for (const signal of ['SIGINT', 'SIGTERM'] as const) process.once(signal, () => {
    stopping = true;
    child.kill(signal);
    deadline = setTimeout(() => child.kill('SIGKILL'), 3000);
    deadline.unref();
  });
  start();
}
