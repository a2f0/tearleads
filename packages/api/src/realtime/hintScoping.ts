import type { WsInvalidationHint } from "@tearleads/validators/realtime";
import type { PublishedRealtimeEvent } from "./publishedRealtimeEvents";

export type PublishedHintEvent = Extract<
  PublishedRealtimeEvent,
  { type: WsInvalidationHint["type"] }
>;

/**
 * Containers a hint is scoped to. Document hints already carry the linked
 * container set resolved during sync; container hints carry the container plus
 * its (previous) parent so a parent's watchers learn about child changes. The
 * router only delivers to sockets that declared interest in one of these.
 */
export function hintContainerIds(event: PublishedHintEvent): string[] {
  switch (event.type) {
    case "document_mutation_created":
    case "document_update_created":
      return [...new Set(event.containerIds)];
    case "container_mutation_created":
      return [
        ...new Set(
          [event.containerId, event.parentId, event.previousParentId].filter(
            (containerId): containerId is string => !!containerId,
          ),
        ),
      ];
    case "shared_with_you":
    case "user_registered":
      return [];
  }
}

function heldParent(
  parentId: string | null | undefined,
  held: ReadonlySet<string>,
): parentId is string | null {
  // Null is the root and names no container; an id must be held to be shown.
  return parentId === null || (parentId !== undefined && held.has(parentId));
}

/**
 * Rebuild the client frame from the shared public schema, scoped to the ids
 * the recipient is indexed on. The parsed event carries internal routing
 * metadata (the authoring session `origin`, a per-session identifier) and the
 * full container set the mutation touched; a recipient subscribed to only one
 * of those containers must learn neither the other ids nor the origin.
 * Reconstructing from the typed hint is what keeps both off the websocket
 * boundary.
 */
export function scopeHintToInterest(
  event: PublishedHintEvent,
  held: ReadonlySet<string>,
): WsInvalidationHint {
  switch (event.type) {
    case "document_mutation_created":
    case "document_update_created": {
      const { origin: _origin, ...hint } = event;
      return {
        ...hint,
        containerIds: hint.containerIds.filter((id) => held.has(id)),
      };
    }
    case "container_mutation_created": {
      const { parentId, previousParentId } = event;
      if (!held.has(event.containerId)) {
        const containerIds = [...new Set([parentId, previousParentId])].filter(
          (id): id is string => typeof id === "string" && held.has(id),
        );
        if (containerIds.length === 0) {
          throw new Error("Container hint recipient has no matching interest");
        }
        return { type: "container_children_changed", containerIds };
      }
      return {
        type: event.type,
        containerId: event.containerId,
        eventType: event.eventType,
        ...(heldParent(parentId, held) ? { parentId } : {}),
        ...(heldParent(previousParentId, held) ? { previousParentId } : {}),
        updatedAt: event.updatedAt,
      };
    }
    case "shared_with_you":
    case "user_registered": {
      const { origin: _origin, ...hint } = event;
      return hint;
    }
  }
}
