import { z } from "zod";
import {
  arraySchema,
  boundedPositiveIntegerSchema,
  loosePlainObject,
  nonNegativeIntegerSchema,
  uuidV4StringSchema,
} from "../schema";
import { MAX_PRINCIPAL_STATE_VERSION } from "../util";
import { ContainerMutationRequestSchema } from "./container";

export const PrincipalProjectionMemberRequestSchema = loosePlainObject({
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
  keyEpoch: boundedPositiveIntegerSchema(Number.MAX_VALUE),
  keyFingerprint: z.string(),
  principalId: uuidV4StringSchema,
  principalType: z.literal("group"),
  stateHash: z.string(),
  version: boundedPositiveIntegerSchema(Number.MAX_VALUE),
});

const PrincipalStateRequestSchema = loosePlainObject({
  encapsulationPublicKey: z.string(),
  externalAuthority: PrincipalStateExternalAuthorityRequestSchema.nullable(),
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
  principalId: uuidV4StringSchema,
  principalType: z.literal(["group", "organization"]),
  projectionRoot: z.string(),
  signature: z.string(),
  signedAt: z.string(),
  signerUserId: uuidV4StringSchema,
  signerUserKeyFingerprint: z.string(),
  version: boundedPositiveIntegerSchema(MAX_PRINCIPAL_STATE_VERSION),
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

export const PrincipalMemberEnvelopeRequestSchema = loosePlainObject({
  kemCipherText: z.string(),
  memberKeyFingerprint: z.string(),
  userId: uuidV4StringSchema,
  wrappedKey: z.string(),
});

export type PrincipalMemberEnvelopeRequest = z.infer<
  typeof PrincipalMemberEnvelopeRequestSchema
>;

export const PutPrincipalPolicyRequestSchema = loosePlainObject({
  containerMutations: arraySchema(ContainerMutationRequestSchema).optional(),
  encryptedPayload: PrincipalStateEncryptedPayloadRequestSchema,
  grants: arraySchema(PrincipalContainerGrantRequestSchema),
  memberEnvelopes: arraySchema(PrincipalMemberEnvelopeRequestSchema),
  projection: arraySchema(PrincipalProjectionMemberRequestSchema),
  state: PrincipalStateRequestSchema,
});

export type PutPrincipalPolicyRequest = z.infer<
  typeof PutPrincipalPolicyRequestSchema
>;

export function isPutPrincipalPolicyRequest(
  value: unknown,
): value is PutPrincipalPolicyRequest {
  return PutPrincipalPolicyRequestSchema.safeParse(value).success;
}
