import type { WsInvalidationHint } from "@tearleads/validators/realtime";
import type { MovedContainerMemory } from "./movedContainerMemory";
import type { PublishedRealtimeEvent } from "./publishedRealtimeEvents";

export type PublishedHintEvent = Extract<
  PublishedRealtimeEvent,
  { type: WsInvalidationHint["type"] | "container_deleted" }
>;

function hasAny(
  ids: readonly string[] | undefined,
  interest: ReadonlySet<string>,
): boolean {
  return ids?.some((id) => interest.has(id)) ?? false;
}

function sameIds(
  a: readonly string[] | undefined,
  b: readonly string[] | undefined,
): boolean {
  if (a === b) return true;
  if (!a || !b || a.length !== b.length) return false;
  return a.every((value, index) => value === b[index]);
}

function coversContainerId(
  containerId: string,
  path: readonly string[] | undefined,
  interest: ReadonlySet<string>,
): boolean {
  return interest.has(containerId) || hasAny(path, interest);
}

function resolveDocumentHintPaths<
  T extends Extract<
    PublishedHintEvent,
    { type: "document_mutation_created" | "document_update_created" }
  >,
>(event: T, movedContainers: MovedContainerMemory, now: number): T {
  if (!event.containerPaths) return event;
  const containerPaths: Record<string, string[]> = {};
  for (const [containerId, path] of Object.entries(event.containerPaths)) {
    const resolved = movedContainers.resolvePath(path, now);
    containerPaths[containerId] = resolved ? [...resolved] : [...path];
  }
  return { ...event, containerPaths };
}

function resolveContainerMutationPaths(
  event: Extract<PublishedHintEvent, { type: "container_mutation_created" }>,
  movedContainers: MovedContainerMemory,
  now: number,
): PublishedHintEvent {
  if (event.ancestorIds === undefined) return event;
  const resolvedAncestors = movedContainers.resolveAncestors(
    event.containerId,
    event.ancestorIds,
    now,
  );
  if (!resolvedAncestors || sameIds(resolvedAncestors, event.ancestorIds)) {
    return event;
  }
  return {
    ...event,
    ancestorIds: [...resolvedAncestors],
    parentId: resolvedAncestors.at(-1) ?? null,
  };
}

function resolveContainerDeletedPaths(
  event: Extract<PublishedHintEvent, { type: "container_deleted" }>,
  movedContainers: MovedContainerMemory,
  now: number,
): PublishedHintEvent {
  const resolvedAncestors = movedContainers.resolveAncestors(
    event.containerId,
    event.ancestorIds,
    now,
  );
  if (!resolvedAncestors || sameIds(resolvedAncestors, event.ancestorIds)) {
    return event;
  }
  const parentId = resolvedAncestors.at(-1);
  if (!parentId) return { ...event, ancestorIds: [] };
  return { ...event, ancestorIds: [...resolvedAncestors], parentId };
}

/**
 * Rewrites any stale published paths against the hub's short-lived memory of
 * recently moved containers. Leaves events without paths untouched so they
 * continue to fail closed.
 */
export function resolveHintPaths(
  event: PublishedHintEvent,
  movedContainers: MovedContainerMemory,
  now: number,
): PublishedHintEvent {
  switch (event.type) {
    case "document_mutation_created":
    case "document_update_created":
      return resolveDocumentHintPaths(event, movedContainers, now);
    case "container_mutation_created":
      return resolveContainerMutationPaths(event, movedContainers, now);
    case "container_deleted":
      return resolveContainerDeletedPaths(event, movedContainers, now);
    case "organization_memberships_changed":
    case "shared_with_you":
    case "user_registered":
      return event;
  }
}

/**
 * Every container id whose indexed sockets may cover this hint. Sockets hold
 * subtree roots, so lookup checks the target containers and every published
 * ancestor id on their paths.
 */
