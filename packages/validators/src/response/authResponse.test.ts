import { expect, test } from "bun:test";
import {
  isOrganizationProvisioningResponse,
  isRegistrationResponse,
  isVerifyResponse,
  RegistrationResponseSchema,
  VerifyFailureResponseSchema,
  VerifySuccessResponseSchema,
} from "./index";

const VALID_CHALLENGE = "a".repeat(64);

function createDocumentCreateResponse() {
  return {
    bundleDigest: "b".repeat(64),
    contentKeyEpoch: 1,
    createdAt: "2026-01-01T00:00:00.000Z",
    eventHash: "event-hash",
    id: "doc-root",
    manifestHash: "manifest-hash",
    targetHash: "target-hash",
  };
}

function createMetadataContainerResponse() {
  const metadataDocument = createDocumentCreateResponse();
  return {
    container: {
      bundleDigest: "b".repeat(64),
      containerId: "ctr-organization-metadata",
      containerKek: {
        containerKeyEpoch: 1,
        containerKeyEpochId: "key-epoch-id",
        keyEpochHash: "key-epoch-hash",
        keyringHash: null,
        keyTargetHash: "key-target-hash",
        parentContainerKeyEpochId: null,
      },
      createdAt: new Date().toISOString(),
      eventHash: "event-hash",
      manifestHead: { epoch: 1, manifestHash: "manifest-hash" },
      organizationId: "org-456",
      parentId: null,
      updatedAt: new Date().toISOString(),
    },
    metadataDocument,
  };
}

test("isRegistrationResponse", () => {
  const response = {
    userId: "abc-123",
    organizationId: "org-456",
    organizationMetadataContainer: createMetadataContainerResponse(),
    organizationMetadataContainerId: "ctr-organization-metadata",
    rootBundleDigest: "b".repeat(64),
    rootContainerId: "ctr-789",
    rootMetadataDocumentId: "doc-root",
    rootMetadataAccessEpoch: 1,
    rootMetadataAccessStateHash: "root-access-state-hash",
    rootMetadataDocument: createDocumentCreateResponse(),
    committedCoreMetadataUpdateIds: [],
    committedProfileUpdateIds: [],
    commitLsn: "0/16B3748",
    commitLsnMode: "tracked" as const,
    systemContainers: [],
    challenge: VALID_CHALLENGE,
  };
  const responseResult = RegistrationResponseSchema.safeParse(response);
  expect(responseResult.success).toBe(true);
  expect(responseResult.success && responseResult.data).toBe(response);
  expect(isRegistrationResponse(response)).toBe(true);
  expect(isOrganizationProvisioningResponse(response)).toBe(true);
  for (const key of ["commitLsn", "commitLsnMode"] as const) {
    // Only registration reports a commit position.
    const missingPosition = { ...response };
    Reflect.deleteProperty(missingPosition, key);
    expect(isRegistrationResponse(missingPosition)).toBe(false);
    expect(isOrganizationProvisioningResponse(missingPosition)).toBe(true);
  }
  for (const key of [
    "committedCoreMetadataUpdateIds",
    "committedProfileUpdateIds",
    "systemContainers",
    "organizationMetadataContainer",
    "organizationMetadataContainerId",
  ] as const) {
    const missingAcknowledgement = { ...response };
    Reflect.deleteProperty(missingAcknowledgement, key);
    expect(isRegistrationResponse(missingAcknowledgement)).toBe(false);
    expect(isOrganizationProvisioningResponse(missingAcknowledgement)).toBe(
      false,
    );
  }
  // The position is a WAL LSN or, when it could not be read, null; only the
  // untracked mode carries the 0/0 sentinel.
  for (const [checkpoint, valid] of [
    [{ commitLsn: null, commitLsnMode: "tracked" }, true],
    [{ commitLsn: "0/0", commitLsnMode: "untracked" }, true],
    [{ commitLsn: "not-a-wal-lsn", commitLsnMode: "tracked" }, false],
    [{ commitLsn: "0/0", commitLsnMode: "tracked" }, false],
    [{ commitLsn: "0/16B3748", commitLsnMode: "untracked" }, false],
  ] as const) {
    expect(isRegistrationResponse({ ...response, ...checkpoint })).toBe(valid);
  }
  expect(
    isRegistrationResponse({
      ...response,
      committedCoreMetadataUpdateIds: [
        "550e8400-e29b-41d4-a716-446655440007",
        "550e8400-e29b-41d4-a716-446655440008",
        "550e8400-e29b-41d4-a716-446655440009",
      ],
    }),
  ).toBe(true);
  expect(
    isRegistrationResponse({
      ...response,
      committedCoreMetadataUpdateIds: ["not-an-update-id"],
    }),
  ).toBe(false);
  const duplicateUpdateId = "550e8400-e29b-41d4-a716-446655440007";
  expect(
    isRegistrationResponse({
      ...response,
      committedCoreMetadataUpdateIds: [duplicateUpdateId, duplicateUpdateId],
    }),
  ).toBe(false);
  expect(
    isRegistrationResponse({
      ...response,
      committedProfileUpdateIds: [
        "550e8400-e29b-41d4-a716-446655440010",
        "550e8400-e29b-41d4-a716-446655440011",
      ],
    }),
  ).toBe(true);
  expect(
    isRegistrationResponse({
      ...response,
      committedProfileUpdateIds: ["not-an-update-id"],
    }),
  ).toBe(false);
  expect(
    isRegistrationResponse({
      userId: "abc-123",
      challenge: VALID_CHALLENGE,
    }),
  ).toBe(false);
  expect(isRegistrationResponse({})).toBe(false);
  expect(isRegistrationResponse(null)).toBe(false);
});

