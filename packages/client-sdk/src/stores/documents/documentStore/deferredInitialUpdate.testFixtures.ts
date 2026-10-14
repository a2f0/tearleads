import { base64ToBytes } from "@tearleads/encoding";
import { createDocument, importUpdates } from "@tearleads/loro";
import type { BlobStore } from "../../../data/blobContracts";
import { getDocumentAttachments } from "../../../data/documents/documentContent";
import {
  defaultDocumentProjectorRegistry,
  readStoredDocumentState,
} from "../../../data/documents/documentKinds";
import { createDomainScope } from "../../../data/domainScope";
import { defaultContainerContentsPersistence } from "../../../workflows/container-contents/containerPersistence";
import {
  type DocumentsPersistence,
  defaultDocumentsPersistence,
  listPendingDocumentUpdates,
} from "../../../workflows/documents";
import type { DocumentAttachmentUpload, DocumentsRuntime } from "../types";
import { noopDocumentStorePersistenceEffects } from "./documentStore.testFixtures";
import { ensureDocumentStoreReady } from "./initialization";
import { createDocumentStoreState, type DocumentStoreState } from "./state";

export const PDF_FIELDS = {
  byteLength: "3",
  fileName: "report.pdf",
  mimeType: "application/pdf",
};

export const PDF_UPLOAD: DocumentAttachmentUpload = {
  bytes: new TextEncoder().encode("pdf"),
  mimeType: "application/pdf",
  name: "report.pdf",
};

// Offline, so no sync pass can materialize the deferred birth on its own; a
// key pair stand-in makes `canAttachFiles` true unless the test drops it.
function offlineAttachRuntime(input: {
  blobStore: BlobStore;
  canAttach: boolean;
  execSql: DocumentsRuntime["infra"]["execSql"];
}): DocumentsRuntime {
  return {
    apiClient: {} as DocumentsRuntime["apiClient"],
    auth: { isAuthenticated: false, organizationId: null, userId: null },
    crypto: {
      encapsulationKeyPair: input.canAttach ? {} : null,
      signingFingerprint: null,
      signingKeyPair: null,
    },
    infra: {
      blobStore: input.blobStore,
      dbStatus: "ready",
      documentProjectors: defaultDocumentProjectorRegistry,
      execSql: input.execSql,
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

/** The document tables plus `containers`, which the write-queue probe joins. */
export async function ensureDeferredBirthSchema(
  execSql: DocumentsRuntime["infra"]["execSql"],
): Promise<void> {
  await defaultDocumentsPersistence.ensureSchema(execSql);
  await defaultContainerContentsPersistence.ensureSchema(execSql);
}

/** Opens (creating on first use) a PDF store the way the Explorer importer does. */
export async function openPdfStore(input: {
  blobStore: BlobStore;
  canAttach?: boolean;
  deferInitialUpdate: boolean;
  execSql: DocumentsRuntime["infra"]["execSql"];
  localId: string;
  persistence?: DocumentsPersistence;
}): Promise<DocumentStoreState> {
  const state = createDocumentStoreState(
    input.localId,
    offlineAttachRuntime({
      blobStore: input.blobStore,
      canAttach: input.canAttach ?? true,
      execSql: input.execSql,
    }),
    input.persistence ?? defaultDocumentsPersistence,
    noopDocumentStorePersistenceEffects,
    null,
    "",
    "pdf",
  );
  if (input.deferInitialUpdate) state.deferInitialUpdate = true;
  if (!(await ensureDocumentStoreReady(state, () => undefined))) {
    throw new Error("Expected the PDF test store to initialize");
  }
  return state;
}

/** Decodes every queued update into a fresh peer, as a reader would. */
export async function readQueuedUpdates(state: DocumentStoreState): Promise<{
  attachmentNames: string[];
  documentKind: string;
  rowCount: number;
  structuredFields: Record<string, unknown>;
}> {
  const rows = await listPendingDocumentUpdates({
    execSql: state.runtime.infra.execSql,
    localId: state.localId,
    persistence: state.persistence,
  });
  const reader = await createDocument("reader");
  importUpdates(
    reader,
    rows.map((row) => base64ToBytes(row.updateData)),
  );
  const decoded = readStoredDocumentState(reader);
  return {
    attachmentNames: getDocumentAttachments(reader).map(
      (attachment) => attachment.name,
    ),
    documentKind: decoded.documentKind,
    rowCount: rows.length,
    structuredFields: decoded.structuredFields,
  };
}
