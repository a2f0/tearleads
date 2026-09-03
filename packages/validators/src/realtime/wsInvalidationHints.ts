import { z } from "zod";

/**
 * Public realtime invalidation hints — the server→client websocket frames that
 * tell a client some server state changed so it can re-fetch over HTTP. Hints
 * are lossy notifications, never data carriers: payloads identify what changed,
 * and HTTP remains the source of truth for content and access.
 *
 * The server reconstructs every outgoing hint from these schemas, so internal
 * routing metadata (the authoring session origin, recipient audiences) never
 * crosses the websocket boundary.
 */

export const WsDocumentUpdateCreatedHintSchema = z.object({
  type: z.literal("document_update_created"),
  containerIds: z.array(z.string().min(1)),
  documentId: z.string().min(1),
  // Attachment bind/detach hints carry no update ids; readers treat their
  // absence as a lossy signal to pull.
  updateIds: z.array(z.string().min(1)).optional(),
});

export const WsDocumentMutationCreatedHintSchema = z.object({
  type: z.literal("document_mutation_created"),
  containerIds: z.array(z.string().min(1)),
  documentId: z.string().min(1),
  eventType: z.enum(["document.link", "document.purge", "document.unlink"]),
});

export const WsContainerMutationCreatedHintSchema = z.object({
  type: z.literal("container_mutation_created"),
  containerId: z.string().min(1),
  eventType: z.string().min(1),
  parentId: z.string().min(1).nullable(),
  previousParentId: z.string().min(1).nullable().optional(),
  updatedAt: z.string().min(1),
});

// Routed by user, not container interest: the recipient does not know the
// shared container yet, so the client reacts by re-listing root containers.
export const WsSharedWithYouHintSchema = z.object({
  type: z.literal("shared_with_you"),
  userId: z.string().min(1),
});

export const WsUserRegisteredHintSchema = z.object({
  type: z.literal("user_registered"),
  userId: z.string().min(1),
  fingerprint: z.string().min(1).optional(),
});

export const WsInvalidationHintSchema = z.discriminatedUnion("type", [
  WsDocumentUpdateCreatedHintSchema,
  WsDocumentMutationCreatedHintSchema,
  WsContainerMutationCreatedHintSchema,
  WsSharedWithYouHintSchema,
  WsUserRegisteredHintSchema,
]);

export type WsInvalidationHint = z.infer<typeof WsInvalidationHintSchema>;
