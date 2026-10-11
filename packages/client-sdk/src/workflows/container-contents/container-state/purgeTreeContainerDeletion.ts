import type { ExecSql } from "../../../data/sqlite/sqlSchema";
import type { SubtreePurgeRoot } from "../../documents/subtreePurgeScope";
import type { ContainerContentsPersistence } from "../containerPersistence";
import type { ContainerState } from "../remoteHydration";
import type { ContainerContentsWorkflowRuntime } from "../runtime";
import { deleteContainerState } from "./delete";

interface SubtreeContainerDeletionResult {
  readonly aborted: boolean;
  readonly purgedContainerIds: string[];
  readonly remoteDeletedContainerIds: string[];
}

interface DeleteSubtreeContainersInput {
  readonly allowsContainer: (containerId: string) => Promise<boolean>;
  readonly allowsLocalScopeInTransaction: (
    execSql: ExecSql,
    containerId: string,
  ) => Promise<boolean>;
  readonly persistence: ContainerContentsPersistence;
  readonly reportStep: (ok: boolean) => void;
  readonly root: SubtreePurgeRoot;
  readonly runtime: ContainerContentsWorkflowRuntime;
  readonly signal?: AbortSignal | undefined;
  readonly stillCurrent?: (() => boolean) | undefined;
  readonly subtreeStates: readonly ContainerState[];
}

// Descendants stay under the selected root. A root with a captured parent must
// retain that ancestor; parentless roots have no parent constraint to send.
function requiredDeletionAncestor(
  root: SubtreePurgeRoot,
  containerId: string,
): string {
  return containerId === root.id ? (root.parentId ?? root.id) : root.id;
}

function deletionWasCancelled(input: DeleteSubtreeContainersInput): boolean {
  return input.signal?.aborted === true || input.stillCurrent?.() === false;
}

function recordContainerDeletionOutcome(input: {
  containerState: ContainerState;
  deleted: Awaited<ReturnType<typeof deleteContainerState>>;
  purgedContainerIds: string[];
  remoteDeletedContainerIds: string[];
}): boolean {
  if (input.deleted === "remote-deleted") {
    input.remoteDeletedContainerIds.push(input.containerState.container.id);
  }
  if (input.deleted !== "deleted") return false;
  input.purgedContainerIds.push(input.containerState.container.id);
  if (input.containerState.record.documentId) {
    input.remoteDeletedContainerIds.push(input.containerState.container.id);
  }
  return true;
}

// Delete leaf-first. A surviving document or child blocks its container and all
// ancestors; cancellation stops at a container boundary.
export async function deleteSubtreeContainers(
  input: DeleteSubtreeContainersInput,
): Promise<SubtreeContainerDeletionResult> {
  const purgedContainerIds: string[] = [];
  const remoteDeletedContainerIds: string[] = [];
  const blockedParentIds = new Set<string>();
  for (const containerState of input.subtreeStates) {
    if (deletionWasCancelled(input)) {
      return { aborted: true, purgedContainerIds, remoteDeletedContainerIds };
    }
    const containerId = containerState.container.id;
    const parentId = containerState.container.parentId;
    if (
      blockedParentIds.has(containerId) ||
      !(await input.allowsContainer(containerId))
    ) {
      if (parentId !== null) {
        blockedParentIds.add(parentId);
      }
      input.reportStep(false);
      continue;
    }
    const deleted = await deleteContainerState({
      beforeDeleteInTransaction: (execSql) =>
        input.allowsLocalScopeInTransaction(execSql, containerId),
      containerState,
      requiredAncestorId: requiredDeletionAncestor(input.root, containerId),
      persistence: input.persistence,
      runtime: input.runtime,
      stillCurrent: input.stillCurrent,
    });
    if (
      recordContainerDeletionOutcome({
        containerState,
        deleted,
        purgedContainerIds,
        remoteDeletedContainerIds,
      })
    ) {
      input.reportStep(true);
    } else {
      if (
        (deleted === "local-conflict" || deleted === "remote-deleted") &&
        deletionWasCancelled(input)
      ) {
        return {
          aborted: true,
          purgedContainerIds,
          remoteDeletedContainerIds,
        };
      }
      if (parentId !== null) {
        blockedParentIds.add(parentId);
      }
      input.reportStep(false);
    }
  }
  return { aborted: false, purgedContainerIds, remoteDeletedContainerIds };
}
