import { defaultDocumentProjectorRegistry } from "../../../../data/documents/documentKinds";
import { createDomainScope } from "../../../../data/shared/domainScope";
import type { DocumentsRuntime } from "../../types";
import { noopDocumentStorePersistenceEffects } from "../documentStore.testFixtures";
import { ensureDocumentStoreReady } from "../initialization";
import { createDocumentStoreState, type DocumentStoreState } from "../state";

function offlineRuntime(
  execSql: DocumentsRuntime["infra"]["execSql"],
  domainScope: object,
) {
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
      domainScope,
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
  persistence: Parameters<typeof createDocumentStoreState>[2],
  initialText = "",
  // One runtime across reopens keeps its peer seed, as a page reload does.
  domainScope: object = createDomainScope(),
): Promise<DocumentStoreState> {
  const state = createDocumentStoreState(
    localId,
    offlineRuntime(execSql, domainScope),
    persistence,
    noopDocumentStorePersistenceEffects,
    null,
    initialText,
  );
  if (!(await ensureDocumentStoreReady(state, () => undefined))) {
    throw new Error("Expected document history test store to initialize");
  }
  return state;
}
