import { expect, test } from "bun:test";
import {
  isChallengeRequest,
  isCommitDocumentChangeRequest,
  isCreateContainerRequest,
  isPublicKeyRequest,
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
      wrappedDekEnvelope: validEnvelope,
    }),
  ).toBe(true);
  expect(
    isPublicKeyRequest({
      rootContainerId: "550e8400-e29b-41d4-a716-446655440000",
      signingPublicKey: [],
      encapsulationPublicKey: [],
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
      attachmentCommits: [
        {
          slotId: "slot_01",
          stageId: "stage_01",
          expectedBindingId: null,
        },
      ],
      attachmentDetaches: [],
      loroUpdate: {
        id: "update_01",
        encryptedData: "encrypted",
        partialStartVersionVector: "{}",
        partialEndVersionVector: '{"a":1}',
        referencedSlotIds: ["slot_01"],
      },
    }),
  ).toBe(true);
  expect(
    isCommitDocumentChangeRequest({
      accessEpoch: 1,
      attachmentCommits: [],
      attachmentDetaches: [],
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
      id: "550e8400-e29b-41d4-a716-446655440000",
      parentId: "550e8400-e29b-41d4-a716-446655440001",
    }),
  ).toBe(true);
  expect(
    isCreateContainerRequest({
      id: "550e8400-e29b-41d4-a716-446655440000",
    }),
  ).toBe(false);
  expect(isCreateContainerRequest(null)).toBe(false);
});
