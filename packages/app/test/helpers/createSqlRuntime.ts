import { createMemoryBlobStore } from "../../src/data/blobs";
import type { DocumentsRuntime } from "../../src/data/documents/DocumentsProvider";
import { createTestExecSql } from "./createTestExecSql";

type SharedSqlRuntimeBase = Omit<DocumentsRuntime, "apiClient" | "containerId">;

export async function createSqlRuntimeBase(
  key: string,
): Promise<SharedSqlRuntimeBase & { close: () => void }> {
  const { close, execSql } = await createTestExecSql(key);

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
