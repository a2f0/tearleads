import { defaultDocumentProjectorRegistry } from "../../../data/documents/documentKinds";
import { createDomainScope } from "../../../data/domainScope";
import { sqlDocumentsPersistence } from "../../../data/persistence/documents/documentsPersistence";
import type { DocumentsRuntime } from "../types";
import { noopDocumentStorePersistenceEffects } from "./documentStore.testFixtures";
import { ensureDocumentStoreReady } from "./initialization";
import { createDocumentStoreState, type DocumentStoreState } from "./state";

function offlineRuntime(execSql: DocumentsRuntime["infra"]["execSql"]) {
  return {
    apiClient: {} as DocumentsRuntime["apiClient"],
    auth: { isAuthenticated: false, organizationId: null, userId: null },
    crypto: {
      encapsulationKeyPair: null,
      signingFingerprint: null,
      signingKeyPair: null,
    },
    infra: {
      blobStore: null as never,
      dbStatus: "ready",
      documentProjectors: defaultDocumentProjectorRegistry,
      execSql,
    },
    resolveTrustedUserIdentity: async () => null,
    state: {
      containerId: "container",
      domainScope: createDomainScope(),
      events: [],
      online: false,
      peerScope: null,
    },
    util: { log: () => undefined },
  } as unknown as DocumentsRuntime;
}

export async function openHistoryTestStore(
  execSql: DocumentsRuntime["infra"]["execSql"],
  localId: string,
  initialText = "",
): Promise<DocumentStoreState> {
  const state = createDocumentStoreState(
    localId,
    offlineRuntime(execSql),
    sqlDocumentsPersistence,
    noopDocumentStorePersistenceEffects,
    null,
    initialText,
  );
  if (!(await ensureDocumentStoreReady(state, () => undefined))) {
    throw new Error("Expected document history test store to initialize");
  }
  return state;
}
