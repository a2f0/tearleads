import {
  type BlobStore,
  createMemoryBlobStore,
} from "@tearleads/client-sdk/workflows/blobs";
import type { createDocumentsWorkflowRuntime } from "@tearleads/client-sdk/workflows/documents";
import { createDomainScope } from "@tearleads/client-sdk/workflows/sync";
import { createTestExecSql } from "@tearleads/test-utils";

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
    domainScope: createDomainScope(),
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
