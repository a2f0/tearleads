import { z } from "zod";
import { registerJsonSchemaFragment } from "../jsonSchema";
import {
  ErrorResponseSchema,
  PendingBlobDeletionsResponseSchema,
  SessionFailureResponseSchema,
} from "../response";
import { boundedNonEmptyStringSchema, uuidV4StringSchema } from "../schema";
import { defineJsonOperation } from "./definition";
import { OrganizationPathParamsSchema } from "./organizations";

const limitDescription = { type: "integer", minimum: 1, maximum: 100 } as const;
const limitInput = registerJsonSchemaFragment(
  z.union([z.number(), z.string()]).refine((value) => {
    if (typeof value === "string" && !/^\d+$/u.test(value)) return false;
    const number = Number(value);
    return Number.isSafeInteger(number) && number >= 1 && number <= 100;
  }),
  limitDescription,
);
const pageShape = {
  cursor: boundedNonEmptyStringSchema(512).optional(),
  limit: registerJsonSchemaFragment(
    limitInput.transform(Number),
    limitDescription,
  ).optional(),
};
export const PendingBlobDeletionsQuerySchema = z.looseObject(pageShape);
export type PendingBlobDeletionsQuery = z.infer<
  typeof PendingBlobDeletionsQuerySchema
>;
export const RootPendingBlobDeletionsQuerySchema = z.looseObject({
  ...pageShape,
  organizationId: uuidV4StringSchema.optional(),
});
export type RootPendingBlobDeletionsQuery = z.infer<
  typeof RootPendingBlobDeletionsQuerySchema
>;

const failureResponses = {
  400: ErrorResponseSchema,
  401: SessionFailureResponseSchema,
  403: ErrorResponseSchema,
  404: ErrorResponseSchema,
  409: ErrorResponseSchema,
  500: ErrorResponseSchema,
} as const;

export const listRootPendingBlobDeletionsOperation = defineJsonOperation({
  auth: "session",
  failureResponses,
  failureStatuses: [400, 401, 403, 404, 409, 500],
  id: "root.blobs.pendingDeletion.list",
  summary: "List pending blob deletions across organizations",
  description:
    "Root-only, audited read-only lifecycle metadata, ordered by blob id. Includes grace-period orphans and durable physical-deletion work; never exposes object keys or blob content. Eligibility is a database-clock snapshot, not a promised deletion time. Pass nextAfterId as cursor; pages default to 50 and are bounded to 100.",
  method: "GET",
  params: z.strictObject({}),
  path: "/root/blobs/pending-deletion",
  query: RootPendingBlobDeletionsQuerySchema,
  responses: { 200: PendingBlobDeletionsResponseSchema },
});

export const listOrganizationPendingBlobDeletionsOperation =
  defineJsonOperation({
    auth: "session",
    failureResponses,
    failureStatuses: [400, 401, 403, 404, 409, 500],
    id: "organizations.blobs.pendingDeletion.list",
    summary: "List an organization's pending blob deletions",
    description:
      "Requires current verified organization administrator policy. Read-only lifecycle metadata ordered by blob id, including pending physical deletion after pruning. Active, rebound and physically deleted blobs are omitted. Eligibility is a snapshot, not a promised deletion time. Pass nextAfterId as cursor; pages default to 50 and are bounded to 100.",
    method: "GET",
    params: OrganizationPathParamsSchema,
    path: "/organizations/{organizationId}/blobs/pending-deletion",
    query: PendingBlobDeletionsQuerySchema,
    responses: { 200: PendingBlobDeletionsResponseSchema },
  });
