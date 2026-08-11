import { z } from "zod";
import { BILLING_ERROR_CODES } from "../billing";
import {
  arraySchema,
  loosePlainObject,
  nonNegativeIntegerSchema,
  positiveIntegerSchema,
} from "../schema";
import { ContainerMutationResponseSchema } from "./container";

export const PrincipalStateExternalAuthorityResponseSchema = loosePlainObject({
  keyEpoch: positiveIntegerSchema,
  keyFingerprint: z.string(),
  principalId: z.string(),
  principalType: z.literal("group"),
  stateHash: z.string(),
  version: positiveIntegerSchema,
});

export type PrincipalStateExternalAuthorityResponse = z.infer<
  typeof PrincipalStateExternalAuthorityResponseSchema
>;

export const PrincipalStateResponseSchema = loosePlainObject({
  createdAt: z.string(),
  encapsulationPublicKey: z.string(),
  externalAuthority: PrincipalStateExternalAuthorityResponseSchema.nullable(),
  grantCount: nonNegativeIntegerSchema,
  grantRoot: z.string(),
  keyEpoch: z.number(),
  keyFingerprint: z.string(),
  memberCount: nonNegativeIntegerSchema,
  memberEnvelopesRoot: z.string(),
  membershipMode: z.literal("projection"),
  membershipRoot: z.string(),
  payloadCiphertextHash: z.string(),
  prevStateHash: z.string().nullable(),
  principalId: z.string(),
  principalType: z.literal(["group", "organization"]),
  projectionRoot: z.string(),
  signature: z.string(),
  signedAt: z.string(),
  signerUserId: z.string(),
  signerUserKeyFingerprint: z.string(),
  stateHash: z.string(),
  version: z.number(),
});

export type PrincipalStateResponse = z.infer<
  typeof PrincipalStateResponseSchema
>;

export const PrincipalProjectionMemberResponseSchema = loosePlainObject({
  role: z.literal(["member", "admin"]),
  userId: z.string(),
});

export type PrincipalProjectionMemberResponse = z.infer<
  typeof PrincipalProjectionMemberResponseSchema
>;

export const PrincipalContainerGrantResponseSchema = loosePlainObject({
  accessLevel: z.literal(["admin", "read", "write"]),
  containerId: z.string(),
});

export type PrincipalContainerGrantResponse = z.infer<
  typeof PrincipalContainerGrantResponseSchema
>;

export const PrincipalStatePayloadResponseSchema = loosePlainObject({
  cipherSuite: z.literal("aes-256-gcm"),
  ciphertext: z.string(),
  ciphertextHash: z.string(),
  createdAt: z.string(),
  principalId: z.string(),
  principalType: z.literal(["group", "organization"]),
  stateHash: z.string(),
});

export type PrincipalStatePayloadResponse = z.infer<
  typeof PrincipalStatePayloadResponseSchema
>;

export const PrincipalMemberEnvelopeResponseSchema = loosePlainObject({
  kemCipherText: z.string(),
  memberKeyFingerprint: z.string(),
  userId: z.string(),
  wrappedKey: z.string(),
});

export type PrincipalMemberEnvelopeResponse = z.infer<
  typeof PrincipalMemberEnvelopeResponseSchema
>;

export const CurrentPrincipalMemberEnvelopesResponseSchema = loosePlainObject({
  envelopes: arraySchema(PrincipalMemberEnvelopeResponseSchema),
  epoch: z.number(),
  principalId: z.string(),
  principalType: z.literal(["group", "organization"]),
  stateHash: z.string(),
});

export type CurrentPrincipalMemberEnvelopesResponse = z.infer<
  typeof CurrentPrincipalMemberEnvelopesResponseSchema
>;

export const PrincipalPolicyStateChainEntryResponseSchema = loosePlainObject({
  grants: arraySchema(PrincipalContainerGrantResponseSchema),
  projection: arraySchema(PrincipalProjectionMemberResponseSchema),
  state: PrincipalStateResponseSchema,
});

export type PrincipalPolicyStateChainEntryResponse = z.infer<
  typeof PrincipalPolicyStateChainEntryResponseSchema
