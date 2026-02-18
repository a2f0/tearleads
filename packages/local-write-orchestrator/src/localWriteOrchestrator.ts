export interface LocalWriteConflictContext {
  attempt: number;
  scope: string;
  error: unknown;
}

export interface LocalWriteOptions {
  scope?: string;
  maxRetries?: number;
  retryDelayMs?: number;
  detectConflict?: (context: LocalWriteConflictContext) => boolean;
  onConflictRetry?: (context: LocalWriteConflictContext) => void;
}

export interface LocalWriteExecutionContext {
  attempt: number;
  scope: string;
}

export type LocalWriteOperation<T> = (
  context: LocalWriteExecutionContext
) => Promise<T>;

const DEFAULT_SCOPE = 'sqlite-global-write-lock';
const DEFAULT_MAX_RETRIES = 2;
const DEFAULT_RETRY_DELAY_MS = 10;

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => {
    setTimeout(resolve, ms);
  });
}

function getErrorMessage(error: unknown): string {
  if (error instanceof Error) {
    return error.message;
  }
  return String(error);
}

export function isDefaultSqliteConflict(error: unknown): boolean {
  const message = getErrorMessage(error).toUpperCase();
  return (
    message.includes('SQLITE_BUSY') ||
    message.includes('SQLITE_LOCKED') ||
    message.includes('SQLITE_CONSTRAINT')
  );
}

export class LocalWriteOrchestrator {
  private readonly tails = new Map<string, Promise<void>>();

  async enqueue<T>(
    operation: LocalWriteOperation<T>,
    options: LocalWriteOptions = {}
  ): Promise<T> {
    const scope = options.scope ?? DEFAULT_SCOPE;
    const tail = this.tails.get(scope) ?? Promise.resolve();

    let resolveGate: () => void = () => {};
    const gate = new Promise<void>((resolve) => {
      resolveGate = resolve;
    });

    const nextTail = tail.finally(async () => gate);
    this.tails.set(scope, nextTail);

    await tail;
    try {
      return await this.runWithRetry(operation, scope, options);
    } finally {
      resolveGate();

      if (this.tails.get(scope) === nextTail) {
        this.tails.delete(scope);
      }
    }
  }

  async drain(scope?: string): Promise<void> {
    if (scope) {
      await (this.tails.get(scope) ?? Promise.resolve());
      return;
    }

    await Promise.all([...this.tails.values()]);
  }

  private async runWithRetry<T>(
    operation: LocalWriteOperation<T>,
    scope: string,
    options: LocalWriteOptions
  ): Promise<T> {
    const maxRetries = options.maxRetries ?? DEFAULT_MAX_RETRIES;
    const retryDelayMs = options.retryDelayMs ?? DEFAULT_RETRY_DELAY_MS;
    const detectConflict = options.detectConflict ?? ((ctx) => isDefaultSqliteConflict(ctx.error));

    for (let attempt = 0; ; attempt += 1) {
      try {
        return await operation({ attempt, scope });
      } catch (error) {
        const context: LocalWriteConflictContext = {
          attempt,
          scope,
          error
        };

        const canRetry = attempt < maxRetries && detectConflict(context);
        if (!canRetry) {
          throw error;
        }

        options.onConflictRetry?.(context);
        await sleep(retryDelayMs);
      }
    }
  }
}
