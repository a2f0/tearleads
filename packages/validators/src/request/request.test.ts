import { expect, test } from "bun:test";
import {
  MAX_INITIATE_PART_UPLOADS,
  MAX_INLINE_CONTAINER_REKEYS,
  ML_DSA87_SIGNATURE_BYTES,
} from "../util";
import { isOptionalContainerMutationRequestArray } from "./container";
import {
  ChallengeRequestSchema,
  isChallengeRequest,
  isCreateOrganizationGroupRequest,
  isInitiateMultipartBlobStageRequest,
  isPutPrincipalPolicyRequest,
  isUpdateOrganizationProfileRequest,
  isUpdateOrganizationRosterEntryRequest,
  isVerifyRequest,
  OrganizationPrincipalPolicyRequestSchema,
  VerifyRequestSchema,
} from "./index";

const VALID_FINGERPRINT = "a".repeat(64);
const signatureBytes = (length: number) =>
  Buffer.from(Array.from({ length }, (_, index) => index % 256));
const VALID_SIGNATURE = signatureBytes(ML_DSA87_SIGNATURE_BYTES).toString(
  "base64",
);

test("isUpdateOrganizationRosterEntryRequest", () => {
  expect(
    isUpdateOrganizationRosterEntryRequest({
      profileDocumentId: "550e8400-e29b-41d4-a716-446655440001",
    }),
  ).toBe(true);
  expect(
    isUpdateOrganizationRosterEntryRequest({
      profileDocumentId: null,
    }),
  ).toBe(true);
  expect(
    isUpdateOrganizationRosterEntryRequest({
      profileDocumentId: "not-a-uuid",
    }),
  ).toBe(false);
  expect(isUpdateOrganizationRosterEntryRequest({})).toBe(false);
});

test("isUpdateOrganizationProfileRequest", () => {
  expect(
    isUpdateOrganizationProfileRequest({
      profileDocumentId: "550e8400-e29b-41d4-a716-446655440001",
    }),
  ).toBe(true);
  expect(
    isUpdateOrganizationProfileRequest({
      profileDocumentId: null,
    }),
  ).toBe(true);
  expect(
    isUpdateOrganizationProfileRequest({
      profileDocumentId: "not-a-uuid",
    }),
  ).toBe(false);
  expect(isUpdateOrganizationProfileRequest({})).toBe(false);
});

test("isChallengeRequest", () => {
  const request = { fingerprint: VALID_FINGERPRINT, extension: true };
  const result = ChallengeRequestSchema.safeParse(request);
  expect(result.success).toBe(true);
  expect(result.success && result.data).toBe(request);
  expect(isChallengeRequest(request)).toBe(true);
  expect(isChallengeRequest({ fingerprint: "abc" })).toBe(false);
  expect(isChallengeRequest({ fingerprint: 123 })).toBe(false);
  expect(isChallengeRequest({})).toBe(false);
  expect(isChallengeRequest(null)).toBe(false);
});

test("isVerifyRequest", () => {
  const request = {
    extension: true,
    fingerprint: VALID_FINGERPRINT,
    signature: VALID_SIGNATURE,
  };
  const result = VerifyRequestSchema.safeParse(request);
  expect(result.success).toBe(true);
  expect(result.success && result.data).toBe(request);
  expect(isVerifyRequest(request)).toBe(true);
  expect(isVerifyRequest({ fingerprint: "abc", signature: [1, 2] })).toBe(
    false,
  );
  expect(
    isVerifyRequest({ fingerprint: VALID_FINGERPRINT, signature: [] }),
  ).toBe(false);
  expect(isVerifyRequest({ fingerprint: VALID_FINGERPRINT })).toBe(false);
  expect(isVerifyRequest({ signature: [1, 2] })).toBe(false);
  expect(isVerifyRequest(null)).toBe(false);
  // Signatures travel as canonical base64: no number arrays, no missing
  // padding, and no nonzero bits after the last byte (one encoding per value).
  const refused = [
    Array.from(signatureBytes(ML_DSA87_SIGNATURE_BYTES)),
    VALID_SIGNATURE.replace(/=+$/u, ""),
    `${VALID_SIGNATURE.slice(0, -3)}B==`,
    signatureBytes(ML_DSA87_SIGNATURE_BYTES - 1).toString("base64"),
    `${VALID_SIGNATURE.slice(0, -4)}*A==`,
  ];
  for (const signature of refused) {
    expect(isVerifyRequest({ fingerprint: VALID_FINGERPRINT, signature })).toBe(
      false,
    );
  }
});