>;

const principalPolicyBundleResponseShape = {
  currentGrants: arraySchema(PrincipalContainerGrantResponseSchema),
  currentMemberEnvelopes: CurrentPrincipalMemberEnvelopesResponseSchema,
  currentPayload: PrincipalStatePayloadResponseSchema,
  currentProjection: arraySchema(PrincipalProjectionMemberResponseSchema),
  currentState: PrincipalStateResponseSchema,
  previousStates: arraySchema(PrincipalPolicyStateChainEntryResponseSchema),
};

export const PrincipalPolicyBundleResponseSchema = loosePlainObject(
  principalPolicyBundleResponseShape,
);

export type PrincipalPolicyBundleResponse = z.infer<
  typeof PrincipalPolicyBundleResponseSchema
>;

export const PrincipalPolicyMutationResponseSchema = loosePlainObject({
  ...principalPolicyBundleResponseShape,
  containerMutations: arraySchema(ContainerMutationResponseSchema),
});

export type PrincipalPolicyMutationResponse = z.infer<
  typeof PrincipalPolicyMutationResponseSchema
>;

export const CommitOrganizationGroupPolicyResponseSchema = loosePlainObject({
  groupPolicy: PrincipalPolicyMutationResponseSchema,
  organizationPolicy: PrincipalPolicyMutationResponseSchema,
});

export type CommitOrganizationGroupPolicyResponse = z.infer<
  typeof CommitOrganizationGroupPolicyResponseSchema
>;

const BillingErrorCodeSchema = z.literal([
  BILLING_ERROR_CODES.checkoutNoActiveMembers,
  BILLING_ERROR_CODES.rosterOverCapacity,
]);

export const PrincipalPolicyErrorResponseSchema = loosePlainObject({
  code: BillingErrorCodeSchema.optional(),
  error: z.string(),
});

export type PrincipalPolicyErrorResponse = z.infer<
  typeof PrincipalPolicyErrorResponseSchema
>;

export const PrincipalPolicyStaleErrorResponseSchema = loosePlainObject({
  code: z.literal("principal_policy_stale"),
  error: z.string(),
  principalPolicies: arraySchema(PrincipalPolicyBundleResponseSchema),
});

export type PrincipalPolicyStaleErrorResponse = z.infer<
  typeof PrincipalPolicyStaleErrorResponseSchema
>;

export function isPrincipalStateResponse(
  value: unknown,
): value is PrincipalStateResponse {
  return PrincipalStateResponseSchema.safeParse(value).success;
}

export function isPrincipalStatePayloadResponse(
  value: unknown,
): value is PrincipalStatePayloadResponse {
  return PrincipalStatePayloadResponseSchema.safeParse(value).success;
}

export function isCurrentPrincipalMemberEnvelopesResponse(
  value: unknown,
): value is CurrentPrincipalMemberEnvelopesResponse {
  return CurrentPrincipalMemberEnvelopesResponseSchema.safeParse(value).success;
}

export function isPrincipalPolicyStateChainEntryResponse(
  value: unknown,
): value is PrincipalPolicyStateChainEntryResponse {
  return PrincipalPolicyStateChainEntryResponseSchema.safeParse(value).success;
}

export function isPrincipalPolicyBundleResponse(
  value: unknown,
): value is PrincipalPolicyBundleResponse {
  return PrincipalPolicyBundleResponseSchema.safeParse(value).success;
}

export function isPrincipalPolicyMutationResponse(
  value: unknown,
): value is PrincipalPolicyMutationResponse {
  return PrincipalPolicyMutationResponseSchema.safeParse(value).success;
}

export function isCommitOrganizationGroupPolicyResponse(
  value: unknown,
): value is CommitOrganizationGroupPolicyResponse {
  return CommitOrganizationGroupPolicyResponseSchema.safeParse(value).success;
}

export function isPrincipalPolicyStaleErrorResponse(
  value: unknown,
): value is PrincipalPolicyStaleErrorResponse {
  return PrincipalPolicyStaleErrorResponseSchema.safeParse(value).success;
}
