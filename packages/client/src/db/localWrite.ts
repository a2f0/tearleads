import {
  type LocalWriteOptions,
  LocalWriteOrchestrator
} from '@tearleads/local-write-orchestrator';

const localWriteOrchestrator = new LocalWriteOrchestrator();

export type LocalDatabaseWriteOptions = LocalWriteOptions;

export async function runLocalWrite<T>(
  operation: () => Promise<T>,
  options?: LocalDatabaseWriteOptions
): Promise<T> {
  return localWriteOrchestrator.enqueue(async () => operation(), options);
}

export async function drainLocalWrites(scope?: string): Promise<void> {
  await localWriteOrchestrator.drain(scope);
}
