import {
  type ContinuityFolder,
  captureContinuityScope,
  openReadyContainerTree,
} from "app/continuity";
import { waitForFoldersSynced } from "./folderSync";
import { loadFolderTree } from "./folderTree";
import { uniqueFolderName } from "./keepass/restoreFolders";
import { type SeedRun, seedDocumentIds } from "./seedDocument";

/** The folder the seed writes a dataset folder's notes into and shares. */
export interface SeedFolderTarget {
  readonly id: string;
  /** Made by this run, so removable while it holds nothing. */
  readonly created: boolean;
}

/**
 * Whether a root folder carries a name the seed gives this dataset folder:
 * the name itself, or the name numbered past a folder of the user's own.
 */
export function isSeedFolderName(name: string, datasetName: string): boolean {
  if (name === datasetName) return true;
  const prefix = `${datasetName} (`;
  if (!name.startsWith(prefix) || !name.endsWith(")")) return false;
  const suffix = name.slice(prefix.length, -1);
  return /^[1-9]\d*$/u.test(suffix) && Number(suffix) >= 2;
}

/** The server's placement of each note the dataset folder seeds. */
async function notePlacements(run: SeedRun, folder: ContinuityFolder) {
  const { session } = run;
  const linked = new Set<string>();
  let missing = 0;
  for (const { document } of folder.notes) {
    const { documentId } = await seedDocumentIds(run, document.key);
    const head = await run.lookup(documentId, undefined, session.userId);
    if (head === "not-found") {
      session.recordExpectedSeedFailure("missing head");
      missing += 1;
      continue;
    }
    if (!head) throw new Error(`Could not find the seeded ${document.key}.`);
    for (const id of head.linkedContainerIds) linked.add(id);
  }
  return { linked, missing };
}

/**
 * The seed's folder for this dataset folder: the root folder of a seed name
 * that holds one of its notes, as the server links them. When none does and
 * a note is still to be written, a new folder is made, numbered past any
 * folder of the user's own, so a user's folder is never written to or
 * shared. Null when every note already exists outside such a folder: the
 * user moved it, and where it is stays private to them.
 */
export async function resolveSeedFolder(
  run: SeedRun,
  folder: ContinuityFolder,
): Promise<SeedFolderTarget | null> {
  const { session, rootId } = run;
  const { sdk } = session;
  const { nodes } = await loadFolderTree(session);
  const rootFolders = nodes.filter(
    (node) =>
      node.parentId === rootId &&
      node.organizationId === sdk.session.organizationId,
  );
  const { linked, missing } = await notePlacements(run, folder);
  const held = rootFolders.find(
    (node) =>
      !node.systemSlot &&
      linked.has(node.id) &&
      isSeedFolderName(node.name, folder.name),
  );
  if (held) return { id: held.id, created: false };
  if (missing === 0) return null;
  const name = uniqueFolderName(
    folder.name,
    new Set(rootFolders.map((node) => node.name)),
  );
  const tree = await openReadyContainerTree(sdk, captureContinuityScope(sdk));
  const node = await tree.createChild(rootId, name);
  if (!node) throw new Error(`Could not create the ${name} folder.`);
  await waitForFoldersSynced(session, () => tree.getSnapshot().nodes, [
    node.id,
  ]);
  return { id: node.id, created: true };
}

/**
 * Removes a folder this run made when none of its notes landed in it, as
 * when the user permanently deleted them, so a rerun does not leave another
 * empty folder behind.
 */
export async function removeEmptySeedFolder(
  run: SeedRun,
  folderId: string,
): Promise<void> {
  const { sdk } = run.session;
  const tree = await openReadyContainerTree(sdk, captureContinuityScope(sdk));
  if (!(await tree.deleteContainer(folderId)))
    throw new Error("Could not remove an empty folder the seed made.");
  run.folders.delete(folderId);
}
