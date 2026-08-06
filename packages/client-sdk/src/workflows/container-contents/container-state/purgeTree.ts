import type { DocumentSummary } from "../../../data/documentSummary";
import type { ProjectionUserKeyResolver } from "../../../data/keyingProjectionVerification";
import { sqlDocumentContainerProjectionPersistence } from "../../../data/persistence/containers/documentContainerProjectionPersistence";
import { listDocumentsByContainerIdsOrDocumentIds } from "../../../data/persistence/documents/documentsPersistence";
import type { ContainerContentsPersistence } from "../containerPersistence";
import {
  purgeLocalContainerDocument,
  purgeRemoteContainerDocument,
  unlinkRemoteContainerDocument,
} from "../documentLinks";
import type { ContainerState } from "../remoteHydration";
import type { ContainerContentsWorkflowRuntime } from "../runtime";
import { deleteContainerState } from "./delete";
import type { PurgeProgress } from "./purgeProgress";

// The cascade hands its runtime straight to the per-document purge/unlink
// workflows. The container store's workflow runtime already satisfies every
// group they need (its apiClient is the full ApiClient, infra carries the
// resolved document projector registry), so the cascade reuses it verbatim.
type PurgeContainerTreeRuntime = ContainerContentsWorkflowRuntime;

interface PurgeContainerTreeInput {
  readonly containersById: ReadonlyMap<string, ContainerState>;
  // When true, tear down everything UNDER the root (its documents plus every
  // descendant container) but never delete the root container itself. This is
  // how "Empty Trash" reuses the same engine: the Trash bin is a protected system
  // container that must survive while its whole contents are destroyed.
  readonly keepRootContainer?: boolean;
  readonly onProgress?: ((progress: PurgeProgress) => void) | undefined;
  readonly persistence: ContainerContentsPersistence;
  readonly prepareDocumentRotationSnapshot: (
    document: DocumentSummary,
  ) => Promise<Uint8Array | null>;
  readonly resolveProjectionUserKey: ProjectionUserKeyResolver;
  readonly rootContainerId: string;
  readonly runtime: PurgeContainerTreeRuntime;
  // Checked at each unit boundary (between whole documents / whole containers),
  // never mid-remote-call, so a cancelled run stops on a consistent prefix.
  readonly signal?: AbortSignal | undefined;
}

interface PurgeContainerTreeResult {
  readonly aborted: boolean;
  readonly completedCount: number;
  readonly failedCount: number;
  readonly purgedContainerIds: readonly string[];
  readonly totalCount: number;
}

// The folder being purged plus every descendant container, in deepest-first
// order. Container deletion is leaf-only at both the store and the server, so a
// non-empty subtree must be torn down from the leaves up. A breadth-first walk
// over `containersById` yields parents before children; reversing it gives the
// leaf-first order the deletes require. Self/cyclic parent chains are guarded by
// the enqueued set.
export function collectSubtreeLeafFirst(
  containersById: ReadonlyMap<string, ContainerState>,
  rootContainerId: string,
): ContainerState[] {
  const childIdsByParentId = new Map<string, string[]>();
  for (const containerState of containersById.values()) {
    const parentId = containerState.container.parentId;
    if (parentId === null) {
      continue;
    }
    const siblings = childIdsByParentId.get(parentId) ?? [];
    siblings.push(containerState.container.id);
    childIdsByParentId.set(parentId, siblings);
  }

  const ordered: ContainerState[] = [];
  const enqueued = new Set<string>([rootContainerId]);
  // Read through the queue with a head index rather than shift(): shift() is
  // O(N) per call, which would make the whole walk O(N^2); a moving index keeps
  // each dequeue O(1).
  const queue = [rootContainerId];
  for (let head = 0; head < queue.length; head++) {
    const containerId = queue[head];
    if (containerId === undefined) {
      continue;
    }
    const containerState = containersById.get(containerId);
    if (containerState) {
      ordered.push(containerState);
    }
    for (const childId of childIdsByParentId.get(containerId) ?? []) {
      if (!enqueued.has(childId)) {
        enqueued.add(childId);
        queue.push(childId);
      }
    }
  }

  // `ordered` is parents-before-children; reverse for leaf-first deletion.
  return ordered.reverse();
}

