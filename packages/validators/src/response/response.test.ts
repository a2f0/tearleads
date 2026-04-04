import { expect, test } from "bun:test";
import {
  isChallengeErrorResponse,
  isChallengeResponse,
  isCommitDocumentChangeResponse,
  isCreateContainerResponse,
  isHealthResponse,
  isPublicKeyResponse,
  isStageBlobResponse,
  isVerifyResponse,
} from "./index";

test("isHealthResponse", () => {
  expect(isHealthResponse({ message: "ok" })).toBe(true);
  expect(isHealthResponse({ message: 123 })).toBe(false);
  expect(isHealthResponse({})).toBe(false);
  expect(isHealthResponse(null)).toBe(false);
});

test("isPublicKeyResponse", () => {
  expect(
    isPublicKeyResponse({
      message: "ok",
      userId: "abc-123",
      organizationId: "org-456",
      rootContainerId: "ctr-789",
      challenge: "deadbeef",
    }),
  ).toBe(true);
  expect(
    isPublicKeyResponse({
      message: "ok",
      userId: "abc-123",
      challenge: "deadbeef",
    }),
  ).toBe(false);
  expect(isPublicKeyResponse({ message: "ok" })).toBe(false);
  expect(isPublicKeyResponse({ message: 123 })).toBe(false);
  expect(isPublicKeyResponse({})).toBe(false);
  expect(isPublicKeyResponse(null)).toBe(false);
});

test("isChallengeResponse", () => {
  expect(isChallengeResponse({ challenge: "hex" })).toBe(true);
  expect(isChallengeResponse({ challenge: 123 })).toBe(false);
  expect(isChallengeResponse({})).toBe(false);
  expect(isChallengeResponse(null)).toBe(false);
});

test("isChallengeErrorResponse", () => {
  expect(isChallengeErrorResponse({ error: "not found" })).toBe(true);
  expect(isChallengeErrorResponse({ error: 123 })).toBe(false);
  expect(isChallengeErrorResponse({})).toBe(false);
  expect(isChallengeErrorResponse(null)).toBe(false);
});

test("isVerifyResponse", () => {
  expect(isVerifyResponse({ authenticated: true })).toBe(true);
  expect(isVerifyResponse({ authenticated: true, token: "abc123" })).toBe(true);
  expect(isVerifyResponse({ authenticated: false, error: "bad sig" })).toBe(
    true,
  );
  expect(isVerifyResponse({ authenticated: false })).toBe(true);
  expect(isVerifyResponse({ authenticated: "yes" })).toBe(false);
  expect(isVerifyResponse({ authenticated: true, token: 123 })).toBe(false);
  expect(isVerifyResponse({ authenticated: true, error: 123 })).toBe(false);
  expect(isVerifyResponse({})).toBe(false);
  expect(isVerifyResponse(null)).toBe(false);
});

test("isStageBlobResponse", () => {
  expect(
    isStageBlobResponse({
      stageId: "stage_01",
      expiresAt: new Date().toISOString(),
    }),
  ).toBe(true);
  expect(isStageBlobResponse({ stageId: "stage_01" })).toBe(false);
  expect(isStageBlobResponse(null)).toBe(false);
});

test("isCommitDocumentChangeResponse", () => {
  expect(
    isCommitDocumentChangeResponse({
      currentAccessEpoch: 2,
      acceptedOutgoingUpdateIds: ["update_01"],
      committedBindings: [
        {
          slotId: "slot_01",
          bindingId: "binding_01",
          blobId: "blob_01",
        },
      ],
      detachedBindingIds: ["binding_old"],
    }),
  ).toBe(true);
  expect(
    isCommitDocumentChangeResponse({
      currentAccessEpoch: 2,
      acceptedOutgoingUpdateIds: [],
      committedBindings: [
        {
          slotId: "slot_01",
          bindingId: "binding_01",
        },
      ],
      detachedBindingIds: [],
    }),
  ).toBe(false);
  expect(isCommitDocumentChangeResponse(null)).toBe(false);
});

test("isCreateContainerResponse", () => {
  expect(
    isCreateContainerResponse({
      id: "ctr-123",
      organizationId: "org-123",
      parentId: "ctr-root",
    }),
  ).toBe(true);
  expect(
    isCreateContainerResponse({
      id: "ctr-123",
      organizationId: "org-123",
    }),
  ).toBe(false);
  expect(isCreateContainerResponse(null)).toBe(false);
});