export function hintContainerIds(event: PublishedHintEvent): string[] {
  switch (event.type) {
    case "document_mutation_created":
    case "document_update_created": {
      const ids = new Set<string>(event.containerIds);
      if (event.containerPaths) {
        for (const containerId of event.containerIds) {
          for (const ancestorId of event.containerPaths[containerId] ?? []) {
            ids.add(ancestorId);
          }
        }
      }
      return [...ids];
    }
    case "container_mutation_created":
      return [
        ...new Set(
          [
            event.containerId,
            ...(event.ancestorIds ?? []),
            event.parentId,
            ...(event.previousAncestorIds ?? []),
            event.previousParentId,
          ].filter((containerId): containerId is string => !!containerId),
        ),
      ];
    case "container_deleted":
      return [...new Set([event.parentId, ...event.ancestorIds])];
    case "organization_memberships_changed":
    case "shared_with_you":
    case "user_registered":
      return [];
  }
}

function parentIsCovered(
  parentId: string | null | undefined,
  ancestors: readonly string[] | undefined,
  interest: ReadonlySet<string>,
): parentId is string | null {
  // Null is the root and names no container; an id must be covered by interest.
  return (
    parentId === null ||
    (parentId !== undefined &&
      (interest.has(parentId) || hasAny(ancestors, interest)))
  );
}

/**
 * Cache key for recipient frame deduplication: two sockets that cover the same
 * logical targets of `event` receive the exact same serialized frame.
 */
export function hintCoverageKey(
  event: PublishedHintEvent,
  interest: ReadonlySet<string>,
): string {
  switch (event.type) {
    case "document_mutation_created":
    case "document_update_created":
      return event.containerIds
        .filter((id) =>
          coversContainerId(id, event.containerPaths?.[id], interest),
        )
        .join(",");
    case "container_mutation_created": {
      const ancestorCovered = hasAny(event.ancestorIds, interest);
      const containerCovered =
        interest.has(event.containerId) || ancestorCovered;
      const parentCovered = parentIsCovered(
        event.parentId,
        event.ancestorIds,
        interest,
      );
      const previousParentCovered = parentIsCovered(
        event.previousParentId,
        event.previousAncestorIds,
        interest,
      );
      return `${Number(containerCovered)}:${Number(parentCovered)}:${Number(previousParentCovered)}`;
    }
    case "container_deleted":
      return Number(
        interest.has(event.parentId) || hasAny(event.ancestorIds, interest),
      ).toString();
    case "organization_memberships_changed":
    case "shared_with_you":
    case "user_registered":
      return "";
  }
}

function scopeContainerMutationHint(
  event: Extract<PublishedHintEvent, { type: "container_mutation_created" }>,
  interest: ReadonlySet<string>,
): WsInvalidationHint | null {
  const { ancestorIds, parentId, previousAncestorIds, previousParentId } =
    event;
  const containerCovered =
    interest.has(event.containerId) || hasAny(ancestorIds, interest);
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
  return {
    type: event.type,
    containerId: event.containerId,
    eventType: event.eventType,
    ...(parentCovered ? { parentId } : {}),
    ...(previousParentCovered ? { previousParentId } : {}),
    updatedAt: event.updatedAt,
  };
}

/**
 * Rebuild the client frame from the shared public schema, scoped to the
 * targets the recipient covers (directly held or under a held subtree root on
 * the published path). Server-only routing metadata (`origin`, `ancestorIds`,
 * `previousAncestorIds`, `containerPaths`) never crosses the websocket
 * boundary. Events without path metadata fail closed to direct holds only.
 */
export function scopeHintToInterest(
  event: PublishedHintEvent,
  interest: ReadonlySet<string>,
): WsInvalidationHint | null {
  switch (event.type) {
    case "document_mutation_created":
    case "document_update_created": {
      const { containerPaths, origin: _origin, ...hint } = event;
      const containerIds = hint.containerIds.filter((id) =>
        coversContainerId(id, containerPaths?.[id], interest),
      );
      return containerIds.length === 0 ? null : { ...hint, containerIds };
    }
    case "container_mutation_created":
      return scopeContainerMutationHint(event, interest);
    case "container_deleted":
      return coversContainerId(event.parentId, event.ancestorIds, interest)
        ? { type: "container_children_changed", containerIds: [event.parentId] }
        : null;
    case "organization_memberships_changed":
    case "shared_with_you":
    case "user_registered": {
      const { origin: _origin, ...hint } = event;
      return hint;
    }
  }
}