interface SubtreeDocumentPlan {
  // Synced documents whose every link falls inside the subtree: destroy them.
  readonly purge: readonly DocumentSummary[];
  // Synced documents also linked outside the subtree: keep them, but unlink
  // from each in-subtree container so the containers can be deleted.
  readonly unlinkByDocument: ReadonlyMap<
    string,
    { document: DocumentSummary; containerIds: readonly string[] }
  >;
  // Never-synced documents (no remote id): destroy locally only.
  readonly purgeLocal: readonly DocumentSummary[];
}

type SubtreeDocumentDisposition =
  | { kind: "purge" }
  | { kind: "purge-local" }
  | { kind: "unlink"; containerIds: readonly string[] };

// The pure decision for a single document: destroy it, destroy it locally, or
// keep it and unlink it from the subtree. A never-synced document (no remote id)
// has no remote link projection, so the subtree is necessarily its only home and
// it is purged locally. A synced document linked only within the subtree is
// destroyed (its last link is here); one also linked to a folder OUTSIDE the
// subtree is preserved and only unlinked from the in-subtree containers, so its
// other folders stay intact. This mirrors the server's purge cardinality guard
// (purge requires a sole container link) while honoring multi-folder documents.
export function classifySubtreeDocument(input: {
  readonly documentId: string | null;
  readonly linkedContainerIds: readonly string[];
  readonly subtreeContainerIds: ReadonlySet<string>;
}): SubtreeDocumentDisposition {
  if (!input.documentId) {
    return { kind: "purge-local" };
  }
  const hasExternalLink = input.linkedContainerIds.some(
    (containerId) => !input.subtreeContainerIds.has(containerId),
  );
  if (!hasExternalLink) {
    return { kind: "purge" };
  }
  return {
    kind: "unlink",
    containerIds: input.linkedContainerIds.filter((containerId) =>
      input.subtreeContainerIds.has(containerId),
    ),
  };
}

async function planSubtreeDocuments(input: {
  readonly execSql: PurgeContainerTreeRuntime["infra"]["execSql"];
  readonly subtreeContainerIds: ReadonlySet<string>;
}): Promise<SubtreeDocumentPlan> {
  const documents = await listDocumentsByContainerIdsOrDocumentIds(
    input.execSql,
    {
      containerIds: [...input.subtreeContainerIds],
      documentIds: [],
    },
  );
  const remoteDocumentIds = documents.flatMap((document) =>
    document.documentId ? [document.documentId] : [],
  );
  const linkedContainerIdsByDocumentId =
    await sqlDocumentContainerProjectionPersistence.listLinkedContainerIdsByDocumentIds(
      input.execSql,
      remoteDocumentIds,
    );

  const purge: DocumentSummary[] = [];
  const purgeLocal: DocumentSummary[] = [];
  const unlinkByDocument = new Map<
    string,
    { document: DocumentSummary; containerIds: readonly string[] }
  >();
  for (const document of documents) {
    const disposition = classifySubtreeDocument({
      documentId: document.documentId ?? null,
      linkedContainerIds: document.documentId
        ? (linkedContainerIdsByDocumentId.get(document.documentId) ?? [])
        : [],
      subtreeContainerIds: input.subtreeContainerIds,
    });
    if (disposition.kind === "purge-local") {
      purgeLocal.push(document);
    } else if (disposition.kind === "purge") {
      purge.push(document);
    } else if (document.documentId) {
      unlinkByDocument.set(document.documentId, {
        document,
        containerIds: disposition.containerIds,
      });
    }
  }

  return { purge, purgeLocal, unlinkByDocument };
}

