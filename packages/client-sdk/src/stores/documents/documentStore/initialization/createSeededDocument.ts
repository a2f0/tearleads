import { exportAllUpdates } from "@tearleads/loro";
import {
  DEFAULT_DOCUMENT_ACCESS_EPOCH,
  DEFAULT_DOCUMENT_KIND,
} from "../../../../data/documents/documentConstants";
import {
  addDocumentAttachments,
  type DocumentAttachment,
} from "../../../../data/documents/documentContent";
import type { StoredDocumentKind } from "../../../../data/documents/documentKinds";
import {
  initializeStoredDocumentKind,
  readStoredDocumentState,
} from "../../../../data/documents/documentKinds";
import type { DiscoveredDocumentInput } from "../../../../data/documents/documentSummary";
import { createPendingUpdateFields } from "../../../../data/documents/documentSync";
import {
  createDocumentProjectionUserKeyResolver,
  RemoteDocumentService,
  resolveDocumentCreateAuthor,
} from "../../../../workflows/documents";
import type { DocumentStoreOpenOptions, DocumentsRuntime } from "../../types";
import { createFreshPeerStoredDocument } from "../storedDocument";
import {
  assertInitialContentFitsKind,
  writeInitialDocumentContent,
} from "./initialContent";

export interface SeededDocumentInput
  extends Pick<
    DocumentStoreOpenOptions,
    "initialRows" | "initialStructuredFields"
  > {
  readonly initialAttachments?: readonly DocumentAttachment[] | undefined;
  readonly containerId: string;
  readonly documentId: string;
  readonly initialDocumentKind?: StoredDocumentKind | undefined;
  readonly initialText?: string | undefined;
}

/** One online create, without installing a local record or queuing a birth for replay. */
export async function createSeededDocument(
  runtime: DocumentsRuntime,
  input: SeededDocumentInput,
  stillCurrent: () => boolean,
): Promise<DiscoveredDocumentInput> {
  const author = resolveDocumentCreateAuthor(runtime);
  const keys = runtime.crypto.encapsulationKeyPair;
  if (!author || !keys || !runtime.state.online)
    throw new Error(
      "An online signing identity is required to seed a document.",
    );
  const doc = await createFreshPeerStoredDocument();
  const initialDocumentKind =
    input.initialDocumentKind ?? DEFAULT_DOCUMENT_KIND;
  const projectors = runtime.infra.documentProjectors;
  assertInitialContentFitsKind(input, initialDocumentKind);
  initializeStoredDocumentKind(doc, initialDocumentKind, projectors);
  if (input.initialText) doc.getText("text").update(input.initialText);
  writeInitialDocumentContent(
    { runtime, initialContent: input, initialDocumentKind },
    doc,
  );
  addDocumentAttachments(doc, input.initialAttachments ?? []);
  if (readStoredDocumentState(doc, projectors).fieldValidationIssues.length)
    throw new Error("Invalid initial document fields.");
  const update = createPendingUpdateFields(exportAllUpdates(doc));
  if (!update) throw new Error("Seeded creation requires initial content.");
  const remote = new RemoteDocumentService({
    api: runtime.apiClient,
    execSql: runtime.infra.execSql,
    encapsulationSecretKey: keys.secretKey,
    isRemoteSyncBlocked: runtime.util.isRemoteSyncBlocked,
  });
  let failure: string | undefined;
  const created = await remote.createRemoteDocument({
    stillCurrent,
    onTerminalSubmitFailure: ({ message }) => {
      failure = message;
    },
    author,
    containerId: input.containerId,
    documentId: input.documentId,
    requireSeededCreate: true,
    seedUpdate: { ...update, id: crypto.randomUUID() },
    resolveProjectionUserKey: createDocumentProjectionUserKeyResolver(runtime),
    warmReferencedPrincipalPolicies: runtime.principalPolicies.createWarmer(),
  });
  if (!stillCurrent())
    throw new Error(
      "The account or database scope changed during seeded creation.",
    );
  if (!created)
    throw new Error(
      failure ??
        "Could not commit the seeded document. Run seed again to resume.",
    );
  // This verified create acknowledgement commits exactly one initial link.
  return {
    documentId: created.documentId,
    containerId: input.containerId,
    linkedContainerIds: [input.containerId],
    accessEpoch: DEFAULT_DOCUMENT_ACCESS_EPOCH,
    accessStateHash: created.writerProjection.documentManifest.manifestHash,
    createdAt: new Date().toISOString(),
  };
}
