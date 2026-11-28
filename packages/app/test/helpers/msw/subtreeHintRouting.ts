function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function readString(value: unknown): string | null {
  return typeof value === "string" && value.length > 0 ? value : null;
}

function readStringArray(value: unknown): string[] | undefined {
  if (!Array.isArray(value)) return undefined;
  const result: string[] = [];
  for (const item of value) {
    if (typeof item === "string" && item.length > 0) result.push(item);
  }
  return result;
}

function readContainerPaths(
  value: unknown,
): Record<string, readonly string[]> | undefined {
  if (!isRecord(value)) return undefined;
  const result: Record<string, readonly string[]> = {};
  for (const [key, entry] of Object.entries(value)) {
    const path = readStringArray(entry);
    if (path) result[key] = path;
  }
  return result;
}

function hasAny(
  ids: readonly string[] | undefined,
  interest: ReadonlySet<string>,
): boolean {
  return ids?.some((id) => interest.has(id)) ?? false;
}

function coversContainerId(
  containerId: string,
  path: readonly string[] | undefined,
  interest: ReadonlySet<string>,
): boolean {
  return interest.has(containerId) || hasAny(path, interest);
}

function parentIsCovered(
  parentId: string | null | undefined,
  ancestors: readonly string[] | undefined,
  interest: ReadonlySet<string>,
): boolean {
  return (
    parentId === null ||
    (parentId !== undefined &&
      (interest.has(parentId) || hasAny(ancestors, interest)))
  );
}

function scopeDocumentEvent(
  event: Record<string, unknown>,
  interest: ReadonlySet<string>,
): Record<string, unknown> | null {
  const containerIds = readStringArray(Reflect.get(event, "containerIds"));
  if (!containerIds || containerIds.length === 0) return null;
  const containerPaths = readContainerPaths(
    Reflect.get(event, "containerPaths"),
  );
  const covered = containerIds.filter((id) =>
    coversContainerId(id, containerPaths?.[id], interest),
  );
  if (covered.length === 0) return null;
  const { containerPaths: _paths, origin: _origin, ...rest } = event;
  return { ...rest, containerIds: covered };
}

function scopeContainerMutationEvent(
  event: Record<string, unknown>,
  interest: ReadonlySet<string>,
): Record<string, unknown> | null {
  const containerId = readString(Reflect.get(event, "containerId"));
  if (!containerId) return null;
  const rawParentId = Reflect.get(event, "parentId");
  const parentId =
    rawParentId === null ? null : (readString(rawParentId) ?? undefined);
  const rawPreviousParentId = Reflect.get(event, "previousParentId");
  const previousParentId =
    rawPreviousParentId === null
      ? null
      : (readString(rawPreviousParentId) ?? undefined);
  const ancestorIds = readStringArray(Reflect.get(event, "ancestorIds"));
  const previousAncestorIds = readStringArray(
    Reflect.get(event, "previousAncestorIds"),
  );
  const containerCovered =
    interest.has(containerId) || hasAny(ancestorIds, interest);
  const parentCovered = parentIsCovered(parentId, ancestorIds, interest);
  const previousParentCovered = parentIsCovered(
    previousParentId,
    previousAncestorIds,
    interest,
  );
  if (!containerCovered) {
    const uniqueParentIds = [
      ...new Set(
        [
          typeof parentId === "string" && parentCovered ? parentId : null,
          typeof previousParentId === "string" && previousParentCovered
            ? previousParentId
            : null,
        ].filter((id): id is string => id !== null),
      ),
    ];
    return uniqueParentIds.length === 0
      ? null
      : { type: "container_children_changed", containerIds: uniqueParentIds };
  }
  const {
    ancestorIds: _ancestors,
    origin: _origin,
    parentId: _parent,
    previousAncestorIds: _prevAncestors,
    previousParentId: _prevParent,
    ...rest
  } = event;
  return {
    ...rest,
    ...(parentCovered ? { parentId } : {}),
    ...(previousParentCovered ? { previousParentId } : {}),
  };
}

function scopeContainerDeletedEvent(
  event: Record<string, unknown>,
  interest: ReadonlySet<string>,
): Record<string, unknown> | null {
  const parentId = readString(Reflect.get(event, "parentId"));
  if (!parentId) return null;
  const ancestorIds = readStringArray(Reflect.get(event, "ancestorIds"));
  return coversContainerId(parentId, ancestorIds, interest)
    ? { type: "container_children_changed", containerIds: [parentId] }
    : null;
}

/**
 * Mirror production `hintScoping.scopeHintToInterest` for MSW's test router:
 * route by subtree-root coverage (`containerPaths` / `ancestorIds` /
 * `previousAncestorIds`), strip server-only routing metadata, and scope
 * delivered payloads to what the socket covers.
 *
 * Returns `undefined` when `event` is not one of the structured subtree hint
 * types so callers can fall back to direct container-id or user-id routing.
 */
export function scopeMswSubtreeHint(
  event: Record<string, unknown>,
  interest: ReadonlySet<string>,
): Record<string, unknown> | null | undefined {
  switch (Reflect.get(event, "type")) {
    case "document_mutation_created":
    case "document_update_created":
      return scopeDocumentEvent(event, interest);
    case "container_mutation_created":
      return scopeContainerMutationEvent(event, interest);
    case "container_deleted":
      return scopeContainerDeletedEvent(event, interest);
    default:
      return undefined;
  }
}

export function isMswSubtreeHintEvent(event: Record<string, unknown>): boolean {
  const type = Reflect.get(event, "type");
  return (
    type === "document_mutation_created" ||
    type === "document_update_created" ||
    type === "container_mutation_created" ||
    type === "container_deleted"
  );
}

export function readFallbackEventContainerIds(
  event: Record<string, unknown>,
): string[] {
  const containerIds = new Set<string>();
  for (const id of readStringArray(Reflect.get(event, "containerIds")) ?? []) {
    containerIds.add(id);
  }
  for (const field of ["containerId", "parentId", "previousParentId"]) {
    const id = readString(Reflect.get(event, field));
    if (id) containerIds.add(id);
  }
  return [...containerIds];
}

export function readMswEventOrigin(
  event: Record<string, unknown>,
): { readonly sessionId: string; readonly userId: string } | null {
  const origin = Reflect.get(event, "origin");
  if (!isRecord(origin)) return null;
  const userId = readString(Reflect.get(origin, "userId"));
  const sessionId = readString(Reflect.get(origin, "sessionId"));
  return userId && sessionId ? { sessionId, userId } : null;
}

export function stripMswEventOrigin(event: Record<string, unknown>): string {
  const { origin: _origin, ...rest } = event;
  return JSON.stringify(rest);
}
