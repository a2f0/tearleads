import type { createDocumentsWorkflowRuntime } from "@tearleads/client-sdk";
import {
  createDomainScope,
  createMemoryBlobStore,
  defaultDocumentProjectorRegistry,
} from "@tearleads/client-sdk";
import { createTestExecSql } from "@tearleads/test-utils";

type DocumentsWorkflowRuntimeInput = Parameters<
  typeof createDocumentsWorkflowRuntime
>[0];
type SharedSqlRuntimeBase = Omit<DocumentsWorkflowRuntimeInput, "apiClient"> & {
  readonly close: () => void;
};

export async function createSqlRuntimeBase(
  key: string,
): Promise<SharedSqlRuntimeBase> {
  const { close, execSql } = await createTestExecSql(key);
  const blobStore = createMemoryBlobStore();
  const domainScope = createDomainScope();
  const log = () => {};

  return {
    auth: {
      isAuthenticated: false,
      organizationId: null,
      userId: null,
    },
    close,
    crypto: {
      encapsulationKeyPair: null,
      signingFingerprint: null,
      signingKeyPair: null,
    },
    infra: {
      blobStore,
      dbStatus: "ready",
      documentProjectors: defaultDocumentProjectorRegistry,
      execSql,
    },
    resolveTrustedUserIdentity: async () => null,
    state: {
      containerId: null,
      domainScope,
      events: [],
      online: false,
    },
    util: {
      log,
      reportSecurityIncident: async () => undefined,
    },
  };
}
