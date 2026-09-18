import type { DocumentSummary } from "../../data/documents/documentSummary";
import { uniqueSortedStrings } from "../../data/documents/shared/readers";
import { sqlDocumentMoveIntentPersistence } from "../../data/persistence/container-contents/documentMoveIntentPersistence";
import { sqlDocumentContainerProjectionPersistence as links } from "../../data/persistence/containers/documentContainerProjectionPersistence";
import { defaultDocumentsPersistence } from "../documents";
import { relinkContainerDocumentLocally } from "./documentLocalRelink";
import type {
  DocumentStructuralMutationHost,
  DocumentStructuralMutationLocalStore,
  DocumentStructuralMutationRuntime,
  SetLinkedContainerIdsForDocument,
} from "./documentStructureTypes";

export async function addDocumentLinkLocally<TRuntime>(input: {
  currentDocumentStore: DocumentStructuralMutationLocalStore<TRuntime>;
  host: DocumentStructuralMutationHost<TRuntime>;
  note: DocumentSummary & { documentId: string; containerId: string };
  runtime: DocumentStructuralMutationRuntime;
  scheduleSync?: (() => void) | undefined;
  setLinkedContainerIdsForDocument: SetLinkedContainerIdsForDocument;
  targetContainerId: string;
}): Promise<DocumentSummary | null> {
  const { note, runtime, targetContainerId } = input;
  const persisted = await defaultDocumentsPersistence.loadDocument(
    runtime.infra.execSql,
    note.id,
  );
  if (!persisted) return null;
  const intentId = crypto.randomUUID();
  let linkedContainerIds: readonly string[] = [];
  const linkedNote = await relinkContainerDocumentLocally({
    ...input,
    accessEpoch: persisted.accessEpoch,
    requestSync: false,
    targetContainerId: note.containerId,
    commitSideEffect: async (execSql) => {
      const currentLinks = await links.listLinkedContainerIds(
        execSql,
        note.documentId,
      );
      linkedContainerIds = uniqueSortedStrings([
        ...currentLinks,
        note.containerId,
        targetContainerId,
      ]);
      await sqlDocumentMoveIntentPersistence.enqueueLinkIntent(execSql, {
        id: intentId,
        documentId: note.documentId,
        localId: note.id,
        sourceContainerId: note.containerId,
        targetContainerId,
      });
      await links.replaceDocumentLinks(
        execSql,
        note.documentId,
        linkedContainerIds,
        { moveIntentId: intentId },
      );
    },
  });
  if (!linkedNote) return null;
  input.setLinkedContainerIdsForDocument(note.documentId, linkedContainerIds);
  input.scheduleSync?.();
  runtime.util.log(
    `Container contents: queued note ${note.id} link to ${targetContainerId}`,
  );
  return linkedNote;
}

export async function removeDocumentLinkLocally<TRuntime>(
  input: Omit<
    Parameters<typeof addDocumentLinkLocally<TRuntime>>[0],
    "targetContainerId"
  > & { removedContainerId: string },
): Promise<DocumentSummary | null> {
  const { note, runtime, removedContainerId } = input;
  const execSql = runtime.infra.execSql;
  const persisted = await defaultDocumentsPersistence.loadDocument(
    execSql,
    note.id,
  );
  if (!persisted) return null;
  const currentLinks = await links.listLinkedContainerIds(
    execSql,
    note.documentId,
  );
  const remaining = currentLinks.filter((id) => id !== removedContainerId);
  const nextContainerId = remaining.includes(note.containerId)
    ? note.containerId
    : remaining[0];
  if (!nextContainerId || !currentLinks.includes(removedContainerId))
    return null;
  const intentId = crypto.randomUUID();
  let linkedContainerIds: readonly string[] = [];
  const unlinkedNote = await relinkContainerDocumentLocally({
    ...input,
    accessEpoch: persisted.accessEpoch,
    requestSync: false,
    targetContainerId: nextContainerId,
    commitSideEffect: async (transactionExecSql) => {
      linkedContainerIds = (
        await links.listLinkedContainerIds(transactionExecSql, note.documentId)
      ).filter((id) => id !== removedContainerId);
      if (!linkedContainerIds.includes(nextContainerId))
        throw new Error("Document placement changed before unlink");
      await sqlDocumentMoveIntentPersistence.enqueueUnlinkIntent(
        transactionExecSql,
        {
          id: intentId,
          documentId: note.documentId,
          localId: note.id,
          removedContainerId,
          targetContainerId: nextContainerId,
        },
      );
      await links.replaceDocumentLinks(
        transactionExecSql,
        note.documentId,
        linkedContainerIds,
        { moveIntentId: intentId },
      );
    },
  });
  if (!unlinkedNote) return null;
  input.setLinkedContainerIdsForDocument(note.documentId, linkedContainerIds);
  input.scheduleSync?.();
  return unlinkedNote;
}
