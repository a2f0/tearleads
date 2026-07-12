interface ContainerMutationEventCandidate {
  readonly containerId?: unknown;
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
  parentId: string | null;
  previousParentId: string | null | undefined;
}): boolean {
  return (
    input.parentId === null ||
    input.previousParentId === null ||
    input.eventType !== "container.create"
  );
}

export function listContainerParentIdsForEventHydration(
  events: ReadonlyArray<unknown>,
): Array<string | null> {
  const parentIds = new Map<string, string | null>();

  for (const event of events) {
    if (!isRecord(event) || event.type !== "container_mutation_created") {
      continue;
    }

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
    const parentId = readNullableString(event.parentId);
    if (!containerId || !eventType || parentId === undefined) {
      continue;
    }

    const previousParentId = readNullableString(event.previousParentId);
    if (shouldHydrateRootLane({ eventType, parentId, previousParentId })) {
      addHydrationParentId(parentIds, null);
    }
    addHydrationParentId(parentIds, parentId);
    addHydrationParentId(parentIds, containerId);

    if (previousParentId !== undefined) {
      addHydrationParentId(parentIds, previousParentId);
    }
  }

  return Array.from(parentIds.values());
}
