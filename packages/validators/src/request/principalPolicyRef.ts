import { z } from "zod";
import {
  arraySchema,
  boundedPositiveIntegerSchema,
  loosePlainObject,
  nonEmptyStringSchema,
  uuidV4StringSchema,
} from "../schema";
import { MAX_CONTAINER_PRINCIPAL_POLICY_REFS } from "../util/containerLimits";

/**
 * A principal policy head a container mutation was planned against, in lieu
 * of the signed policy itself. The server refuses the mutation as stale unless
 * the head is the principal's current one, then authorizes from its own
 * verified copy of that policy. `stateHash` commits the signed state, which
 * commits the projection and grant roots, so the head pins everything the
 * inline policy carried.
 */
export const PrincipalPolicyRefSchema = loosePlainObject({
  principalType: z.literal(["group", "organization"]),
  principalId: uuidV4StringSchema,
  version: boundedPositiveIntegerSchema(Number.MAX_SAFE_INTEGER),
  stateHash: nonEmptyStringSchema,
});

export type PrincipalPolicyRef = z.infer<typeof PrincipalPolicyRefSchema>;

export const PrincipalPolicyRefListSchema = arraySchema(
  PrincipalPolicyRefSchema,
  MAX_CONTAINER_PRINCIPAL_POLICY_REFS,
);
