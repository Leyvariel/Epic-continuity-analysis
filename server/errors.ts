export class AppError extends Error {
  constructor(public code: string, message: string, public status = 400) { super(message); }
}

// Never forward network response bodies, native Error objects or subprocess stderr.
export function safeError(error: unknown): { code: string; message: string } {
  if (error instanceof AppError) return { code: error.code, message: error.message };
  return { code: 'INTERNAL_ERROR', message: 'Не удалось выполнить операцию. Проверьте доступ и повторите попытку.' };
}
