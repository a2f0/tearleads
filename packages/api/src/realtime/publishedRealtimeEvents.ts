import {
  WsContainerMutationCreatedHintSchema,
  WsDocumentMutationCreatedHintSchema,
  WsDocumentUpdateCreatedHintSchema,
  WsOrganizationMembershipsChangedHintSchema,
  WsOrganizationReadModelChangedFrameSchema,
  WsSharedWithYouHintSchema,
  WsUserRegisteredHintSchema,
} from "@tearleads/validators/realtime";
import { MAX_CONTAINER_PATH_LENGTH } from "@tearleads/validators/util";
import { z } from "zod";

// The exact uuid-v4 constraint the public organization frames use.
const uuidV4Schema =
  WsOrganizationReadModelChangedFrameSchema.shape.organizationId;

/**
 * Server-only container ancestor chain (`[root, ..., parent]` for container
 * events, or `[root, ..., containerId]` per linked container for document
 * events). Never crosses the websocket boundary; `scopeHintToInterest` strips
 * it when rebuilding outgoing frames.
 */
const containerPathIdsSchema = z
  .array(z.string().min(1))
  .max(MAX_CONTAINER_PATH_LENGTH);

const containerPathsSchema = z.record(
  z.string().min(1),
  containerPathIdsSchema,
);

/**
 * The internal pub/sub event contract, derived from the shared public
 * hint schemas plus server-only routing metadata. `origin` identifies the
 * authoring session so the router does not echo an event back over the
 * author's own socket; it must never cross the websocket boundary, which the
 * router guarantees by reconstructing outgoing frames from the public schemas
 * instead of forwarding raw payloads.
 */
const wsOriginSchema = z.object({
  sessionId: z.string().min(1),
  userId: z.string().min(1),
});

const PublishedRealtimeEventSchema = z.discriminatedUnion("type", [
  WsDocumentUpdateCreatedHintSchema.extend({
    containerPaths: containerPathsSchema.optional(),
    origin: wsOriginSchema.optional(),
  }),
  WsDocumentMutationCreatedHintSchema.extend({
    containerPaths: containerPathsSchema.optional(),
    origin: wsOriginSchema.optional(),
  }),
  WsContainerMutationCreatedHintSchema.extend({
    ancestorIds: containerPathIdsSchema.optional(),
    origin: wsOriginSchema.optional(),
    previousAncestorIds: containerPathIdsSchema.optional(),
  }),
  // Server-only event emitted alongside `access_changed` when a container is
  // deleted so sockets covering the deleted container's parent via an ancestor
  // root receive `container_children_changed([parentId])` without revealing
  // `parentId` to sockets that only held the deleted container itself.
  z.object({
    ancestorIds: containerPathIdsSchema,
    containerId: z.string().min(1),
    origin: wsOriginSchema.optional(),
    parentId: z.string().min(1),
    type: z.literal("container_deleted"),
  }),
  WsSharedWithYouHintSchema.extend({ origin: wsOriginSchema.optional() }),
  WsOrganizationMembershipsChangedHintSchema.extend({
    origin: wsOriginSchema.optional(),
  }),
  WsUserRegisteredHintSchema.extend({ origin: wsOriginSchema.optional() }),
  // Server-only control events: consumed by the router, never forwarded.
  z.object({
    type: z.literal("principal_access_changed"),
    principalType: z.enum(["group", "organization"]),
    principalId: z.string().min(1),
  }),
  z.object({
    containerId: z.string().min(1),
    type: z.literal("access_changed"),
  }),
  z.object({
    sessionId: z.string().min(1),
    type: z.literal("session_revoked"),
    userId: z.string().min(1),
  }),
  // The router copies the committed cursor into each recipient's frame.
  WsOrganizationReadModelChangedFrameSchema.extend({
    recipientUserIds: z.array(uuidV4Schema),
  }),
]);

export type PublishedRealtimeEvent = z.infer<
  typeof PublishedRealtimeEventSchema
>;

export type PublishedOrganizationReadModelChangedEvent = Extract<
  PublishedRealtimeEvent,
  { type: "organization_read_model_changed" }
>;

/** Malformed and unknown published events fail closed to null. */
export function parsePublishedRealtimeEvent(
  rawMessage: string,
): PublishedRealtimeEvent | null {
  let value: unknown;
  try {
    value = JSON.parse(rawMessage);
  } catch {
    return null;
  }
  const parsed = PublishedRealtimeEventSchema.safeParse(value);
  return parsed.success ? parsed.data : null;
}