async function unlinkSubtreeDocument(input: {
  readonly containerIds: readonly string[];
  readonly document: DocumentSummary;
  readonly prepareDocumentRotationSnapshot: PurgeContainerTreeInput["prepareDocumentRotationSnapshot"];
  readonly resolveProjectionUserKey: ProjectionUserKeyResolver;
  readonly runtime: PurgeContainerTreeRuntime;
}): Promise<boolean> {
  const documentId = input.document.documentId;
  if (!documentId) {
    return true;
  }
  let rotationSnapshot: Uint8Array | null;
  try {
    rotationSnapshot = await input.prepareDocumentRotationSnapshot(
      input.document,
    );
  } catch {
    return false;
  }
  if (!rotationSnapshot) {
    return false;
  }
  for (const containerId of input.containerIds) {
    const result = await unlinkRemoteContainerDocument({
      documentId,
      noteId: input.document.id,
      resolveProjectionUserKey: input.resolveProjectionUserKey,
      rotationSnapshot,
      runtime: input.runtime,
      targetContainerId: containerId,
    });
    if (result === null) {
      return false;
    }
  }
  return true;
}

interface SubtreeTeardownResult {
  readonly aborted: boolean;
}

// Destroy every document the subtree owns, reporting one progress step per
// document. Multi-folder documents are unlinked first (so their external folders
// survive and the container delete won't trip the server's "container has linked
// documents" guard); sole-owned documents are purged; never-synced documents are
// torn down locally. Unlike the old all-or-nothing teardown, a single failed
// document no longer aborts the whole operation — it is counted as a failed step
// and skipped, so "Empty Trash" still clears every OTHER item (a failed document
// merely leaves its own container undeletable, which the container phase then
// skips). Cancellation is honored between documents, so the last completed
// document finished both its remote and local halves.
async function teardownSubtreeDocuments(input: {
  readonly plan: SubtreeDocumentPlan;
  readonly prepareDocumentRotationSnapshot: PurgeContainerTreeInput["prepareDocumentRotationSnapshot"];
  readonly reportStep: (ok: boolean) => void;
  readonly resolveProjectionUserKey: ProjectionUserKeyResolver;
  readonly runtime: PurgeContainerTreeRuntime;
  readonly signal?: AbortSignal | undefined;
}): Promise<SubtreeTeardownResult> {
  for (const {
    document,
    containerIds,
  } of input.plan.unlinkByDocument.values()) {
    if (input.signal?.aborted) {
      return { aborted: true };
    }
    const unlinked = await unlinkSubtreeDocument({
      containerIds,
      document,
      prepareDocumentRotationSnapshot: input.prepareDocumentRotationSnapshot,
      resolveProjectionUserKey: input.resolveProjectionUserKey,
      runtime: input.runtime,
    });
    input.reportStep(unlinked);
  }
  for (const document of input.plan.purge) {
    if (input.signal?.aborted) {
      return { aborted: true };
    }
    if (!document.documentId) {
      input.reportStep(true);
      continue;
    }
    const purged = await purgeRemoteContainerDocument({
      documentId: document.documentId,
      noteId: document.id,
      runtime: input.runtime,
    });
    input.reportStep(purged !== null);
  }
  for (const document of input.plan.purgeLocal) {
    if (input.signal?.aborted) {
      return { aborted: true };
    }
    const purged = await purgeLocalContainerDocument({
      noteId: document.id,
      runtime: input.runtime,
    });
    input.reportStep(purged !== null);
  }
  return { aborted: false };
}

interface SubtreeContainerDeletionResult {
  readonly aborted: boolean;
  readonly purgedContainerIds: string[];
}

// Delete each subtree container in the given leaf-first order, returning the ids
// that were actually removed. A container that still holds surviving content — a
// document that failed to tear down, or a child that was not deleted — cannot be
// deleted leaf-only, so it is skipped and its parent is marked blocked. A blocked
// container is never even attempted (that would be a guaranteed-to-fail
// round-trip) and it blocks its own parent in turn, so an entire chain of
// ancestors above a survivor stays intact. Cancellation stops at a container
// boundary. The result is always a consistent prefix: no parent is removed before
// a surviving child.
async function deleteSubtreeContainers(input: {
  readonly persistence: PurgeContainerTreeInput["persistence"];
  readonly reportStep: (ok: boolean) => void;
  readonly runtime: PurgeContainerTreeRuntime;
  readonly signal?: AbortSignal | undefined;
  readonly subtreeStates: readonly ContainerState[];
}): Promise<SubtreeContainerDeletionResult> {
  const purgedContainerIds: string[] = [];
  const blockedParentIds = new Set<string>();
  for (const containerState of input.subtreeStates) {
    if (input.signal?.aborted) {
      return { aborted: true, purgedContainerIds };
    }
    const containerId = containerState.container.id;
    const parentId = containerState.container.parentId;
    if (blockedParentIds.has(containerId)) {
      if (parentId !== null) {
        blockedParentIds.add(parentId);
      }
      input.reportStep(false);
      continue;
    }
    const deleted = await deleteContainerState({
      containerState,
      persistence: input.persistence,
      runtime: input.runtime,
    });
    if (deleted) {
      purgedContainerIds.push(containerId);
      input.reportStep(true);
    } else {
      if (parentId !== null) {
        blockedParentIds.add(parentId);
      }
      input.reportStep(false);
    }
  }
  return { aborted: false, purgedContainerIds };
}

