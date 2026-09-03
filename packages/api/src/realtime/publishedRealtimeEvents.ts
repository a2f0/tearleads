import {
  WsContainerMutationCreatedHintSchema,
  WsDocumentMutationCreatedHintSchema,
  WsDocumentUpdateCreatedHintSchema,
  WsOrganizationReadModelAccessRevokedFrameSchema,
  WsSharedWithYouHintSchema,
  WsUserRegisteredHintSchema,
} from "@tearleads/validators/realtime";
import { z } from "zod";

// The exact uuid-v4 constraint the public organization frames use.
const uuidV4Schema =
  WsOrganizationReadModelAccessRevokedFrameSchema.shape.organizationId;

/**
 * The internal Redis pub/sub event contract, derived from the shared public
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

export const PublishedRealtimeEventSchema = z.discriminatedUnion("type", [
  WsDocumentUpdateCreatedHintSchema.extend({
    origin: wsOriginSchema.optional(),
  }),
  WsDocumentMutationCreatedHintSchema.extend({
    origin: wsOriginSchema.optional(),
  }),
  WsContainerMutationCreatedHintSchema.extend({
    origin: wsOriginSchema.optional(),
  }),
  WsSharedWithYouHintSchema.extend({ origin: wsOriginSchema.optional() }),
  WsUserRegisteredHintSchema.extend({ origin: wsOriginSchema.optional() }),
  // Server-only control events: consumed by the router, never forwarded.
  z.object({
    containerId: z.string().min(1),
    type: z.literal("access_changed"),
  }),
  z.object({
    sessionId: z.string().min(1),
    type: z.literal("session_revoked"),
    userId: z.string().min(1),
  }),
  z.object({
    organizationId: uuidV4Schema,
    origin: wsOriginSchema.optional(),
    recipientUserIds: z.array(uuidV4Schema),
    type: z.literal("organization_read_model_changed"),
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
