import type { z } from "zod";
import {
  arraySchema,
  boundedNonEmptyStringSchema,
  loosePlainObject,
  safeNonNegativeIntegerSchema,
} from "../schema";
import { PRINCIPAL_POLICY_HISTORY_PAGE_LIMIT } from "../util/principalHistoryWire";
import { ReferencedPrincipalStateResponseSchema } from "./principalReference";
import {
  PrincipalContainerGrantResponseSchema,
  PrincipalPolicyStateChainEntryResponseSchema,
  PrincipalProjectionMemberResponseSchema,
  PrincipalStateResponseSchema,
} from "./principalSnapshot";

/** A server read scope and transport pin, never client verification evidence. */
export const PrincipalPolicyHistorySourceResponseSchema = loosePlainObject({
  head: ReferencedPrincipalStateResponseSchema,
  grant: boundedNonEmptyStringSchema(4096),
});

export type PrincipalPolicyHistorySourceResponse = z.infer<
  typeof PrincipalPolicyHistorySourceResponseSchema
>;

/** Public signed authorization only; contains no payloads or key envelopes. */
export const PrincipalPolicySnapshotPageResponseSchema = loosePlainObject({
  currentGrants: arraySchema(PrincipalContainerGrantResponseSchema),
  currentProjection: arraySchema(PrincipalProjectionMemberResponseSchema),
  currentState: PrincipalStateResponseSchema,
  previousStates: arraySchema(
    PrincipalPolicyStateChainEntryResponseSchema,
    PRINCIPAL_POLICY_HISTORY_PAGE_LIMIT,
  ),
  historyPage: loosePlainObject({
    afterVersion: safeNonNegativeIntegerSchema,
    nextAfterVersion: safeNonNegativeIntegerSchema.nullable(),
  }),
});

export type PrincipalPolicySnapshotPageResponse = z.infer<
  typeof PrincipalPolicySnapshotPageResponseSchema
>;

export function isPrincipalPolicySnapshotPageResponse(
  value: unknown,
): value is PrincipalPolicySnapshotPageResponse {
  return PrincipalPolicySnapshotPageResponseSchema.safeParse(value).success;
}
