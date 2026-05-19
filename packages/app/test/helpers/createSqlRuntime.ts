import type { BlobStore } from "@tearleads/client-sdk/data/blobContracts";
import { createMemoryBlobStore } from "@tearleads/client-sdk/data/blobs/memoryBlobStore";
import type { createDocumentsWorkflowRuntime } from "@tearleads/client-sdk/workflows/documents/index";
import { createTestExecSql } from "./createTestExecSql";

type DocumentsWorkflowRuntimeInput = Parameters<
  typeof createDocumentsWorkflowRuntime
>[0];
type SharedSqlRuntimeBase = Omit<
  DocumentsWorkflowRuntimeInput,
  | "apiClient"
  | "blobStore"
  | "containerId"
  | "dbStatus"
  | "encapsulationKeyPair"
  | "events"
  | "organizationId"
  | "signingFingerprint"
  | "signingKeyPair"
  | "userId"
> & {
  blobStore: BlobStore;
  dbStatus: "ready";
  encapsulationKeyPair: null;
  events: [];
  organizationId: null;
  signingFingerprint: null;
  signingKeyPair: null;
  userId: null;
};

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
    organizationId: null,
    signingFingerprint: null,
    signingKeyPair: null,
    userId: null,
  };
}
