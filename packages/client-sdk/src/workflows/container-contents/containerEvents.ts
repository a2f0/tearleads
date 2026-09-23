import { isContainerProjectionInvalidationHint } from "../../data/documents/documentSync";

interface ContainerMutationEventCandidate {
  readonly containerId?: unknown;
  readonly containerIds?: unknown;
  readonly eventType?: unknown;
  readonly parentId?: unknown;
  readonly previousParentId?: unknown;
  readonly type?: unknown;
}

function isRecord(value: unknown): value is ContainerMutationEventCandidate {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function readNonEmptyString(value: unknown): string | null {
  return typeof value === "string" && value.length > 0 ? value : null;
}

function readNullableString(value: unknown): string | null | undefined {
  if (value === null) {
    return null;
  }

  return readNonEmptyString(value) ?? undefined;
}

function addHydrationParentId(
  parentIds: Map<string, string | null>,
  parentId: string | null,
) {
  parentIds.set(parentId ?? "root", parentId);
}

function shouldHydrateRootLane(input: {
  eventType: string;
  parentId: string | null | undefined;
  previousParentId: string | null | undefined;
}): boolean {
  return (
    input.parentId === null ||
    input.previousParentId === null ||
    input.eventType !== "container.create"
  );
}

/**
 * Containers whose cached writer projections a batch of hints invalidates: the
 * container a `container_mutation_created` hint names, and every held
 * dependent a gateway `container_path_changed` or `resync_required` frame names.
 * Grant, rekey, and
 * recite no longer evict subscribers, so these hints are the only signal that
 * a projection's manifest head or cited ancestor path moved under a cached copy.
 */
export function listContainerProjectionInvalidationIds(
  events: ReadonlyArray<unknown>,
): string[] {
  const containerIds = new Set<string>();
  for (const event of events) {
    if (!isRecord(event) || !isContainerProjectionInvalidationHint(event))
      continue;
    if (event.type === "container_mutation_created") {
      const containerId = readNonEmptyString(event.containerId);
      if (containerId) containerIds.add(containerId);
    } else if (
      (event.type === "container_path_changed" ||
        event.type === "container_children_changed" ||
        event.type === "resync_required") &&
      Array.isArray(event.containerIds)
    ) {
      for (const containerId of event.containerIds) {
        const id = readNonEmptyString(containerId);
        if (id) containerIds.add(id);
      }
    }
  }
  return [...containerIds];
}

function addMutationHydrationLanes(
  event: ContainerMutationEventCandidate,
  parentIds: Map<string, string | null>,
): void {
  // Do NOT suppress by signer. A container mutation from any session of this
  // identity — including this client's own authoring session — must be
  // reconciled: the authoring session is already excluded server-side via the
  // event's `origin` (mirroring document mutations), and every OTHER
  // same-identity peer only learns of a new/moved container by re-listing the
  // affected parent lane here. Filtering by the identity signing fingerprint
  // dropped a sibling peer's create outright — both peers derive the same
  // signing key from the shared seed phrase — leaving new folders invisible on
  // the other peer until a manual refresh.
  const containerId = readNonEmptyString(event.containerId);
  const eventType = readNonEmptyString(event.eventType);
  if (!containerId || !eventType) {
    return;
  }

  // The server scopes each hint to the recipient's own interest: a parent or
  // previous parent this client is not subscribed to is withheld entirely
  // (undefined), while null still names the root. Hydrate only the lanes the
  // hint names; the container's own lane resolves its current parent.
  const parentId = readNullableString(event.parentId);
  const previousParentId = readNullableString(event.previousParentId);
  if (shouldHydrateRootLane({ eventType, parentId, previousParentId })) {
    addHydrationParentId(parentIds, null);
  }
  if (parentId !== undefined) {
    addHydrationParentId(parentIds, parentId);
  }
  addHydrationParentId(parentIds, containerId);

  if (previousParentId !== undefined) {
    addHydrationParentId(parentIds, previousParentId);
  }
}

export function listContainerParentIdsForEventHydration(
  events: ReadonlyArray<unknown>,
): Array<string | null> {
  const parentIds = new Map<string, string | null>();

  for (const event of events) {
    if (!isRecord(event)) continue;
    if (event.type === "container_children_changed") {
      // A known child may not yet have confirmed interest, so it receives no
      // eviction resync on a move. Refresh root as well to discover a root move.
      if (Array.isArray(event.containerIds)) {
        for (const value of event.containerIds) {
          const parentId = readNonEmptyString(value);
          if (parentId) {
            addHydrationParentId(parentIds, null);
            addHydrationParentId(parentIds, parentId);
          }
        }
      }
      continue;
    }
    if (event.type !== "container_mutation_created") continue;

    addMutationHydrationLanes(event, parentIds);
  }

  return Array.from(parentIds.values());
}
