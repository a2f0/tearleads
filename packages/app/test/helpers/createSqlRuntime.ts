import { createMemoryBlobStore } from "../../src/data/blobs";
import type { DocumentsRuntime } from "../../src/data/documents/DocumentsProvider";
import { createExecSql } from "./createExecSql";

type SharedSqlRuntimeBase = Omit<DocumentsRuntime, "apiClient" | "containerId">;

export async function createSqlRuntimeBase(
  key: string,
): Promise<SharedSqlRuntimeBase & { close: () => void }> {
  const { close, execSql } = await createExecSql(key);

  return {
    blobStore: createMemoryBlobStore(),
    cacheReferencedPrincipalPolicies: async () => {},
    close,
    dbStatus: "ready",
    domainScope: {},
    encapsulationKeyPair: null,
    events: [],
    execSql,
    isAuthenticated: false,
    log: () => {},
    online: false,
  };
}