test("isInitiateMultipartBlobStageRequest", () => {
  const firstPart = {
    byteLength: 6,
    contentMd5: "AAAAAAAAAAAAAAAAAAAAAA==",
    partNumber: 1,
  };
  const request = {
    organizationId: "fd48148f-2bb0-420d-925a-7007d5c1c40f",
    byteLength: 6,
    firstParts: [firstPart],
    sha256: "sha256-1",
  };
  expect(isInitiateMultipartBlobStageRequest(request)).toBe(true);
  expect(
    isInitiateMultipartBlobStageRequest({ ...request, byteLength: 0 }),
  ).toBe(false);
  for (const firstParts of [
    [],
    Array.from({ length: MAX_INITIATE_PART_UPLOADS + 1 }, () => firstPart),
    [{ ...firstPart, contentMd5: "not-md5" }],
    [{ ...firstPart, partNumber: 0 }],
    [{ ...firstPart, unknown: true }],
  ]) {
    expect(
      isInitiateMultipartBlobStageRequest({ ...request, firstParts }),
    ).toBe(false);
  }
  expect(
    isInitiateMultipartBlobStageRequest({ byteLength: 6, sha256: "sha256-1" }),
  ).toBe(false);
  expect(isInitiateMultipartBlobStageRequest(null)).toBe(false);
});

test("isPutPrincipalPolicyRequest", () => {
  const request = {
    state: {
      principalType: "group",
      principalId: "550e8400-e29b-41d4-a716-446655440000",
      version: 1,
      prevStateHash: null,
      keyEpoch: 1,
      encapsulationPublicKey: "public-key",
      keyFingerprint: "fingerprint",
      grantCount: 0,
      grantRoot: "grant-root",
      membershipMode: "projection",
      membershipRoot: "root",
      memberEnvelopesRoot: "member-envelopes-root",
      projectionRoot: "projection-root",
      payloadCiphertextHash: "ciphertext-hash",
      memberCount: 1,
      externalAuthority: null,
      signedAt: new Date().toISOString(),
      signerUserId: "550e8400-e29b-41d4-a716-446655440001",
      signerUserKeyFingerprint: "policy-key-fingerprint-1",
      signature: "signature",
    },
    encryptedPayload: {
      cipherSuite: "aes-256-gcm",
      ciphertext: "ciphertext",
      ciphertextHash: "ciphertext-hash",
    },
    projection: [
      {
        userId: "550e8400-e29b-41d4-a716-446655440001",
        role: "member",
      },
    ],
    grants: [],
    memberEnvelopes: [
      {
        userId: "550e8400-e29b-41d4-a716-446655440001",
        memberKeyFingerprint: "fingerprint",
        kemCipherText: "cipher",
        wrappedKey: "wrapped",
      },
    ],
  };

  expect(isPutPrincipalPolicyRequest(request)).toBe(true);
  expect(
    isPutPrincipalPolicyRequest({ ...request, containerMutations: [] }),
  ).toBe(true);
  expect(
    OrganizationPrincipalPolicyRequestSchema.safeParse({
      ...request,
      containerMutations: [],
    }).success,
  ).toBe(true);
  const organizationMutation =
    OrganizationPrincipalPolicyRequestSchema.safeParse({
      ...request,
      containerMutations: [{ event: null }],
    });
  expect(organizationMutation.success).toBe(false);
  expect(
    organizationMutation.success
      ? []
      : organizationMutation.error.issues.map((issue) => issue.message),
  ).toContain("array exceeds 0 items");
  expect(
    isPutPrincipalPolicyRequest({
      ...request,
      containerMutations: [{ event: null }],
    }),
  ).toBe(false);
  expect(
    isPutPrincipalPolicyRequest({
      ...request,
      state: { ...request.state, principalType: "team" },
    }),
  ).toBe(false);
  expect(
    isPutPrincipalPolicyRequest({
      ...request,
      memberEnvelopes: [
        {
          ...request.memberEnvelopes[0],
          userId: 42,
        },
      ],
    }),
  ).toBe(false);
  expect(
    isPutPrincipalPolicyRequest({ ...request, memberEnvelopes: undefined }),
  ).toBe(false);
  for (const signedAt of [
    "2026-09-12T00:00:00Z",
    "0050-01-01T00:00:00.000Z",
    "+010000-01-01T00:00:00.000Z",
  ]) {
    expect(
      isPutPrincipalPolicyRequest({
        ...request,
        state: { ...request.state, signedAt },
      }),
    ).toBe(false);
  }
  expect(isPutPrincipalPolicyRequest(null)).toBe(false);
});