test("isVerifyResponse", () => {
  const successResponse = {
    rootContainerId: null,
    authenticated: true as const,
    extension: true,
    isRoot: false,
    organizationId: "org-1",
    token: "abc123",
    userId: "user-1",
    wsTicket: "ticket-1",
  };
  const successResult = VerifySuccessResponseSchema.safeParse(successResponse);
  expect(successResult.success).toBe(true);
  expect(successResult.success && successResult.data).toBe(successResponse);
  const failureResponse = {
    authenticated: false as const,
    error: "bad sig",
    extension: true,
  };
  const failureResult = VerifyFailureResponseSchema.safeParse(failureResponse);
  expect(failureResult.success).toBe(true);
  expect(failureResult.success && failureResult.data).toBe(failureResponse);

  expect(isVerifyResponse({ authenticated: true })).toBe(false);
  expect(isVerifyResponse(successResponse)).toBe(true);
  // The first websocket ticket is a required part of a successful login.
  const { wsTicket: _omitted, ...withoutTicket } = successResponse;
  expect(isVerifyResponse(withoutTicket)).toBe(false);
  expect(isVerifyResponse({ ...successResponse, wsTicket: "" })).toBe(false);
  expect(isVerifyResponse({ authenticated: false, wsTicket: "ticket-1" })).toBe(
    false,
  );
  expect(isVerifyResponse({ authenticated: true, token: "abc123" })).toBe(
    false,
  );
  expect(isVerifyResponse(failureResponse)).toBe(true);
  expect(isVerifyResponse({ authenticated: false })).toBe(true);
  expect(isVerifyResponse({ authenticated: false, token: "abc123" })).toBe(
    false,
  );
  expect(isVerifyResponse({ authenticated: "yes" })).toBe(false);
  expect(isVerifyResponse({ authenticated: true, token: 123 })).toBe(false);
  expect(isVerifyResponse({ authenticated: true, error: 123 })).toBe(false);
  expect(
    isVerifyResponse({
      authenticated: false,
      organizationId: "org-1",
      userId: "user-1",
    }),
  ).toBe(false);
  expect(isVerifyResponse({})).toBe(false);
  expect(isVerifyResponse(null)).toBe(false);
});
