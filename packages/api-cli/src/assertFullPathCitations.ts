import type { DatabaseSession } from "@tearleads/api-shared/postgres";
import { accessEvents, accessManifests } from "@tearleads/api-shared/schema";
import { and, gt, inArray } from "drizzle-orm";

const PAGE_SIZE = 256;
const EVENT_TYPES = [
  "document.link",
  "document.unlink",
  "attachment.bind",
  "attachment.detach",
] as const;

function resetRequired(eventId: string): never {
  throw new Error(
    `Access event lacks a complete signed container path (${eventId}); destroy and reprovision the database before deploying this release`,
  );
}

function collectParents(
  parents: Map<string, string | null>,
  rows: readonly Pick<
    typeof accessManifests.$inferSelect,
    "objectKind" | "objectId" | "organizationId" | "state"
  >[],
  event: { id: string; organizationId: string },
): void {
  for (const row of rows) {
    if (row.organizationId !== event.organizationId) resetRequired(event.id);
    if (row.objectKind !== "container") continue;
    if (!row.state || typeof row.state !== "object" || Array.isArray(row.state))
      resetRequired(event.id);
    const parentId: unknown = Reflect.get(row.state, "parentContainerId");
    if (parentId !== null && typeof parentId !== "string")
      resetRequired(event.id);
    if (parents.has(row.objectId)) resetRequired(event.id);
    parents.set(row.objectId, parentId);
  }
}

function assertCompleteTree(
  parents: ReadonlyMap<string, string | null>,
  eventId: string,
): void {
  if (!parents.size) resetRequired(eventId);
  for (const id of parents.keys()) {
    const seen = new Set<string>();
    let current: string | null = id;
    while (current !== null) {
      if (seen.has(current) || seen.size >= 100 || !parents.has(current))
        resetRequired(eventId);
      seen.add(current);
      current = parents.get(current) ?? null;
    }
  }
}

async function assertEventPaths(
  executor: DatabaseSession,
  event: {
    id: string;
    organizationId: string;
    dependencyManifestHashes: string[];
  },
): Promise<void> {
  const parents = new Map<string, string | null>();
  for (
    let offset = 0;
    offset < event.dependencyManifestHashes.length;
    offset += PAGE_SIZE
  ) {
    const hashes = event.dependencyManifestHashes.slice(
      offset,
      offset + PAGE_SIZE,
    );
    const rows = await executor
      .select({
        objectKind: accessManifests.objectKind,
        objectId: accessManifests.objectId,
        organizationId: accessManifests.organizationId,
        state: accessManifests.state,
      })
      .from(accessManifests)
      .where(inArray(accessManifests.manifestHash, hashes));
    if (rows.length !== hashes.length) resetRequired(event.id);
    collectParents(parents, rows, event);
  }
  assertCompleteTree(parents, event.id);
}

/**
 * Structural flag-day detection, not signature verification or translation.
 * Stop outgoing API writers first. Remove after all databases (including
 * retained event history) have been reprovisioned for #2169.
 */
export async function assertFullPathCitations(
  executor: DatabaseSession,
): Promise<void> {
  let lastId: string | undefined;
  for (;;) {
    const rows = await executor
      .select({
        id: accessEvents.id,
        organizationId: accessEvents.organizationId,
        dependencyManifestHashes: accessEvents.dependencyManifestHashes,
      })
      .from(accessEvents)
      .where(
        and(
          inArray(accessEvents.eventType, [...EVENT_TYPES]),
          lastId === undefined ? undefined : gt(accessEvents.id, lastId),
        ),
      )
      .orderBy(accessEvents.id)
      .limit(PAGE_SIZE);
    for (const row of rows) await assertEventPaths(executor, row);
    const last = rows.at(-1);
    if (!last || rows.length < PAGE_SIZE) return;
    lastId = last.id;
  }
}
