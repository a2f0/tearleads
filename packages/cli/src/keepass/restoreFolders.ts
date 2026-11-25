import type { KeepassGroup } from "@tearleads/keepass";
import { waitForFoldersSynced } from "../folderSync";
import type { CliSession } from "../session";

const UNNAMED_GROUP = "Untitled group";

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

/** A failure after the restore folder may exist, naming it for deletion. */
export function partialRestoreError(error: unknown, folderName: string): Error {
  const reason = error instanceof Error ? error.message : String(error);
  return new Error(
    `${reason} Delete the folder "${folderName}" if it was created, then run the command again.`,
    { cause: error },
  );
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
