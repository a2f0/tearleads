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
>(event: T, movedContainers: MovedContainerMemory, now: number): T | null {
  if (!event.containerPaths) return event;
  const containerPaths: Record<string, string[]> = {};
  const droppedContainerIds = new Set<string>();
  for (const [containerId, path] of Object.entries(event.containerPaths)) {
    const resolved = movedContainers.resolvePath(path, now);
    if (resolved === null) {
      // Cycle or path overflow: fail closed by dropping this container target.
      droppedContainerIds.add(containerId);
      continue;
    }
    containerPaths[containerId] = resolved ? [...resolved] : [...path];
  }
  if (droppedContainerIds.size === 0) {
    return { ...event, containerPaths };
  }
  const containerIds = event.containerIds.filter(
    (id) => !droppedContainerIds.has(id),
  );
  return containerIds.length === 0
    ? null
    : { ...event, containerIds, containerPaths };
}

function resolvePreviousMoveAncestors(
  event: Extract<PublishedHintEvent, { type: "container_mutation_created" }>,
  movedContainers: MovedContainerMemory,
  now: number,
  stripPrevious: boolean,
): {
  readonly previousAncestorIds?: string[] | undefined;
  readonly previousParentId?: string | null | undefined;
} {
  if (stripPrevious) {
    return { previousAncestorIds: undefined, previousParentId: undefined };
  }
  if (event.previousAncestorIds === undefined) {
    return {};
  }
  const resolved = movedContainers.resolvePath(event.previousAncestorIds, now);
  if (resolved === null || resolved === undefined || resolved.length === 0) {
    return { previousAncestorIds: undefined, previousParentId: undefined };
  }
  return {
    previousAncestorIds: [...resolved],
    previousParentId: resolved.at(-1) ?? null,
  };
}

function resolveCurrentMoveAncestors(
  event: Extract<PublishedHintEvent, { type: "container_mutation_created" }>,
  movedContainers: MovedContainerMemory,
  now: number,
): {
  readonly ancestorIds: string[] | undefined;
  readonly changed: boolean;
  readonly parentId: string | null | undefined;
} | null {
  if (event.ancestorIds === undefined) {
    return {
      ancestorIds: undefined,
      changed: false,
      parentId: event.parentId,
    };
  }
  const resolved = movedContainers.resolveAncestors(
    event.containerId,
    event.ancestorIds,
    now,
  );
  if (resolved === null) return null;
  if (!resolved || sameIds(resolved, event.ancestorIds)) {
    return {
      ancestorIds: event.ancestorIds,
      changed: false,
      parentId: event.parentId,
    };
  }
  return {
    ancestorIds: [...resolved],
    changed: true,
    parentId: resolved.at(-1) ?? null,
  };
}

function resolveContainerMutationPaths(
  event: Extract<PublishedHintEvent, { type: "container_mutation_created" }>,
  movedContainers: MovedContainerMemory,
  now: number,
): PublishedHintEvent | null {
  const current = resolveCurrentMoveAncestors(event, movedContainers, now);
  if (current === null) return null;
  const stripPrevious = current.changed && event.eventType !== "container.move";
  const previousPatch = resolvePreviousMoveAncestors(
    event,
    movedContainers,
    now,
    stripPrevious,
  );
  if (!current.changed && Object.keys(previousPatch).length === 0) {
    return event;
  }
  const {
    previousAncestorIds: _oldPrevAncestors,
    previousParentId: _oldPrevParent,
    ...rest
  } = event;
  const previousAncestorIds =
    "previousAncestorIds" in previousPatch
      ? previousPatch.previousAncestorIds
      : event.previousAncestorIds;
  const previousParentId =
    "previousParentId" in previousPatch
      ? previousPatch.previousParentId
      : event.previousParentId;
  return {
    ...rest,
    ...(current.ancestorIds === undefined
      ? {}
      : { ancestorIds: current.ancestorIds }),
    ...(current.parentId === undefined ? {} : { parentId: current.parentId }),
    ...(previousAncestorIds === undefined ? {} : { previousAncestorIds }),
    ...(previousParentId === undefined ? {} : { previousParentId }),
  };
}

function resolveContainerDeletedPaths(
  event: Extract<PublishedHintEvent, { type: "container_deleted" }>,
  movedContainers: MovedContainerMemory,
  now: number,
): PublishedHintEvent | null {
  const resolvedAncestors = movedContainers.resolveAncestors(
    event.containerId,
    event.ancestorIds,
    now,
  );
  if (resolvedAncestors === null) return null;
  if (!resolvedAncestors) return event;
  const parentId = resolvedAncestors.at(-1);
  // A deleted child always had a parent; if rewriting leaves no ancestors,
  // fail closed rather than routing to a stale parentId.
  if (!parentId) return null;
  if (
    sameIds(resolvedAncestors, event.ancestorIds) &&
    parentId === event.parentId
  ) {
    return event;
  }
  return { ...event, ancestorIds: [...resolvedAncestors], parentId };
}

/**
 * Rewrites any stale published paths against the hub's short-lived memory of
 * recently moved containers. Leaves events without paths untouched so they
 * continue to fail closed; returns `null` if path resolution fails closed.
 */
export function resolveHintPaths(
  event: PublishedHintEvent,
  movedContainers: MovedContainerMemory,
  now: number,
): PublishedHintEvent | null {
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
      return JSON.stringify(
        event.containerIds.filter((id) =>
          coversContainerId(id, event.containerPaths?.[id], interest),
        ),
      );
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
