import type { DatabaseSession } from "@tearleads/api-shared/postgres";
import { accessEvents, accessManifests } from "@tearleads/api-shared/schema";
import { and, gt, inArray } from "drizzle-orm";

const PAGE_SIZE = 256;
const MAX_CONTAINER_PATH_DEPTH = 100;
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
      if (
        seen.has(current) ||
        seen.size >= MAX_CONTAINER_PATH_DEPTH ||
        !parents.has(current)
      )
        resetRequired(eventId);
      seen.add(current);
      current = parents.get(current) ?? null;
    }
  }
}

type CitationEvent = Pick<
  typeof accessEvents.$inferSelect,
  "id" | "organizationId" | "dependencyManifestHashes" | "eventType" | "body"
>;
type CitedManifest = Pick<
  typeof accessManifests.$inferSelect,
  "manifestHash" | "objectKind" | "objectId" | "organizationId" | "state"
>;

function containerDependencies(event: CitationEvent): string[] {
  // Metadata teardown can remove document history while retaining blob events.
  // That document hash is not container ancestry and is excluded explicitly.
  const documentHash =
    event.eventType.startsWith("attachment.") &&
    event.body &&
    typeof event.body === "object"
      ? Reflect.get(event.body, "documentManifestHash")
      : undefined;
  if (
    event.eventType.startsWith("attachment.") &&
    typeof documentHash !== "string"
  ) {
    resetRequired(event.id);
  }
  return event.dependencyManifestHashes.filter((hash) => hash !== documentHash);
}

async function loadPageManifests(
  executor: DatabaseSession,
  hashes: readonly string[],
) {
  const manifests = new Map<string, CitedManifest>();
  // Batch the page's union, keeping SQL parameter counts bounded on SQLite.
  for (let offset = 0; offset < hashes.length; offset += PAGE_SIZE) {
    const rows = await executor
      .select({
        manifestHash: accessManifests.manifestHash,
        objectKind: accessManifests.objectKind,
        objectId: accessManifests.objectId,
        organizationId: accessManifests.organizationId,
        state: accessManifests.state,
      })
      .from(accessManifests)
      .where(
        inArray(
          accessManifests.manifestHash,
          hashes.slice(offset, offset + PAGE_SIZE),
        ),
      );
    for (const row of rows) manifests.set(row.manifestHash, row);
  }
  return manifests;
}

function assertEventPaths(
  event: CitationEvent,
  dependencies: readonly string[],
  manifests: ReadonlyMap<string, CitedManifest>,
): void {
  const rows = dependencies.map((hash) => {
    const row = manifests.get(hash);
    if (!row) resetRequired(event.id);
    return row;
  });
  const parents = new Map<string, string | null>();
  collectParents(parents, rows, event);
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
        eventType: accessEvents.eventType,
        body: accessEvents.body,
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
    const events = rows.map((event) => ({
      event,
      dependencies: containerDependencies(event),
    }));
    const manifests = await loadPageManifests(executor, [
      ...new Set(events.flatMap(({ dependencies }) => dependencies)),
    ]);
    for (const { event, dependencies } of events)
      assertEventPaths(event, dependencies, manifests);
    const last = rows.at(-1);
    if (!last || rows.length < PAGE_SIZE) return;
    lastId = last.id;
  }
}