test("isCreateOrganizationGroupRequest", () => {
  const userId = "550e8400-e29b-41d4-a716-446655440001";
  const groupId = "550e8400-e29b-41d4-a716-446655440002";
  const request = {
    groupId,
    initialGroupPolicy: {
      state: {
        principalType: "group",
        principalId: groupId,
        version: 1,
        prevStateHash: null,
        keyEpoch: 1,
        encapsulationPublicKey: "public-key",
        keyFingerprint: "fingerprint",
        grantCount: 0,
        grantRoot: "grant-root",
        membershipMode: "projection",
        membershipRoot: "root",
        memberEnvelopesRoot: "member-envelopes-root",
        projectionRoot: "projection-root",
        payloadCiphertextHash: "ciphertext-hash",
        memberCount: 1,
        externalAuthority: null,
        signedAt: new Date().toISOString(),
        signerUserId: userId,
        signerUserKeyFingerprint: "policy-key-fingerprint-1",
        signature: "signature",
      },
      encryptedPayload: {
        cipherSuite: "aes-256-gcm",
        ciphertext: "ciphertext",
        ciphertextHash: "ciphertext-hash",
      },
      projection: [
        {
          userId: userId,
          role: "admin",
        },
      ],
      grants: [],
      memberEnvelopes: [
        {
          userId: userId,
          memberKeyFingerprint: "fingerprint",
          kemCipherText: "cipher",
          wrappedKey: "wrapped",
        },
      ],
    },
  };

  expect(isCreateOrganizationGroupRequest(request)).toBe(true);
  expect(isCreateOrganizationGroupRequest({ ...request, name: "" })).toBe(
    false,
  );
  expect(isCreateOrganizationGroupRequest({ ...request, name: "   " })).toBe(
    false,
  );
  expect(isCreateOrganizationGroupRequest({ ...request, groupId: "bad" })).toBe(
    false,
  );
  expect(
    isCreateOrganizationGroupRequest({
      ...request,
      groupId: groupId.toUpperCase(),
    }),
  ).toBe(false);
  expect(isCreateOrganizationGroupRequest(null)).toBe(false);
});

test("containerRekeys batches are bounded", () => {
  const rekey = {
    event: { eventType: "container.rekey" },
    body: { eventType: "container.rekey" },
    expectedManifestHash: "manifest-hash",
    manifest: { objectKind: "container" },
    principalPolicyRefs: [],
    keyEpoch: { id: "epoch" },
    predecessorBridge: null,
    keyring: null,
    wraps: [{ containerKeyEpochId: "epoch" }],
  };
  expect(
    isOptionalContainerMutationRequestArray(
      Array.from({ length: MAX_INLINE_CONTAINER_REKEYS }, () => rekey),
    ),
  ).toBe(true);
  // Each rotation ships a keyring sized by its epoch, so an unbounded batch
  // is an unbounded request body.
  expect(
    isOptionalContainerMutationRequestArray(
      Array.from({ length: MAX_INLINE_CONTAINER_REKEYS + 1 }, () => rekey),
    ),
  ).toBe(false);
});
