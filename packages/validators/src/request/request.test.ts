import { expect, test } from "bun:test";
import {
  isChallengeRequest,
  isCommitDocumentChangeRequest,
  isCreateContainerRequest,
  isLinkDocumentToContainerRequest,
  isMoveContainerRequest,
  isPublicKeyRequest,
  isPutPrincipalMemberEnvelopesRequest,
  isPutPrincipalStateRequest,
  isShareContainerRequest,
  isStageBlobRequest,
  isVerifyRequest,
} from "./index";

test("isPublicKeyRequest", () => {
  const validEnvelope = {
    keyFingerprint: "abc123",
    kemCipherText: [1, 2, 3],
    wrappedKey: [4, 5, 6],
  };
  expect(
    isPublicKeyRequest({
      rootContainerId: "550e8400-e29b-41d4-a716-446655440000",
      signingPublicKey: [1, 2, 3],
      encapsulationPublicKey: [4, 5, 6],
      initialRootMetadataUpdates: [],
      wrappedDekEnvelope: validEnvelope,
    }),
  ).toBe(true);
  expect(
    isPublicKeyRequest({
      rootContainerId: "not-a-uuid",
      signingPublicKey: [1, 2, 3],
      encapsulationPublicKey: [4, 5, 6],
      initialRootMetadataUpdates: [],
      wrappedDekEnvelope: validEnvelope,
    }),
  ).toBe(false);
  expect(
    isPublicKeyRequest({
      rootContainerId: "550e8400-e29b-41d4-a716-446655440000",
      signingPublicKey: [],
      encapsulationPublicKey: [],
      initialRootMetadataUpdates: [],
      wrappedDekEnvelope: validEnvelope,
    }),
  ).toBe(true);
  expect(
    isPublicKeyRequest({
      signingPublicKey: [1, 2, 3],
      encapsulationPublicKey: [4, 5, 6],
    }),
  ).toBe(false);
  expect(
    isPublicKeyRequest({
      signingPublicKey: [1, 2, 3],
      encapsulationPublicKey: [4, 5, 6],
      wrappedDekEnvelope: {
        keyFingerprint: 123,
        kemCipherText: [],
        wrappedKey: [],
      },
    }),
  ).toBe(false);
  expect(
    isPublicKeyRequest({
      signingPublicKey: "not-array",
      encapsulationPublicKey: [1],
      wrappedDekEnvelope: validEnvelope,
    }),
  ).toBe(false);
  expect(
    isPublicKeyRequest({
      signingPublicKey: [1],
      encapsulationPublicKey: ["a"],
      wrappedDekEnvelope: validEnvelope,
    }),
  ).toBe(false);
  expect(isPublicKeyRequest({ signingPublicKey: [1] })).toBe(false);
  expect(isPublicKeyRequest({ encapsulationPublicKey: [1] })).toBe(false);
  expect(isPublicKeyRequest({})).toBe(false);
  expect(isPublicKeyRequest(null)).toBe(false);
});

test("isChallengeRequest", () => {
  expect(isChallengeRequest({ fingerprint: "abc" })).toBe(true);
  expect(isChallengeRequest({ fingerprint: 123 })).toBe(false);
  expect(isChallengeRequest({})).toBe(false);
  expect(isChallengeRequest(null)).toBe(false);
});

