import { z } from "zod";
import {
  arraySchema,
  loosePlainObject,
  safeNonNegativeIntegerSchema,
} from "../schema";
import { PRINCIPAL_POLICY_HISTORY_PAGE_LIMIT } from "../util/principalHistoryWire";
import {
  PrincipalPolicyStateChainEntryResponseSchema,
  principalPolicyCurrentResponseShape,
} from "./principal";
import { ReferencedPrincipalStateResponseSchema } from "./principalReference";

/** A fragment of one exact policy prefix, including its pinned current artifacts. */
export const PrincipalPolicyPageResponseSchema = loosePlainObject({
  ...principalPolicyCurrentResponseShape,
  previousStates: arraySchema(
    PrincipalPolicyStateChainEntryResponseSchema,
    PRINCIPAL_POLICY_HISTORY_PAGE_LIMIT,
  ),
  historyPage: loosePlainObject({
    afterVersion: safeNonNegativeIntegerSchema,
    nextAfterVersion: safeNonNegativeIntegerSchema.nullable(),
  }),
});

export type PrincipalPolicyPageResponse = z.infer<
  typeof PrincipalPolicyPageResponseSchema
>;

export function isPrincipalPolicyPageResponse(
  value: unknown,
): value is PrincipalPolicyPageResponse {
  return PrincipalPolicyPageResponseSchema.safeParse(value).success;
}

/**
 * The reply to a conditional discovery read whose named head is still live.
 * It is not evidence: the client authenticates the head it already holds.
 */
export const PrincipalPolicyUnchangedResponseSchema = z.strictObject({
  unchanged: z.literal(true),
  head: ReferencedPrincipalStateResponseSchema,
});

export type PrincipalPolicyUnchangedResponse = z.infer<
  typeof PrincipalPolicyUnchangedResponseSchema
>;

/** A policy page, or the bare head when a conditional read named it. */
export const PrincipalPolicyReadResponseSchema = z.union([
  PrincipalPolicyPageResponseSchema,
  PrincipalPolicyUnchangedResponseSchema,
]);

export type PrincipalPolicyReadResponse = z.infer<
  typeof PrincipalPolicyReadResponseSchema
>;

export function isPrincipalPolicyUnchangedResponse(
  value: unknown,
): value is PrincipalPolicyUnchangedResponse {
  return PrincipalPolicyUnchangedResponseSchema.safeParse(value).success;
}
