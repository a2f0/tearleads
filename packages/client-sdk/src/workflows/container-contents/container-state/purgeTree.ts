import type { DocumentSummary } from "../../../data/documentSummary";
import type { ProjectionUserKeyResolver } from "../../../data/keyingProjectionVerification";
import { sqlDocumentContainerProjectionPersistence } from "../../../data/persistence/containers/documentContainerProjectionPersistence";
import { listDocumentsByContainerIds } from "../../../data/persistence/documents/documentsPersistence";
import type { ContainerContentsPersistence } from "../containerPersistence";
import {
  purgeLocalContainerDocument,
  purgeRemoteContainerDocument,
  unlinkRemoteContainerDocument,
} from "../documentLinks";
import type { ContainerState } from "../remoteHydration";
import type { ContainerContentsWorkflowRuntime } from "../runtime";
import { deleteContainerState } from "./delete";

// The cascade hands its runtime straight to the per-document purge/unlink
// workflows. The container store's workflow runtime already satisfies every
// group they need (its apiClient is the full ApiClient, infra carries the
// resolved document projector registry), so the cascade reuses it verbatim.
type PurgeContainerTreeRuntime = ContainerContentsWorkflowRuntime;

interface PurgeContainerTreeInput {
  readonly containersById: ReadonlyMap<string, ContainerState>;
  readonly persistence: ContainerContentsPersistence;
  readonly resolveProjectionUserKey: ProjectionUserKeyResolver;
  readonly rootContainerId: string;
  readonly runtime: PurgeContainerTreeRuntime;
}

interface PurgeContainerTreeResult {
  readonly purgedContainerIds: readonly string[];
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
  const documents = await listDocumentsByContainerIds(input.execSql, [
    ...input.subtreeContainerIds,
  ]);
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
  readonly resolveProjectionUserKey: ProjectionUserKeyResolver;
  readonly runtime: PurgeContainerTreeRuntime;
}): Promise<boolean> {
  const documentId = input.document.documentId;
  if (!documentId) {
    return true;
  }
  for (const containerId of input.containerIds) {
    const result = await unlinkRemoteContainerDocument({
      documentId,
      noteId: input.document.id,
      resolveProjectionUserKey: input.resolveProjectionUserKey,
      runtime: input.runtime,
      targetContainerId: containerId,
    });
    if (result === null) {
      return false;
    }
  }
  return true;
}

// Destroy every document the subtree owns. Multi-folder documents are unlinked
// first (so their external folders survive and the container delete won't trip
// the server's "container has linked documents" guard); sole-owned documents are
// purged; never-synced documents are torn down locally. Returns false if any
// step fails so the caller can abort before deleting containers.
async function teardownSubtreeDocuments(input: {
  readonly plan: SubtreeDocumentPlan;
  readonly resolveProjectionUserKey: ProjectionUserKeyResolver;
  readonly runtime: PurgeContainerTreeRuntime;
}): Promise<boolean> {
  for (const {
    document,
    containerIds,
  } of input.plan.unlinkByDocument.values()) {
    const unlinked = await unlinkSubtreeDocument({
      containerIds,
      document,
      resolveProjectionUserKey: input.resolveProjectionUserKey,
      runtime: input.runtime,
    });
    if (!unlinked) {
      return false;
    }
  }
  for (const document of input.plan.purge) {
    if (!document.documentId) {
      continue;
    }
    const purged = await purgeRemoteContainerDocument({
      documentId: document.documentId,
      noteId: document.id,
      runtime: input.runtime,
    });
    if (purged === null) {
      return false;
    }
  }
  for (const document of input.plan.purgeLocal) {
    const purged = await purgeLocalContainerDocument({
      noteId: document.id,
      runtime: input.runtime,
    });
    if (purged === null) {
      return false;
    }
  }
  return true;
}

// Delete each subtree container in the given leaf-first order, returning the ids
// that were actually removed. Aborts on the first container that won't delete so
// the caller can prune exactly those snapshot entries; the leaf-first order means
// a partial result is still a consistent prefix (no parent removed before a
// surviving child).
async function deleteSubtreeContainers(input: {
  readonly persistence: PurgeContainerTreeInput["persistence"];
  readonly runtime: PurgeContainerTreeRuntime;
  readonly subtreeStates: readonly ContainerState[];
}): Promise<string[]> {
  const purgedContainerIds: string[] = [];
  for (const containerState of input.subtreeStates) {
    const deleted = await deleteContainerState({
      containerState,
      persistence: input.persistence,
      runtime: input.runtime,
    });
    if (!deleted) {
      break;
    }
    purgedContainerIds.push(containerState.container.id);
  }
  return purgedContainerIds;
}

// Permanently destroy a folder that lives inside Trash, including everything
// under it. Documents are destroyed only when the subtree holds their last
// link; multi-folder documents are unlinked from the subtree and preserved.
// Containers are deleted leaf-first so each delete obeys the leaf-only
// constraint the store and server enforce. Every step is remote-first then local
// (the per-document and per-container workflows handle that internally), so a
// remote failure aborts before the matching local row is removed and leaves a
// retryable state.
//
// Returns null when any document teardown fails — the caller leaves the subtree
// in place rather than half-deleting it. Container ids that were successfully
// deleted are reported so the store can drop their snapshot entries.
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
  const documentsTornDown = await teardownSubtreeDocuments({
    plan,
    resolveProjectionUserKey: input.resolveProjectionUserKey,
    runtime: input.runtime,
  });
  if (!documentsTornDown) {
    return null;
  }

  const purgedContainerIds = await deleteSubtreeContainers({
    persistence: input.persistence,
    runtime: input.runtime,
    subtreeStates,
  });
  return purgedContainerIds.length > 0 ? { purgedContainerIds } : null;
}
