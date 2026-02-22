import {
  type LocalWriteOptions,
  LocalWriteOrchestrator
} from '@tearleads/local-write-orchestrator';

const localWriteOrchestrator = new LocalWriteOrchestrator();

type LocalDatabaseWriteOptions = LocalWriteOptions;

export async function runLocalWrite<T>(
  operation: () => Promise<T>,
  options?: LocalDatabaseWriteOptions
): Promise<T> {
  return localWriteOrchestrator.enqueue(() => operation(), options);
}
