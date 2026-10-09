import type { DocumentOrphanBlobPersistence } from "../../data/persistence/documents/orphanBlobPersistence";
import type { ExecSql } from "../../data/sqlite/sqlSchema";

export interface OrphanBlobReclaimState {
  deferredStorageKeys: Map<string, number>;
  rerun: boolean;
  running: Promise<void> | undefined;
  sweepKey: string;
}

const states = new WeakMap<
  DocumentOrphanBlobPersistence,
  WeakMap<ExecSql, OrphanBlobReclaimState>
>();

export function orphanBlobReclaimState(
  persistence: DocumentOrphanBlobPersistence,
  execSql: ExecSql,
): OrphanBlobReclaimState {
  let connections = states.get(persistence);
  if (!connections) {
    connections = new WeakMap();
    states.set(persistence, connections);
  }
  let state = connections.get(execSql);
  if (!state) {
    state = {
      deferredStorageKeys: new Map(),
      rerun: false,
      running: undefined,
      sweepKey: `sweep:document-orphans:${crypto.randomUUID()}`,
    };
    connections.set(execSql, state);
  }
  return state;
}
