import { z } from "zod";
import {
  ErrorResponseSchema,
  RootAuditEventsResponseSchema,
  SessionFailureResponseSchema,
} from "../response";
import { loosePlainObject, uuidV4StringSchema } from "../schema";
import { defineJsonOperation } from "./definition";
import { rootIdentityPageLimitSchema } from "./root";

const RootAuditEventsQuerySchema = loosePlainObject({
  cursor: z.string().min(1).optional(),
  limit: rootIdentityPageLimitSchema().optional(),
  /** Only events this identity or organization acted in or was the target of. */
  subjectId: uuidV4StringSchema.optional(),
});
export type RootAuditEventsQuery = z.infer<typeof RootAuditEventsQuerySchema>;

export const listRootAuditEventsOperation = defineJsonOperation({
  auth: "session",
  failureResponses: {
    400: ErrorResponseSchema,
    401: SessionFailureResponseSchema,
    403: ErrorResponseSchema,
    500: ErrorResponseSchema,
  },
  failureStatuses: [400, 401, 403, 500],
  id: "root.auditEvents.list",
  summary: "Page recorded operator actions",
  description:
    "Pages recorded root operator actions newest first, optionally only those involving one identity or organization. Only root operators may call it, and reading the trail is itself recorded.",
  method: "GET",
  params: z.strictObject({}),
  path: "/root/audit-events",
  query: RootAuditEventsQuerySchema,
  responses: { 200: RootAuditEventsResponseSchema },
});
