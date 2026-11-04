import {
  type ContainerNode,
  getOrCreateDomainSyncCoordinator,
  type OrganizationMembership,
} from "@tearleads/client-sdk";
import { printable } from "./printable";
import { traceSyncLanes } from "./sdkTracing";
import type { CliSession } from "./session";

const POLL_INTERVAL_MS = 25;

export interface LoadedFolderTree {
  readonly memberships: readonly OrganizationMembership[];
  readonly nodes: readonly ContainerNode[];
}

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

async function beforeDeadline<T>(
  work: Promise<T>,
  deadline: number,
  label: string,
): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const expired = new Promise<never>((_, reject) => {
    timer = setTimeout(
      () => reject(new Error(`Timed out waiting for ${label}.`)),
      Math.max(0, deadline - Date.now()),
    );
  });
  try {
    return await Promise.race([work, expired]);
  } finally {
    clearTimeout(timer);
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
 * empty database and waits, within `timeoutMs` overall, until every sync lane
 * is idle. Fails rather than return a partial tree when any request failed.
 */
function selectOrganization(
  session: CliSession,
  memberships: readonly OrganizationMembership[],
  organizationId: string,
): void {
  const membership = memberships.find(
    (candidate) => candidate.organizationId === organizationId,
  );
  if (!membership) {
    throw new Error(`You are not a member of organization ${organizationId}.`);
  }
  // The SDK exempts the active organization from sync pauses, so switching to
  // a paused one would download what the user paused.
  if (membership.syncPaused) {
    throw new Error(
      `Sync of organization ${organizationId} is paused for your devices; resume it in the app to list it here.`,
    );
  }
  session.sdk.session.setOrganizationId(organizationId);
}

export async function loadFolderTree(
  session: CliSession,
  options: {
    /** Makes this organization active after checking it is not paused. */
    readonly organizationId?: string | undefined;
    readonly timeoutMs?: number;
  } = {},
): Promise<LoadedFolderTree> {
  const timeoutMs = options.timeoutMs ?? 60_000;
  const { sdk, tracer } = session;
  const deadline = Date.now() + timeoutMs;
  // Apply the user's per-organization sync pauses before anything pulls, so a
  // paused organization's content is not downloaded.
  const memberships = await tracer.span("read memberships", () =>
    beforeDeadline(
      sdk.organizations.memberships.refresh(),
      deadline,
      "organization memberships",
    ),
  );
  if (!memberships) {
    throw new Error("Could not read organization memberships from the API.");
  }
  if (options.organizationId) {
    selectOrganization(session, memberships, options.organizationId);
  }
  // Trace the lanes of the scope the pulls run in, after any switch.
  const stopSyncTrace = traceSyncLanes(sdk, tracer);
  try {
    const nodes = await pullFolders(session, deadline);
    tracer.event(`folder tree holds ${nodes.length} folder(s)`);
    return { memberships, nodes };
  } finally {
    stopSyncTrace();
  }
}

async function pullFolders(
  session: CliSession,
  deadline: number,
): Promise<readonly ContainerNode[]> {
  const { sdk, tracer } = session;
  const store = sdk.containerContents.openTree();
  store.updateRuntime(sdk.containerContents.workflowRuntime());
  await tracer.span("open local folder tree", () =>
    until(
      () => store.getSnapshot().ready,
      "the folder tree",
      deadline - Date.now(),
    ),
  );
  const listed = await tracer.span("list folders", () =>
    beforeDeadline(store.refresh(), deadline, "folders"),
  );
  if (!listed) {
    throw new Error("Could not load folders from the API.");
  }
  // `refresh` resolves once the listing is applied; folder metadata and
  // deeper lanes keep pulling on the sync coordinator.
  const coordinator = getOrCreateDomainSyncCoordinator(
    sdk.runtime.input().state.domainScope,
  );
  const idle = await tracer.span("pull folder metadata (sync idle)", () =>
    coordinator.waitForIdle({ timeoutMs: Math.max(0, deadline - Date.now()) }),
  );
  if (!idle) {
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