// Permanently destroy a folder that lives inside Trash, including everything
// under it (or, with keepRootContainer, everything under the Trash bin while
// leaving the bin in place — this is "Empty Trash"). Documents are destroyed only
// when the subtree holds their last link; multi-folder documents are unlinked
// from the subtree and preserved. Containers are deleted leaf-first so each
// delete obeys the leaf-only constraint the store and server enforce. Every step
// is remote-first then local (the per-document and per-container workflows handle
// that internally), so a cancel between steps leaves local state reflecting
// exactly the completed remote work.
//
// Progress is determinate: the plan (a pure read) completes before any
// destructive step, so onProgress reports completed/failed against a total known
// up front. A failed item is skipped rather than aborting the run, so the result
// reports whatever prefix was actually destroyed alongside completed/failed
// counts and whether a cancellation cut it short. Returns null only when the
// target container is absent from the snapshot.
export async function purgeContainerTree(
  input: PurgeContainerTreeInput,
): Promise<PurgeContainerTreeResult | null> {
  const subtreeStates = collectSubtreeLeafFirst(
    input.containersById,
    input.rootContainerId,
  );
  if (subtreeStates.length === 0) {
    return null;
  }
  const subtreeContainerIds = new Set(
    subtreeStates.map((containerState) => containerState.container.id),
  );

  const plan = await planSubtreeDocuments({
    execSql: input.runtime.infra.execSql,
    subtreeContainerIds,
  });

  // Empty Trash keeps the Trash bin itself: tear down everything it holds, but
  // exclude the root from the container deletions (deleting a system container
  // would be rejected anyway).
  const containerStatesToDelete = input.keepRootContainer
    ? subtreeStates.filter(
        (containerState) =>
          containerState.container.id !== input.rootContainerId,
      )
    : subtreeStates;

  // The total is fully known here — planning is a pure read that completes before
  // any destructive step. Unlink work is counted per document (not per container
  // link) so completed can never exceed total even when a document has several
  // in-subtree links.
  const totalCount =
    plan.unlinkByDocument.size +
    plan.purge.length +
    plan.purgeLocal.length +
    containerStatesToDelete.length;

  let completedCount = 0;
  let failedCount = 0;
  const emitProgress = () => {
    input.onProgress?.({ completedCount, failedCount, totalCount });
  };
  const reportStep = (ok: boolean) => {
    if (ok) {
      completedCount += 1;
    } else {
      failedCount += 1;
    }
    emitProgress();
  };
  // Emit the initial 0/total so a determinate bar renders immediately, before the
  // first (potentially slow) remote call.
  emitProgress();

  const teardown = await teardownSubtreeDocuments({
    plan,
    prepareDocumentRotationSnapshot: input.prepareDocumentRotationSnapshot,
    reportStep,
    resolveProjectionUserKey: input.resolveProjectionUserKey,
    runtime: input.runtime,
    signal: input.signal,
  });

  let purgedContainerIds: readonly string[] = [];
  let aborted = teardown.aborted;
  if (!teardown.aborted) {
    const deletion = await deleteSubtreeContainers({
      persistence: input.persistence,
      reportStep,
      runtime: input.runtime,
      signal: input.signal,
      subtreeStates: containerStatesToDelete,
    });
    purgedContainerIds = deletion.purgedContainerIds;
    aborted = deletion.aborted;
  }

  return {
    aborted,
    completedCount,
    failedCount,
    purgedContainerIds,
    totalCount,
  };
}