test("isVerifyRequest", () => {
  expect(isVerifyRequest({ fingerprint: "abc", signature: [1, 2] })).toBe(true);
  expect(isVerifyRequest({ fingerprint: "abc", signature: [] })).toBe(true);
  expect(isVerifyRequest({ fingerprint: "abc" })).toBe(false);
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

test("isCommitDocumentChangeRequest", () => {
  expect(
    isCommitDocumentChangeRequest({
      accessEpoch: 1,
      expectedAccessStateHash: "access-state-1",
      attachmentCommits: [
        {
          slotId: "slot_01",
          stageId: "stage_01",
          expectedBindingId: null,
        },
      ],
      attachmentDetaches: [],
      attachmentRewraps: [],
      loroUpdate: {
        checkpointKind: "fresh_baseline",
        id: "update_01",
        encryptedData: "encrypted",
        partialStartVersionVector: "{}",
        partialEndVersionVector: '{"a":1}',
        sourceVersionVector: '{"a":1}',
        referencedSlotIds: ["slot_01"],
      },
    }),
  ).toBe(true);
  expect(
    isCommitDocumentChangeRequest({
      accessEpoch: 1,
      attachmentCommits: [],
      attachmentDetaches: [],
      attachmentRewraps: [],
      loroUpdate: null,
    }),
  ).toBe(false);
  expect(
    isCommitDocumentChangeRequest({
      accessEpoch: 1,
      attachmentCommits: [],
      attachmentDetaches: [],
      attachmentRewraps: [],
      loroUpdate: {
        id: "update_01",
        encryptedData: "encrypted",
        partialStartVersionVector: "{}",
        referencedSlotIds: [],
      },
    }),
  ).toBe(false);
  expect(isCommitDocumentChangeRequest(null)).toBe(false);
});

test("isCreateContainerRequest", () => {
  expect(
    isCreateContainerRequest({
      expectedAccessStateHash: "access-state-1",
      id: "550e8400-e29b-41d4-a716-446655440000",
      parentId: "550e8400-e29b-41d4-a716-446655440001",
      initialMetadataUpdates: [],
    }),
  ).toBe(true);
  expect(
    isCreateContainerRequest({
      expectedAccessStateHash: "access-state-1",
      id: "550e8400-e29b-41d4-a716-446655440000",
      initialMetadataUpdates: [],
    }),
  ).toBe(false);
  expect(
    isCreateContainerRequest({
      expectedAccessStateHash: "",
      id: "550e8400-e29b-41d4-a716-446655440000",
      parentId: "550e8400-e29b-41d4-a716-446655440001",
      initialMetadataUpdates: [],
    }),
  ).toBe(false);
  expect(
    isCreateContainerRequest({
      expectedAccessStateHash: "access-state-1",
      id: "not-a-uuid",
      parentId: "550e8400-e29b-41d4-a716-446655440001",
      initialMetadataUpdates: [],
    }),
  ).toBe(false);
  expect(isCreateContainerRequest(null)).toBe(false);
});

test("isShareContainerRequest", () => {
  expect(
    isShareContainerRequest({
      expectedAccessStateHash: "access-state-1",
      subjectType: "user",
      subjectId: "550e8400-e29b-41d4-a716-446655440000",
      accessLevel: "write",
    }),
  ).toBe(true);
  expect(
    isShareContainerRequest({
      expectedAccessStateHash: "access-state-1",
      subjectType: "team",
      subjectId: "550e8400-e29b-41d4-a716-446655440000",
      accessLevel: "write",
    }),
  ).toBe(false);
  expect(
    isShareContainerRequest({
      expectedAccessStateHash: "access-state-1",
      subjectType: "user",
      subjectId: "not-a-uuid",
      accessLevel: "write",
    }),
  ).toBe(false);
  expect(
    isShareContainerRequest({
      expectedAccessStateHash: "",
      subjectType: "user",
      subjectId: "550e8400-e29b-41d4-a716-446655440000",
      accessLevel: "write",
    }),
  ).toBe(false);
  expect(isShareContainerRequest(null)).toBe(false);
});

test("isMoveContainerRequest", () => {
  expect(
    isMoveContainerRequest({
      expectedAccessStateHash: "access-state-1",
      parentId: "550e8400-e29b-41d4-a716-446655440000",
    }),
  ).toBe(true);
  expect(
    isMoveContainerRequest({
      expectedAccessStateHash: "access-state-1",
      parentId: "not-a-uuid",
    }),
  ).toBe(false);
  expect(
    isMoveContainerRequest({
      expectedAccessStateHash: "",
      parentId: "550e8400-e29b-41d4-a716-446655440000",
    }),
  ).toBe(false);
  expect(isMoveContainerRequest(null)).toBe(false);
});

test("isLinkDocumentToContainerRequest", () => {
  expect(
    isLinkDocumentToContainerRequest({
      containerId: "550e8400-e29b-41d4-a716-446655440000",
      expectedAccessStateHash: "access-state-1",
    }),
  ).toBe(true);
  expect(
    isLinkDocumentToContainerRequest({
      containerId: "not-a-uuid",
      expectedAccessStateHash: "access-state-1",
    }),
  ).toBe(false);
  expect(
    isLinkDocumentToContainerRequest({
      containerId: "550e8400-e29b-41d4-a716-446655440000",
      expectedAccessStateHash: "",
    }),
  ).toBe(false);
  expect(isLinkDocumentToContainerRequest(null)).toBe(false);
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
        membershipMode: "projection_v1",
        membershipRoot: "root",
        projectionRoot: "projection-root",
        payloadCiphertextHash: "ciphertext-hash",
        memberCount: 1,
        signedAt: new Date().toISOString(),
        signerKeyId: "policy-key-1",
        signature: "signature",
      },
      encryptedPayload: {
        cipherSuite: "aes-256-gcm-v1",
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
        membershipMode: "projection_v1",
        membershipRoot: "root",
        projectionRoot: "projection-root",
        payloadCiphertextHash: "ciphertext-hash",
        memberCount: 0,
        signedAt: new Date().toISOString(),
        signerKeyId: "policy-key-1",
        signature: "signature",
      },
      encryptedPayload: {
        cipherSuite: "aes-256-gcm-v1",
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
  expect(isPutPrincipalMemberEnvelopesRequest(null)).toBe(false);
});
