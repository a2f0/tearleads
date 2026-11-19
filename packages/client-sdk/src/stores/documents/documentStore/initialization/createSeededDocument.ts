import { exportAllUpdates } from "@tearleads/loro";
import {
  DEFAULT_DOCUMENT_ACCESS_EPOCH,
  DEFAULT_DOCUMENT_KIND,
} from "../../../../data/documents/documentConstants";
import {
  addDocumentAttachments,
  type DocumentAttachment,
  getDocumentAttachments,
  sameDocumentAttachments,
} from "../../../../data/documents/documentContent";
import type { StoredDocumentKind } from "../../../../data/documents/documentKinds";
import {
  initializeStoredDocumentKind,
  readStoredDocumentState,
} from "../../../../data/documents/documentKinds";
import { listDocumentRows } from "../../../../data/documents/documentRowList";
import type { DiscoveredDocumentInput } from "../../../../data/documents/documentSummary";
import { createPendingUpdateFields } from "../../../../data/documents/documentSync";
import {
  createDocumentProjectionUserKeyResolver,
  RemoteDocumentService,
  resolveDocumentCreateAuthor,
} from "../../../../workflows/documents";
import {
  createVerifiedRemoteDocumentDeletionHandler,
  hasVerifiedDocumentPurge,
  pinAbsentDocumentPurge,
} from "../../../../workflows/documents/purge";
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
  readonly onRecoveredStaleTarget?: (() => void) | undefined;
  readonly containerId: string;
  readonly documentId: string;
  readonly initialDocumentKind?: StoredDocumentKind | undefined;
  readonly initialText?: string | undefined;
}

async function createSeedUpdate(
  runtime: DocumentsRuntime,
  input: SeededDocumentInput,
) {
  const doc = await createFreshPeerStoredDocument();
  const initialDocumentKind =
    input.initialDocumentKind ?? DEFAULT_DOCUMENT_KIND;
  const projectors = runtime.infra.documentProjectors;
  assertInitialContentFitsKind(input, initialDocumentKind);
  if (
    initialDocumentKind === DEFAULT_DOCUMENT_KIND &&
    input.initialRows?.length
  )
    throw new Error("A seeded note cannot contain rows.");
  initializeStoredDocumentKind(doc, initialDocumentKind, projectors);
  if (input.initialText) doc.getText("text").update(input.initialText);
  writeInitialDocumentContent(
    { runtime, initialContent: input, initialDocumentKind },
    doc,
  );
  const attachments = input.initialAttachments ?? [];
  addDocumentAttachments(doc, attachments);
  if (
    !sameDocumentAttachments(attachments, getDocumentAttachments(doc)) ||
    attachments.some(
      (item) => !item.slotId.length || !Number.isSafeInteger(item.byteLength),
    )
  )
    throw new Error("Invalid or duplicate initial attachment metadata.");
  if (input.initialRows?.length) {
    const rows = listDocumentRows(doc);
    if (
      input.initialRows.some((row, index) =>
        Object.entries(row).some(
          ([key, value]) => rows[index]?.fields[key] !== value,
        ),
      )
    )
      throw new Error("Invalid initial document row fields.");
  }
  const projected = readStoredDocumentState(doc, projectors);
  const fields = Object.entries(input.initialStructuredFields ?? {});
  if (
    projected.fieldValidationIssues.length ||
    fields.some(
      ([key, value]) =>
        value !== undefined && projected.structuredFields[key] !== value,
    )
  )
    throw new Error("Invalid initial document fields.");
  const update = createPendingUpdateFields(exportAllUpdates(doc));
  if (!update) throw new Error("Seeded creation requires initial content.");
  return update;
}

/** One online create, without installing a local record or queuing a birth for replay. */
export async function createSeededDocument(
  runtime: DocumentsRuntime,
  input: SeededDocumentInput,
  stillCurrent: () => boolean,
): Promise<DiscoveredDocumentInput | "purged"> {
  const author = resolveDocumentCreateAuthor(runtime);
  const keys = runtime.crypto.encapsulationKeyPair;
  if (!author || !keys || !runtime.state.online)
    throw new Error(
      "An online signing identity is required to seed a document.",
    );
  const purged = await hasVerifiedDocumentPurge(
    runtime.infra.execSql,
    input.documentId,
    author.organizationId,
  );
  if (!stillCurrent())
    throw new Error(
      "The account or database scope changed during seeded creation.",
    );
  if (purged) return "purged";
  const update = await createSeedUpdate(runtime, input);
  const remote = new RemoteDocumentService({
    api: runtime.apiClient,
    execSql: runtime.infra.execSql,
    encapsulationSecretKey: keys.secretKey,
    isRemoteSyncBlocked: runtime.util.isRemoteSyncBlocked,
  });
  let failure: { message: string; status: number | null } | undefined;
  const verification = {
    resolveProjectionUserKey: createDocumentProjectionUserKeyResolver(runtime),
    warmReferencedPrincipalPolicies: runtime.principalPolicies.createWarmer(),
    stillCurrent,
  };
  const created = await remote.createRemoteDocument({
    ...verification,
    onTerminalSubmitFailure: (result) => {
      failure = result;
    },
    author,
    containerId: input.containerId,
    documentId: input.documentId,
    expectedOrganizationId: author.organizationId,
    requireSeededCreate: true,
    onRecoveredStaleTarget: input.onRecoveredStaleTarget,
    seedUpdate: { ...update, id: crypto.randomUUID() },
  });
  if (!stillCurrent())
    throw new Error(
      "The account or database scope changed during seeded creation.",
    );
  if (
    !created &&
    failure?.status === 409 &&
    failure.message.endsWith("Document was permanently purged")
  ) {
    // A refusal only prompts a read. The signed proof establishes the deletion.
    await createVerifiedRemoteDocumentDeletionHandler({
      ...verification,
      apiClient: runtime.apiClient,
      execSql: runtime.infra.execSql,
      expectedOrganizationId: author.organizationId,
      onVerifiedDeletion: ({ commitPurgeProof, documentId }) =>
        pinAbsentDocumentPurge(
          runtime.infra.execSql,
          documentId,
          commitPurgeProof,
        ),
    })({ documentId: input.documentId });
    if (!stillCurrent())
      throw new Error(
        "The account or database scope changed during purge verification.",
      );
    return "purged";
  }
  if (!created)
    throw new Error(
      failure?.message ??
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
