import type { LocalWriteOrchestrator as LocalWriteOrchestratorClass } from '@tearleads/local-write-orchestrator';

type LocalWriteOrchestratorModule = {
  LocalWriteOrchestrator: typeof LocalWriteOrchestratorClass;
};

const LOCAL_WRITE_ORCHESTRATOR_MODULE_SPECIFIERS = [
  '@tearleads/local-write-orchestrator',
  new URL('../../../local-write-orchestrator/src/index.ts', import.meta.url)
    .href,
  new URL('../../../local-write-orchestrator/dist/index.js', import.meta.url)
    .href
] as const;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

function isLocalWriteOrchestratorModule(
  value: unknown
): value is LocalWriteOrchestratorModule {
  if (!isRecord(value)) {
    return false;
  }

  return typeof value['LocalWriteOrchestrator'] === 'function';
}

export async function getLocalWriteOrchestratorModule(): Promise<LocalWriteOrchestratorModule> {
  let lastError: unknown;

  for (const specifier of LOCAL_WRITE_ORCHESTRATOR_MODULE_SPECIFIERS) {
    try {
      const candidate = await import(specifier);
      if (isLocalWriteOrchestratorModule(candidate)) {
        return candidate;
      }
    } catch (error) {
      lastError = error;
    }
  }

  const reason =
    lastError instanceof Error ? lastError.message : String(lastError ?? '');
  throw new Error(`Unable to load local-write-orchestrator: ${reason}`);
}
