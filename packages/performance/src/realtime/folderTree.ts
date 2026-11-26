import {
  type ContainerContentsStore,
  getOrCreateDomainSyncCoordinator,
  LEGAL_TERMS_VERSION,
  type Tearleads,
} from "@tearleads/client-sdk";
import { openLocalDatabase } from "../localDatabase";
import { createSdkHost } from "../sdkHost";

/** Folders created between waits for the SDK's queued writes to settle. */
const CREATE_BATCH = 50;
const SETTLE_TIMEOUT_MS = 120_000;

/**
 * The parent of the `index`th created folder in a breadth-first tree of
 * `fanout` children per folder, rooted at position 0 of `order` (the root).
 */
export function parentPosition(index: number, fanout: number): number {
  return Math.floor(index / fanout);
}

async function waitUntil(check: () => boolean, what: string): Promise<void> {
  const deadline = Date.now() + SETTLE_TIMEOUT_MS;
  while (!check()) {
    if (Date.now() >= deadline)
      throw new Error(`Timed out waiting for ${what}.`);
    await Bun.sleep(10);
  }
}

/**
 * One registered account whose folder tree grows through the public SDK, as
 * the app grows it: each folder is committed locally, then synced to the API
 * with its signed manifests.
 */
export async function openFolderAccount(origin: string) {
  const database = await openLocalDatabase();
  const sdk: Tearleads = createSdkHost(
    origin,
    crypto.randomUUID(),
    database.client,
  );
  let tree: ContainerContentsStore | undefined;
  const created: string[] = [];
  try {
    await sdk.identity.generate();
    // The operator running the probe agrees to the terms for its accounts.
    const account = await sdk.session.registerIdentity({
      acceptedLegalTermsVersion: LEGAL_TERMS_VERSION,
    });
    if (!account || "status" in account)
      throw new Error("Registration failed.");
    if (!(await sdk.session.login(account.challenge)))
      throw new Error("Login failed.");
    const store = sdk.containerContents.openTree();
    store.updateRuntime(sdk.containerContents.workflowRuntime());
    await waitUntil(() => store.getSnapshot().ready, "the folder tree");
    tree = store;
  } catch (error) {
    sdk.dispose();
    database.close();
    throw error;
  }
  const rootId = sdk.session.containerId;
  const userId = sdk.session.userId;
  if (!rootId || !userId) throw new Error("The session has no root folder.");
  const store = tree;

  async function settle(): Promise<void> {
    const coordinator = getOrCreateDomainSyncCoordinator(
      sdk.runtime.input().state.domainScope,
    );
    if (!(await coordinator.waitForIdle({ timeoutMs: SETTLE_TIMEOUT_MS })))
      throw new Error("Queued folder writes did not settle.");
  }

  /** Every container the local tree holds, as the app declares on connect. */
  function heldIds(): string[] {
    return store.getSnapshot().nodes.map((node) => node.id);
  }
  // The root and the system containers registration provisioned.
  const initial = [rootId, ...heldIds().filter((id) => id !== rootId)];

  return {
    userId,
    /** The initial folders, then created folders in breadth-first order. */
    declarationOrder(): string[] {
      const order = [...initial, ...created];
      const held = new Set(heldIds());
      if (held.size !== order.length || order.some((id) => !held.has(id)))
        throw new Error("The local tree does not hold the created folders.");
      return order;
    },
    /** Creates folders until the tree holds `size` containers in all. */
    async grow(
      size: number,
      fanout: number,
      progress: (held: number) => void = () => undefined,
    ): Promise<void> {
      const order = [rootId, ...created];
      while (heldIds().length < size) {
        const first = created.length;
        // A batch creates only folders whose parents already exist.
        const batch = Math.min(
          CREATE_BATCH,
          size - heldIds().length,
          order.length * fanout - first,
        );
        const folders = await Promise.all(
          Array.from({ length: batch }, (_, offset) => {
            const parentId = order[parentPosition(first + offset, fanout)];
            if (!parentId) throw new Error("Folder tree parent is missing.");
            return store.createChild(parentId, `Folder ${first + offset + 1}`);
          }),
        );
        for (const folder of folders) {
          if (!folder) throw new Error("Folder creation failed.");
          created.push(folder.id);
          order.push(folder.id);
        }
        await settle();
        progress(heldIds().length);
      }
      if (heldIds().length !== size)
        throw new Error(`The tree holds ${heldIds().length}, not ${size}.`);
    },
    close(): void {
      sdk.dispose();
      database.close();
    },
  };
}
