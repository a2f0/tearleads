import { DEFAULT_DOCUMENT_KIND } from "../../../data/documents/documentConstants";
import type { DocumentSummary } from "../../../data/documents/documentSummary";
import type { ProjectionUserKeyResolver } from "../../../data/keyingProjectionVerification";
import { sqlDocumentContainerProjectionPersistence } from "../../../data/persistence/containers/documentContainerProjectionPersistence";
import { listDocumentsByContainerIdsOrDocumentIds } from "../../../data/persistence/documents/documentsPersistence";
import type { ContainerContentsPersistence } from "../containerPersistence";
import { unlinkRemoteContainerDocument } from "../documentLinks";
import {
  purgeLocalContainerDocument,
  purgeRemoteContainerDocument,
} from "../documentPurge";
import type { ContainerState } from "../remoteHydration";
import type { ContainerContentsWorkflowRuntime } from "../runtime";
import { deleteContainerState } from "./delete";
import type { PurgeProgress } from "./purgeProgress";

// The store runtime satisfies the per-document purge/unlink workflows, so the
// cascade reuses it verbatim.
type PurgeContainerTreeRuntime = ContainerContentsWorkflowRuntime;

interface PurgeContainerTreeInput {
  readonly containersById: ReadonlyMap<string, ContainerState>;
  readonly documentOperations?: SubtreeDocumentOperations | undefined;
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

// Collect the target and descendants leaf-first because container deletion is
// leaf-only. The enqueued set guards self/cyclic parent chains.
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
  // Synced documents whose every link falls inside the subtree: reduce them to
  // one retained link, as required by the purge endpoint, then destroy them.
  readonly purge: readonly {
    document: DocumentSummary;
    unlinkContainerIds: readonly string[];
  }[];
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
  | { kind: "purge"; unlinkContainerIds: readonly string[] }
  | { kind: "purge-local" }
  | { kind: "unlink"; containerIds: readonly string[] };

// Destroy local-only documents locally. Destroy synced documents only when all
// links are in the subtree; preserve documents with an external link. The purge
// plan reduces owned documents to the server-required sole link first.
export function classifySubtreeDocument(input: {
  readonly documentId: string | null;
  readonly linkedContainerIds: readonly string[];
  readonly preferredContainerId?: string | null | undefined;
  readonly subtreeContainerIds: ReadonlySet<string>;
}): SubtreeDocumentDisposition {
  if (!input.documentId) {
    return { kind: "purge-local" };
  }
  const hasExternalLink = input.linkedContainerIds.some(
    (containerId) => !input.subtreeContainerIds.has(containerId),
  );
  if (!hasExternalLink) {
    const linkedContainerIds = Array.from(
      new Set(
        input.linkedContainerIds.filter((containerId) =>
          input.subtreeContainerIds.has(containerId),
        ),
      ),
    );
    const retainedContainerId =
      input.preferredContainerId &&
      linkedContainerIds.includes(input.preferredContainerId)
        ? input.preferredContainerId
        : linkedContainerIds[0];
    return {
      kind: "purge",
      unlinkContainerIds: linkedContainerIds.filter(
        (containerId) => containerId !== retainedContainerId,
      ),
    };
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

  const purge: Array<{
    document: DocumentSummary;
    unlinkContainerIds: readonly string[];
  }> = [];
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
      preferredContainerId: document.containerId,
      subtreeContainerIds: input.subtreeContainerIds,
    });
    if (disposition.kind === "purge-local") {
      purgeLocal.push(document);
    } else if (disposition.kind === "purge") {
      purge.push({
        document,
        unlinkContainerIds: disposition.unlinkContainerIds,
      });
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

interface SubtreeDocumentOperations {
  readonly purgeLocal: (document: DocumentSummary) => Promise<boolean>;
  readonly purgeRemote: (document: DocumentSummary) => Promise<boolean>;
  readonly unlink: (
    document: DocumentSummary,
    containerIds: readonly string[],
  ) => Promise<boolean>;
}

function resolveSubtreeDocumentOperations(
  input: PurgeContainerTreeInput,
): SubtreeDocumentOperations {
  return (
    input.documentOperations ?? {
      purgeLocal: async (document) =>
        (await purgeLocalContainerDocument({
          noteId: document.id,
          runtime: input.runtime,
        })) !== null,
      purgeRemote: async (document) =>
        Boolean(
          document.documentId &&
            (await purgeRemoteContainerDocument({
              documentId: document.documentId,
              documentKind: document.documentKind ?? DEFAULT_DOCUMENT_KIND,
              noteId: document.id,
              resolveProjectionUserKey: input.resolveProjectionUserKey,
              runtime: input.runtime,
            })),
        ),
      unlink: (document, containerIds) =>
        unlinkSubtreeDocument({
          containerIds,
          document,
          prepareDocumentRotationSnapshot:
            input.prepareDocumentRotationSnapshot,
          resolveProjectionUserKey: input.resolveProjectionUserKey,
          runtime: input.runtime,
        }),
    }
  );
}

interface SubtreeTeardownResult {
  readonly aborted: boolean;
}

// Tear down one whole document per progress step. A failed document is skipped,
// leaving its container undeletable while the remaining subtree work continues.
// Cancellation is honored only between complete document operations.
async function teardownSubtreeDocuments(input: {
  readonly documentOperations: SubtreeDocumentOperations;
  readonly plan: SubtreeDocumentPlan;
  readonly reportStep: (ok: boolean) => void;
  readonly signal?: AbortSignal | undefined;
}): Promise<SubtreeTeardownResult> {
  for (const {
    document,
    containerIds,
  } of input.plan.unlinkByDocument.values()) {
    if (input.signal?.aborted) {
      return { aborted: true };
    }
    const unlinked = await input.documentOperations.unlink(
      document,
      containerIds,
    );
    input.reportStep(unlinked);
  }
  for (const { document, unlinkContainerIds } of input.plan.purge) {
    if (input.signal?.aborted) {
      return { aborted: true };
    }
    if (
      unlinkContainerIds.length > 0 &&
      !(await input.documentOperations.unlink(document, unlinkContainerIds))
    ) {
      input.reportStep(false);
      continue;
    }
    input.reportStep(await input.documentOperations.purgeRemote(document));
  }
  for (const document of input.plan.purgeLocal) {
    if (input.signal?.aborted) {
      return { aborted: true };
    }
    input.reportStep(await input.documentOperations.purgeLocal(document));
  }
  return { aborted: false };
}

interface SubtreeContainerDeletionResult {
  readonly aborted: boolean;
  readonly purgedContainerIds: string[];
}

// Delete leaf-first. A surviving document or child blocks its container and all
// ancestors; cancellation stops at a container boundary.
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
    documentOperations: resolveSubtreeDocumentOperations(input),
    plan,
    reportStep,
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
