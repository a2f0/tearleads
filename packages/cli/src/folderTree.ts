import {
  type ContainerNode,
  getOrCreateDomainSyncCoordinator,
} from "@tearleads/client-sdk";
import { printable } from "./printable";
import type { CliSession } from "./session";

const POLL_INTERVAL_MS = 25;

async function until(
  check: () => boolean,
  label: string,
  timeoutMs: number,
): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (!check()) {
    if (Date.now() > deadline) {
      throw new Error(`Timed out waiting for ${label}.`);
    }
    await Bun.sleep(POLL_INTERVAL_MS);
  }
}

async function assertNoFailedFolderPulls(session: CliSession): Promise<void> {
  const pending = await session.sdk.containerContents
    .documentQueries()
    .listPendingDownloads();
  const failed = pending.filter(
    (item) => item.objectKind === "container" && item.lastError !== null,
  );
  if (failed.length > 0) {
    throw new Error(
      `Could not load ${failed.length} folder(s) from the API: ${failed[0]?.lastError}`,
    );
  }
}

/**
 * Pulls the signed-in organization's folders from the API into this run's
 * empty database and waits, within `timeoutMs`, until every sync lane is idle.
 * Fails rather than return a partial tree when any request failed.
 */
export async function loadFolderTree(
  session: CliSession,
  timeoutMs = 60_000,
): Promise<readonly ContainerNode[]> {
  const { sdk } = session;
  const store = sdk.containerContents.openTree();
  store.updateRuntime(sdk.containerContents.workflowRuntime());
  await until(() => store.getSnapshot().ready, "the folder tree", timeoutMs);
  if (!(await store.refresh())) {
    throw new Error("Could not load folders from the API.");
  }
  // `refresh` resolves once the listing is applied; folder metadata and
  // deeper lanes keep pulling on the sync coordinator.
  const coordinator = getOrCreateDomainSyncCoordinator(
    sdk.runtime.input().state.domainScope,
  );
  if (!(await coordinator.waitForIdle({ timeoutMs }))) {
    throw new Error("Timed out waiting for folders to finish loading.");
  }
  session.assertNoFailures();
  await assertNoFailedFolderPulls(session);
  return store.getSnapshot().nodes;
}

function compareNames(left: ContainerNode, right: ContainerNode): number {
  if (left.name === right.name) return 0;
  return left.name < right.name ? -1 : 1;
}

function folderLabel(node: ContainerNode): string {
  const name = node.metadataReady === false ? "(name not synced)" : node.name;
  const slot = node.systemSlot ? " [system]" : "";
  return printable(`${name || "(unnamed)"}${slot}  ${node.id}`);
}

/** Renders one organization's folders as an indented tree, by name. */
export function formatFolderTree(
  nodes: readonly ContainerNode[],
  organizationId: string,
): string[] {
  const inOrganization = nodes.filter(
    (node) => node.organizationId === organizationId,
  );
  const ids = new Set(inOrganization.map((node) => node.id));
  const children = new Map<string | null, ContainerNode[]>();
  for (const node of inOrganization) {
    // A folder whose parent this user cannot see is listed at the top level.
    const parentId =
      node.parentId !== null && ids.has(node.parentId) ? node.parentId : null;
    children.set(parentId, [...(children.get(parentId) ?? []), node]);
  }

  const lines: string[] = [];
  const visit = (parentId: string | null, depth: number) => {
    for (const node of [...(children.get(parentId) ?? [])].sort(compareNames)) {
      lines.push(`${"  ".repeat(depth)}${folderLabel(node)}`);
      visit(node.id, depth + 1);
    }
  };
  visit(null, 0);
  return lines;
}
