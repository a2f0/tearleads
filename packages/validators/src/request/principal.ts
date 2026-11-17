import { z } from "zod";
import { registerJsonSchemaFragment } from "../jsonSchema";
import {
  arraySchema,
  boundedPositiveIntegerSchema,
  loosePlainObject,
  nonNegativeIntegerSchema,
  sha256HexStringSchema,
  uuidV4StringSchema,
} from "../schema";
import {
  CANONICAL_SIGNED_AT_PATTERN,
  isCanonicalSignedAt,
  SIGNED_AT_CONTRACT,
} from "../util";
import { ContainerMutationRequestSchema } from "./container";

const PrincipalProjectionMemberRequestSchema = loosePlainObject({
  identityBundleFingerprint: sha256HexStringSchema,
  role: z.literal(["member", "admin"]),
  userId: uuidV4StringSchema,
});

export type PrincipalProjectionMemberRequest = z.infer<
  typeof PrincipalProjectionMemberRequestSchema
>;

export const PrincipalContainerGrantRequestSchema = loosePlainObject({
  accessLevel: z.literal(["admin", "read", "write"]),
  containerId: uuidV4StringSchema,
});

export type PrincipalContainerGrantRequest = z.infer<
  typeof PrincipalContainerGrantRequestSchema
>;

const PrincipalStateExternalAuthorityRequestSchema = loosePlainObject({
  keyEpoch: boundedPositiveIntegerSchema(Number.MAX_SAFE_INTEGER),
  keyFingerprint: z.string(),
  principalId: uuidV4StringSchema,
  principalType: z.literal("group"),
  stateHash: z.string(),
  version: boundedPositiveIntegerSchema(Number.MAX_SAFE_INTEGER),
});

const PrincipalStateRequestSchema = loosePlainObject({
  encapsulationPublicKey: z.string(),
  externalAuthority: PrincipalStateExternalAuthorityRequestSchema.nullable(),
  grantCount: nonNegativeIntegerSchema,
  grantRoot: z.string(),
  keyEpoch: boundedPositiveIntegerSchema(Number.MAX_SAFE_INTEGER),
  keyFingerprint: z.string(),
  memberCount: nonNegativeIntegerSchema,
  memberEnvelopesRoot: z.string(),
  membershipMode: z.literal("projection"),
  membershipRoot: z.string(),
  payloadCiphertextHash: z.string(),
  prevStateHash: z.string().nullable(),
  principalId: uuidV4StringSchema,
  principalType: z.literal(["group", "organization"]),
  projectionRoot: z.string(),
  signature: z.string(),
  signedAt: registerJsonSchemaFragment(
    z.string().refine(isCanonicalSignedAt, {
      message: `signedAt must be ${SIGNED_AT_CONTRACT}`,
    }),
    { pattern: CANONICAL_SIGNED_AT_PATTERN.source, type: "string" },
  ),
  signerUserId: uuidV4StringSchema,
  signerUserKeyFingerprint: z.string(),
  version: boundedPositiveIntegerSchema(Number.MAX_SAFE_INTEGER),
});

export type PrincipalStateRequest = z.infer<typeof PrincipalStateRequestSchema>;

const PrincipalStateEncryptedPayloadRequestSchema = loosePlainObject({
  cipherSuite: z.literal("aes-256-gcm"),
  ciphertext: z.string(),
  ciphertextHash: z.string(),
});

export type PrincipalStateEncryptedPayloadRequest = z.infer<
  typeof PrincipalStateEncryptedPayloadRequestSchema
>;

const PrincipalMemberEnvelopeRequestSchema = loosePlainObject({
  kemCipherText: z.string(),
  memberKeyFingerprint: z.string(),
  userId: uuidV4StringSchema,
  wrappedKey: z.string(),
});

export type PrincipalMemberEnvelopeRequest = z.infer<
  typeof PrincipalMemberEnvelopeRequestSchema
>;

/**
 * A successor in its predecessor's key epoch may send its member envelopes as
 * changes to the predecessor's set (#2903 P17): `memberEnvelopes` is then
 * empty (the server refuses a leg with both), and the server rebuilds the full
 * set from the envelopes it stored for `state.prevStateHash` and checks it
 * against the signed root.
 */
const PrincipalMemberEnvelopeChangesRequestSchema = loosePlainObject({
  removeUserIds: arraySchema(uuidV4StringSchema),
  upsert: arraySchema(PrincipalMemberEnvelopeRequestSchema),
});

export type PrincipalMemberEnvelopeChangesRequest = z.infer<
  typeof PrincipalMemberEnvelopeChangesRequestSchema
>;

const principalPolicyRequestShape = {
  encryptedPayload: PrincipalStateEncryptedPayloadRequestSchema,
  grants: arraySchema(PrincipalContainerGrantRequestSchema),
  memberEnvelopeChanges: PrincipalMemberEnvelopeChangesRequestSchema.optional(),
  memberEnvelopes: arraySchema(PrincipalMemberEnvelopeRequestSchema),
  projection: arraySchema(PrincipalProjectionMemberRequestSchema),
  state: PrincipalStateRequestSchema,
};

export const PutPrincipalPolicyRequestSchema = loosePlainObject({
  ...principalPolicyRequestShape,
  containerMutations: arraySchema(ContainerMutationRequestSchema).optional(),
});

export type PutPrincipalPolicyRequest = z.infer<
  typeof PutPrincipalPolicyRequestSchema
>;

export const OrganizationPrincipalPolicyRequestSchema = loosePlainObject({
  ...principalPolicyRequestShape,
  containerMutations: arraySchema(ContainerMutationRequestSchema, 0).optional(),
});

export type OrganizationPrincipalPolicyRequest = z.infer<
  typeof OrganizationPrincipalPolicyRequestSchema
>;

export const CommitOrganizationGroupPolicyRequestSchema = loosePlainObject({
  groupPolicy: PutPrincipalPolicyRequestSchema,
  memberPolicy: PutPrincipalPolicyRequestSchema.optional(),
  organizationPolicy: OrganizationPrincipalPolicyRequestSchema,
});

export type CommitOrganizationGroupPolicyRequest = z.infer<
  typeof CommitOrganizationGroupPolicyRequestSchema
>;

export function isPutPrincipalPolicyRequest(
  value: unknown,
): value is PutPrincipalPolicyRequest {
  return PutPrincipalPolicyRequestSchema.safeParse(value).success;
}

export function isOrganizationPrincipalPolicyRequest(
  value: unknown,
): value is OrganizationPrincipalPolicyRequest {
  return OrganizationPrincipalPolicyRequestSchema.safeParse(value).success;
}

export function isCommitOrganizationGroupPolicyRequest(
  value: unknown,
): value is CommitOrganizationGroupPolicyRequest {
  return CommitOrganizationGroupPolicyRequestSchema.safeParse(value).success;
}
