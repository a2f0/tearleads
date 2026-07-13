import { expect, test } from "bun:test";
import { ML_DSA87_SIGNATURE_BYTES } from "../util";
import {
  isChallengeRequest,
  isCompleteMultipartBlobStageRequest,
  isCreateOrganizationGroupRequest,
  isInitiateMultipartBlobStageRequest,
  isPutPrincipalMemberEnvelopesRequest,
  isPutPrincipalStateRequest,
  isStageBlobRequest,
  isUpdateOrganizationProfileRequest,
  isUpdateOrganizationRosterEntryRequest,
  isUploadMultipartBlobPartRequest,
  isVerifyRequest,
} from "./index";

const VALID_FINGERPRINT = "a".repeat(64);
const VALID_SIGNATURE = Array.from(
  { length: ML_DSA87_SIGNATURE_BYTES },
  (_, index) => index % 256,
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
  expect(isChallengeRequest({ fingerprint: VALID_FINGERPRINT })).toBe(true);
  expect(isChallengeRequest({ fingerprint: "abc" })).toBe(false);
  expect(isChallengeRequest({ fingerprint: 123 })).toBe(false);
  expect(isChallengeRequest({})).toBe(false);
  expect(isChallengeRequest(null)).toBe(false);
});

test("isVerifyRequest", () => {
  expect(
    isVerifyRequest({
      fingerprint: VALID_FINGERPRINT,
      signature: VALID_SIGNATURE,
    }),
  ).toBe(true);
  expect(isVerifyRequest({ fingerprint: "abc", signature: [1, 2] })).toBe(
    false,
  );
  expect(
    isVerifyRequest({ fingerprint: VALID_FINGERPRINT, signature: [] }),
  ).toBe(false);
  expect(isVerifyRequest({ fingerprint: VALID_FINGERPRINT })).toBe(false);
  expect(isVerifyRequest({ signature: [1, 2] })).toBe(false);
  expect(isVerifyRequest(null)).toBe(false);
});

test("isStageBlobRequest", () => {
  expect(
    isStageBlobRequest({
      encryptedBytes: "YWJj",
      byteLength: 3,
      sha256: "sha256-1",
    }),
  ).toBe(true);
  expect(
    isStageBlobRequest({
      encryptedBytes: "YWJj",
      byteLength: 0,
      sha256: "sha256-1",
    }),
  ).toBe(false);
  expect(isStageBlobRequest(null)).toBe(false);
});

test("isInitiateMultipartBlobStageRequest", () => {
  expect(
    isInitiateMultipartBlobStageRequest({
      byteLength: 6,
      sha256: "sha256-1",
    }),
  ).toBe(true);
  expect(
    isInitiateMultipartBlobStageRequest({
      byteLength: 0,
      sha256: "sha256-1",
    }),
  ).toBe(false);
  expect(isInitiateMultipartBlobStageRequest(null)).toBe(false);
});

test("isUploadMultipartBlobPartRequest", () => {
  expect(
    isUploadMultipartBlobPartRequest({
      encryptedBytes: "part-1",
      uploadId: "upload-1",
    }),
  ).toBe(true);
  expect(
    isUploadMultipartBlobPartRequest({
      encryptedBytes: "",
      uploadId: "upload-1",
    }),
  ).toBe(false);
  expect(isUploadMultipartBlobPartRequest(null)).toBe(false);
});

test("isCompleteMultipartBlobStageRequest", () => {
  expect(
    isCompleteMultipartBlobStageRequest({
      uploadId: "upload-1",
      parts: [{ partNumber: 1, etag: "etag-1" }],
    }),
  ).toBe(true);
  expect(
    isCompleteMultipartBlobStageRequest({
      uploadId: "upload-1",
      parts: [],
    }),
  ).toBe(false);
  expect(
    isCompleteMultipartBlobStageRequest({
      uploadId: "upload-1",
      parts: [{ partNumber: 0, etag: "etag-1" }],
    }),
  ).toBe(false);
  expect(isCompleteMultipartBlobStageRequest(null)).toBe(false);
});

test("isPutPrincipalStateRequest", () => {
  expect(
    isPutPrincipalStateRequest({
      state: {
        principalType: "group",
        principalId: "550e8400-e29b-41d4-a716-446655440000",
        version: 1,
        prevStateHash: null,
        keyEpoch: 1,
        encapsulationPublicKey: "public-key",
        keyFingerprint: "fingerprint",
        membershipMode: "projection",
        membershipRoot: "root",
        projectionRoot: "projection-root",
        payloadCiphertextHash: "ciphertext-hash",
        memberCount: 1,
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
          memberPrincipalType: "user",
          memberPrincipalId: "550e8400-e29b-41d4-a716-446655440001",
          role: "member",
        },
      ],
    }),
  ).toBe(true);
  expect(
    isPutPrincipalStateRequest({
      state: {
        principalType: "team",
        principalId: "550e8400-e29b-41d4-a716-446655440000",
        version: 1,
        prevStateHash: null,
        keyEpoch: 1,
        encapsulationPublicKey: "public-key",
        keyFingerprint: "fingerprint",
        membershipMode: "projection",
        membershipRoot: "root",
        projectionRoot: "projection-root",
        payloadCiphertextHash: "ciphertext-hash",
        memberCount: 0,
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
      projection: [],
    }),
  ).toBe(false);
  expect(isPutPrincipalStateRequest(null)).toBe(false);
});

test("isPutPrincipalMemberEnvelopesRequest", () => {
  expect(
    isPutPrincipalMemberEnvelopesRequest({
      stateHash: "state-hash",
      envelopes: [
        {
          memberPrincipalType: "user",
          memberPrincipalId: "550e8400-e29b-41d4-a716-446655440000",
          memberKeyFingerprint: "fingerprint",
          kemCipherText: "cipher",
          wrappedKey: "wrapped",
        },
      ],
    }),
  ).toBe(true);
  expect(
    isPutPrincipalMemberEnvelopesRequest({
      stateHash: "state-hash",
      envelopes: [
        {
          memberPrincipalType: "organization",
          memberPrincipalId: "550e8400-e29b-41d4-a716-446655440000",
          memberKeyFingerprint: "fingerprint",
          kemCipherText: "cipher",
          wrappedKey: "wrapped",
        },
      ],
    }),
  ).toBe(false);
  expect(
    isPutPrincipalMemberEnvelopesRequest({
      stateHash: "",
      envelopes: [],
    }),
  ).toBe(false);
  expect(isPutPrincipalMemberEnvelopesRequest(null)).toBe(false);
});

test("isCreateOrganizationGroupRequest", () => {
  const userId = "550e8400-e29b-41d4-a716-446655440001";
  const groupId = "550e8400-e29b-41d4-a716-446655440002";
  const request = {
    groupId,
    name: "Operators",
    initialGroupPolicy: {
      state: {
        principalType: "group",
        principalId: groupId,
        version: 1,
        prevStateHash: null,
        keyEpoch: 1,
        encapsulationPublicKey: "public-key",
        keyFingerprint: "fingerprint",
        membershipMode: "projection",
        membershipRoot: "root",
        projectionRoot: "projection-root",
        payloadCiphertextHash: "ciphertext-hash",
        memberCount: 1,
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
          memberPrincipalType: "user",
          memberPrincipalId: userId,
          role: "admin",
        },
      ],
      memberEnvelopes: [
        {
          memberPrincipalType: "user",
          memberPrincipalId: userId,
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
  expect(isCreateOrganizationGroupRequest(null)).toBe(false);
});
