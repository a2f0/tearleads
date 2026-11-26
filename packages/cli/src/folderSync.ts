import {
  type ContainerNode,
  getOrCreateDomainSyncCoordinator,
} from "@tearleads/client-sdk";
import type { CliSession } from "./session";

const FOLDER_SYNC_TIMEOUT_MS = 120_000;

/**
 * Why the new folders are not all on the API, or null when they are. A
 * folder the tree no longer lists counts as unsynced, not as done.
 */
export function unsyncedFoldersReason(
  idle: boolean,
  nodes: ReadonlyArray<Pick<ContainerNode, "id" | "syncState">>,
  folderIds: readonly string[],
): string | null {
  if (!idle) return "timed out";
  const byId = new Map(nodes.map((node) => [node.id, node.syncState]));
  const unsyncedId = folderIds.find((id) => byId.get(id)?.status !== "synced");
  if (unsyncedId === undefined) return null;
  const state = byId.get(unsyncedId);
  return state?.lastError ?? state?.status ?? "missing from the folder tree";
}

/** Waits until the API holds every one of `folderIds`. */
export async function waitForFoldersSynced(
  session: CliSession,
  nodes: () => readonly ContainerNode[],
  folderIds: readonly string[],
): Promise<void> {
  const coordinator = getOrCreateDomainSyncCoordinator(
    session.sdk.runtime.input().state.domainScope,
  );
  const idle = await coordinator.waitForIdle({
    timeoutMs: FOLDER_SYNC_TIMEOUT_MS,
  });
  session.assertNoFailures();
  const reason = unsyncedFoldersReason(idle, nodes(), folderIds);
  if (reason !== null) {
    throw new Error(`Could not finish syncing the new folders: ${reason}.`);
  }
}
