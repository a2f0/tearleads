import type { DocumentSummary } from "../../data/documentSummary";
import { DEFAULT_DOCUMENT_ACCESS_EPOCH } from "../../data/documents/documentConstants";
import { sqlDocumentMoveIntentPersistence } from "../../data/persistence/container-contents/documentMoveIntentPersistence";
import { defaultDocumentsPersistence } from "../documents";
import {
  listDocumentLinkedContainerIds,
  replaceDocumentLinks,
} from "./documentLinks";
import { relinkContainerDocumentLocally } from "./documentLocalRelink";
import type {
  DocumentStructuralMutationHost,
  DocumentStructuralMutationLocalStore,
  DocumentStructuralMutationRuntime,
  SetLinkedContainerIdsForDocument,
} from "./documentStructureTypes";

function uniqueSortedStrings(values: ReadonlyArray<string>): string[] {
  return Array.from(new Set(values)).sort();
}

async function resolveOptimisticDocumentMoveLinks(input: {
  currentContainerId: string | null;
  documentId: string;
  replaceLinkedContainers?: boolean | undefined;
  runtime: DocumentStructuralMutationRuntime;
  targetContainerId: string;
}): Promise<string[]> {
  if (input.replaceLinkedContainers) {
    return [input.targetContainerId];
  }

  const currentLinkedContainerIds = await listDocumentLinkedContainerIds(
    input.runtime.infra.execSql,
    input.documentId,
  );
  const linkedContainerIds =
    currentLinkedContainerIds.length > 0
      ? currentLinkedContainerIds
      : input.currentContainerId
        ? [input.currentContainerId]
        : [];

  return uniqueSortedStrings([
    ...linkedContainerIds.filter(
      (containerId) => containerId !== input.currentContainerId,
    ),
    input.targetContainerId,
  ]);
}

async function resolveLocalMoveAccessEpoch(input: {
  localId: string;
  runtime: DocumentStructuralMutationRuntime;
}): Promise<number> {
  const existingDocument = await defaultDocumentsPersistence.loadDocument(
    input.runtime.infra.execSql,
    input.localId,
  );
  // The local relink must keep the document's current key epoch. Falling back
  // is only for partially seeded local state; downgrading synced documents
  // would make offline edits use stale access material.
  return existingDocument?.accessEpoch ?? DEFAULT_DOCUMENT_ACCESS_EPOCH;
}

export async function moveRemoteDocumentLinkLocally<TRuntime>(params: {
  currentDocumentStore: DocumentStructuralMutationLocalStore<TRuntime>;
  expandNode: (nodeId: string) => void;
  host: DocumentStructuralMutationHost<TRuntime>;
  note: DocumentSummary & { documentId: string };
  replaceLinkedContainers?: boolean | undefined;
  runtime: DocumentStructuralMutationRuntime;
  scheduleSync?: (() => void) | undefined;
  setLinkedContainerIdsForDocument: SetLinkedContainerIdsForDocument;
  targetContainerId: string;
}): Promise<{ linksChanged: boolean; note: DocumentSummary | null }> {
  const {
    currentDocumentStore,
    expandNode,
    host,
    note,
    replaceLinkedContainers,
    runtime,
    scheduleSync,
    setLinkedContainerIdsForDocument,
    targetContainerId,
  } = params;
  const linkedContainerIds = await resolveOptimisticDocumentMoveLinks({
    currentContainerId: note.containerId,
    documentId: note.documentId,
    replaceLinkedContainers,
    runtime,
    targetContainerId,
  });

  // Apply the user's chosen placement locally now, then replay the signed
  // link-set mutation from this durable intent when auth/network/key context is
  // back. This mirrors container move intents: UI state should not wait on the
  // server, but the remote contract still converges through the normal writer
  // projection path.
  await sqlDocumentMoveIntentPersistence.enqueueMoveIntent(
    runtime.infra.execSql,
    {
      documentId: note.documentId,
      localId: note.id,
      replaceLinkedContainers,
      sourceContainerId: note.containerId,
      targetContainerId,
    },
  );

  const movedNote = await relinkContainerDocumentLocally({
    accessEpoch: await resolveLocalMoveAccessEpoch({
      localId: note.id,
      runtime,
    }),
    currentDocumentStore,
    host,
    note,
    requestSync: false,
    runtime,
    targetContainerId,
  });
  if (!movedNote) {
    return { linksChanged: false, note: null };
  }

  await replaceDocumentLinks(
    runtime.infra.execSql,
    note.documentId,
    linkedContainerIds,
  );
  setLinkedContainerIdsForDocument(note.documentId, linkedContainerIds);
  expandNode(targetContainerId);
  scheduleSync?.();
  runtime.util.log(
    `Container contents: queued note ${movedNote.id} move to ${targetContainerId}`,
  );
  return { linksChanged: true, note: movedNote };
}
