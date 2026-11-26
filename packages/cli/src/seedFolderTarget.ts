import { createHmac } from "node:crypto";
import {
  type ContinuityFolder,
  captureContinuityScope,
  openReadyContainerTree,
} from "app/continuity";
import { waitForFoldersSynced } from "./folderSync";
import { loadFolderTree, uniqueFolderName } from "./folderTree";
import type { SeedRun } from "./seedDocument";

/**
 * The seed's own id for a dataset folder in this account, the same in every
 * run and dataset version, shaped as the UUID v4 that folder ids use. Only
 * the holder of the signing key can derive it, so no folder of the user's
 * own carries it.
 */
export function seedFolderId(
  signingPrivateKey: Uint8Array,
  rootId: string,
  name: string,
): string {
  const bytes = createHmac("sha256", signingPrivateKey)
    .update(`tearleads.continuity/${rootId}/folder/${name}`)
    .digest()
    .subarray(0, 16);
  bytes[6] = ((bytes[6] ?? 0) & 0x0f) | 0x40;
  bytes[8] = ((bytes[8] ?? 0) & 0x3f) | 0x80;
  const hex = bytes.toString("hex");
  return [
    hex.slice(0, 8),
    hex.slice(8, 12),
    hex.slice(12, 16),
    hex.slice(16, 20),
    hex.slice(20),
  ].join("-");
}

/**
 * The seed's folder for a dataset folder: the folder with the seed's id,
 * made under the root when the account has none, and named past any folder
 * of the user's own by that name. Null when the user moved it out of the
 * root or deleted it to Trash: the seed leaves it where it is. A folder
 * emptied from Trash keeps its id on the server, so it cannot be made again.
 */
export async function resolveSeedFolder(
  run: SeedRun,
  folder: ContinuityFolder,
): Promise<string | null> {
  const { session, rootId } = run;
  const { sdk } = session;
  const id = seedFolderId(run.signingPrivateKey, rootId, folder.name);
  const { nodes } = await loadFolderTree(session);
  const existing = nodes.find((node) => node.id === id);
  if (existing) return existing.parentId === rootId ? id : null;
  const name = uniqueFolderName(
    folder.name,
    new Set(
      nodes.filter((node) => node.parentId === rootId).map((node) => node.name),
    ),
  );
  const tree = await openReadyContainerTree(sdk, captureContinuityScope(sdk));
  const node = await tree.createChild(rootId, name, { id });
  if (!node) throw new Error(`Could not create the ${name} folder.`);
  try {
    await waitForFoldersSynced(session, () => tree.getSnapshot().nodes, [id]);
  } catch (error) {
    throw new Error(
      `Could not create the ${name} folder. If you emptied the seed's ${folder.name} folder from Trash, the seed cannot make it again in this account.`,
      { cause: error },
    );
  }
  return id;
}
