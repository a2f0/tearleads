import { z } from "zod";
import { registerJsonSchemaFragment } from "../jsonSchema";
import {
  arraySchema,
  loosePlainObject,
  safeNonNegativeIntegerSchema,
  uuidStringSchema,
  uuidV4StringSchema,
} from "../schema";

const timestampSchema = registerJsonSchemaFragment(z.iso.datetime(), {
  type: "string",
  format: "date-time",
});

export const PendingBlobDeletionSchema = loosePlainObject({
  blobId: uuidStringSchema,
  organizationId: uuidV4StringSchema,
  byteLength: safeNonNegativeIntegerSchema,
  status: z.literal(["grace-period", "eligible", "deletion-pending"]),
  dereferencedAt: timestampSchema.nullable(),
  eligibleAfter: timestampSchema.nullable(),
  reclaimAttemptedAt: timestampSchema.nullable(),
  prunedAt: timestampSchema.nullable(),
  objectDeleteAttemptedAt: timestampSchema.nullable(),
});
export type PendingBlobDeletion = z.infer<typeof PendingBlobDeletionSchema>;

export const PendingBlobDeletionsResponseSchema = loosePlainObject({
  blobs: arraySchema(PendingBlobDeletionSchema),
  nextAfterId: z.string().nullable(),
});
export type PendingBlobDeletionsResponse = z.infer<
  typeof PendingBlobDeletionsResponseSchema
>;
