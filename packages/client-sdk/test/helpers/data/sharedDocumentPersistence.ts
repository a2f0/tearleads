import type { DatabaseConnectionRegistryOptions } from "@tearleads/sqlite-worker/database-connections";
import { sqlDocumentsPersistence } from "../../../src/data/persistence/documents/documentsPersistence";
import { createSharedWorkerSqliteConnections } from "./sharedWorkerSqliteConnections";

export async function openSharedDocumentPersistenceConnections(
  key: string,
  options: {
    readonly leaseBounds?:
      | DatabaseConnectionRegistryOptions["leaseBounds"]
      | undefined;
  } = {},
) {
  const shared = createSharedWorkerSqliteConnections({
    key,
    leaseBounds: options.leaseBounds,
  });
  const firstRuntime = await shared.connect("first");
  await sqlDocumentsPersistence.ensureSchema(firstRuntime.execSql);
  const secondRuntime = await shared.connect("second");
  return {
    close: () => shared.close(),
    first: { runtime: firstRuntime },
    second: { runtime: secondRuntime },
  };
}
