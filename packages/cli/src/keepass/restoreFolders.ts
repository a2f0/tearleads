import {
  type ContainerNode,
  getOrCreateDomainSyncCoordinator,
} from "@tearleads/client-sdk";
import type { KeepassGroup } from "@tearleads/keepass";
import type { CliSession } from "../session";

const UNNAMED_GROUP = "Untitled group";
const FOLDER_SYNC_TIMEOUT_MS = 120_000;

/** A KeePass group and the folder it was restored into. */
export interface RestoredGroup {
  readonly folderId: string;
  readonly group: KeepassGroup;
}

/** `name`, or `name (2)`, `name (3)`, ... when a sibling already has it. */
export function uniqueFolderName(
  name: string,
  siblingNames: ReadonlySet<string>,
): string {
  if (!siblingNames.has(name)) return name;
  for (let suffix = 2; ; suffix++) {
    const candidate = `${name} (${suffix})`;
    if (!siblingNames.has(candidate)) return candidate;
  }
}

async function waitForFoldersSynced(
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
  const byId = new Map(nodes().map((node) => [node.id, node]));
  const unsynced = folderIds
    .map((id) => byId.get(id))
    .find((node) => node?.syncState.status !== "synced");
  if (!idle || unsynced !== undefined || byId.size === 0) {
    throw new Error(
      `Could not finish syncing the restored folders: ${unsynced?.syncState.lastError ?? unsynced?.syncState.status ?? "timed out"}.`,
    );
  }
}

/**
 * Creates the restore folder under the account root, named `folderName`, for
 * the database's root group, then one child folder per group beneath it, and
 * waits until the API holds every one of them. Documents can only be created
 * in a folder the API already has.
 */
export async function createRestoreFolders(
  session: CliSession,
  input: {
    readonly folderName: string;
    readonly root: KeepassGroup;
    readonly rootId: string;
  },
): Promise<readonly RestoredGroup[]> {
  const tree = session.sdk.containerContents.openTree();
  const restored: RestoredGroup[] = [];
  const create = async (
    parentId: string,
    name: string,
    group: KeepassGroup,
  ): Promise<void> => {
    const node = await tree.createChild(parentId, name);
    if (!node) throw new Error("Could not create a folder for the restore.");
    restored.push({ folderId: node.id, group });
    for (const child of group.groups) {
      await create(node.id, child.name.trim() || UNNAMED_GROUP, child);
    }
  };
  await session.tracer.span("create folders", () =>
    create(input.rootId, input.folderName, input.root),
  );
  await session.tracer.span("sync folders", () =>
    waitForFoldersSynced(
      session,
      () => tree.getSnapshot().nodes,
      restored.map(({ folderId }) => folderId),
    ),
  );
  return restored;
}
