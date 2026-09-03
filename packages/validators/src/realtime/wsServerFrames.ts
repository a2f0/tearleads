import { z } from "zod";
import { uuidV4StringSchema } from "../schema";
import {
  type WsInvalidationHint,
  WsInvalidationHintSchema,
} from "./wsInvalidationHints";
import { parseWsJson, wsDeclarationIdSchema } from "./wsShared";

/**
 * Server→client websocket control frames: connection/interest lifecycle and
 * resync signals, as opposed to the invalidation hints that fan out interest-
 * routed server events. Together with the hints they form the complete set of
 * frames a client may receive; anything else fails closed on both sides.
 */

// The reconnect baseline frame: the container ids the server already holds for
// this session. The matching declaration acknowledgement — not this frame — is
// the client's ordering barrier for closing the lossy reconnect interval.
export const WsInterestStateFrameSchema = z.object({
  type: z.literal("interest_state"),
  containerIds: z.array(z.string().min(1)),
});

export const WsKnownContainersAckFrameSchema = z.object({
  type: z.literal("known_containers_ack"),
  declarationId: wsDeclarationIdSchema,
});

export const WsKnownOrganizationsAckFrameSchema = z.object({
  type: z.literal("known_organizations_ack"),
  declarationId: wsDeclarationIdSchema,
  organizationId: uuidV4StringSchema.nullable(),
  authorized: z.boolean(),
});

// A container's access changed; the client must reconcile it over HTTP and, if
// still authorized, re-declare interest.
export const WsResyncRequiredFrameSchema = z.object({
  type: z.literal("resync_required"),
  containerId: z.string().min(1),
});

export const WsOrganizationReadModelChangedFrameSchema = z.object({
  type: z.literal("organization_read_model_changed"),
  organizationId: uuidV4StringSchema,
  originatedFromSession: z.boolean(),
});

export const WsOrganizationReadModelAccessRevokedFrameSchema = z.object({
  type: z.literal("organization_read_model_access_revoked"),
  organizationId: uuidV4StringSchema,
});

export const WsServerControlFrameSchema = z.discriminatedUnion("type", [
  WsInterestStateFrameSchema,
  WsKnownContainersAckFrameSchema,
  WsKnownOrganizationsAckFrameSchema,
  WsResyncRequiredFrameSchema,
  WsOrganizationReadModelChangedFrameSchema,
  WsOrganizationReadModelAccessRevokedFrameSchema,
]);

export type WsServerControlFrame = z.infer<typeof WsServerControlFrameSchema>;

export const WsServerMessageSchema = z.discriminatedUnion("type", [
  ...WsServerControlFrameSchema.options,
  ...WsInvalidationHintSchema.options,
]);

export type WsServerMessage = WsServerControlFrame | WsInvalidationHint;

/** The single typed egress: the server cannot serialize an undeclared frame. */
export function serializeWsServerMessage(message: WsServerMessage): string {
  return JSON.stringify(message);
}

/** Malformed and unknown-tag server frames fail closed to null. */
export function parseWsServerMessage(
  rawMessage: string,
): WsServerMessage | null {
  return parseWsJson(WsServerMessageSchema, rawMessage);
}
