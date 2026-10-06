import type { z } from "zod";
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
