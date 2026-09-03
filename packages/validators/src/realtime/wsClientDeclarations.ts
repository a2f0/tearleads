import { z } from "zod";
import { uuidV4StringSchema } from "../schema";
import { parseWsJson, wsDeclarationIdSchema } from "./wsShared";

/**
 * Client→server websocket interest declarations. Interest is routing state a
 * socket asks invalidations for; it is NOT an authorization grant (the HTTP
 * read models remain the source of access truth), and organization interest is
 * additionally authorized by the gateway before it is applied.
 */

// Bounds the transport payload (Bun's maxPayloadLength) and the pre-parse
// length check, so a hostile client cannot make the server parse an unbounded
// JSON document.
export const MAX_WS_CLIENT_MESSAGE_BYTES = 1_000_000;
export const MAX_WS_INTEREST_CONTAINER_IDS = 10_000;

const interestContainerIdsSchema = z
  .array(uuidV4StringSchema)
  .max(MAX_WS_INTEREST_CONTAINER_IDS);

export const WsKnownContainersReplaceSchema = z.object({
  type: z.literal("known_containers"),
  containerIds: interestContainerIdsSchema.optional(),
  declarationId: wsDeclarationIdSchema.optional(),
});

export const WsKnownContainersAddSchema = z.object({
  type: z.literal("known_containers.add"),
  containerIds: interestContainerIdsSchema.optional(),
  declarationId: wsDeclarationIdSchema.optional(),
});

export const WsKnownContainersRemoveSchema = z.object({
  type: z.literal("known_containers.remove"),
  containerIds: interestContainerIdsSchema.optional(),
  declarationId: wsDeclarationIdSchema.optional(),
});

// At most one organization may hold realtime interest per socket; an empty
// array clears it. The declaration id is required because every organization
// declaration is acknowledged after gateway authorization.
export const WsKnownOrganizationsReplaceSchema = z.object({
  type: z.literal("known_organizations"),
  declarationId: wsDeclarationIdSchema,
  organizationIds: z.array(uuidV4StringSchema).max(1),
});

export const WsClientDeclarationSchema = z.discriminatedUnion("type", [
  WsKnownContainersReplaceSchema,
  WsKnownContainersAddSchema,
  WsKnownContainersRemoveSchema,
  WsKnownOrganizationsReplaceSchema,
]);

export type WsClientDeclaration = z.infer<typeof WsClientDeclarationSchema>;

export function serializeWsClientDeclaration(
  declaration: WsClientDeclaration,
): string {
  return JSON.stringify(declaration);
}

/** Malformed, unknown-tag, and oversized declarations fail closed to null. */
export function parseWsClientDeclaration(
  rawMessage: string,
): WsClientDeclaration | null {
  if (rawMessage.length > MAX_WS_CLIENT_MESSAGE_BYTES) {
    return null;
  }
  return parseWsJson(WsClientDeclarationSchema, rawMessage);
}
