import { expect, test } from "bun:test";
import {
  isRegistrationResponse,
  isVerifyResponse,
  RegistrationResponseSchema,
  VerifyFailureResponseSchema,
  VerifySuccessResponseSchema,
} from "./index";

const VALID_CHALLENGE = "a".repeat(64);

function createDocumentCreateResponse() {
  return {
    id: "550e8400-e29b-41d4-a716-446655440001",
    createdAt: new Date().toISOString(),
    accessManifest: {
      event: {
        event: { eventType: "document.link" },
        body: { eventType: "document.link" },
        eventHash: "document-event-hash",
      },
      manifest: { objectType: "document", objectId: "doc-1" },
      manifestHash: "manifest-hash",
      state: { objectId: "doc-1" },
    },
    contentKeyBundle: {
      documentId: "550e8400-e29b-41d4-a716-446655440001",
      contentKeyEpoch: 1,
      linkSetManifestHash: "document-link-set-hash",
      targetHash: "target-hash",
      targets: [
        {
          containerId: "550e8400-e29b-41d4-a716-446655440000",
          containerManifestHash: "container-manifest-hash",
          containerKeyEpochId: "container-key-epoch-id",
          containerKeyEpoch: 1,
          wrappedKey: "wrapped-key",
          wrappingMetadata: {},
        },
      ],
    },
    documentKekTargets: {
      documentId: "550e8400-e29b-41d4-a716-446655440001",
      linkSetManifestHash: "document-link-set-hash",
      linkedContainerManifestHashes: ["container-manifest-hash"],
      linkedContainerKeyEpochIds: ["container-key-epoch-id"],
      targets: [{ containerId: "550e8400-e29b-41d4-a716-446655440000" }],
      documentKeyTargetHash: "target-hash",
    },
  };
}

test("isRegistrationResponse", () => {
  const response = {
    userId: "abc-123",
    organizationId: "org-456",
    rootContainerId: "ctr-789",
    rootMetadataDocumentId: "doc-root",
    rootMetadataAccessEpoch: 1,
    rootMetadataAccessStateHash: "root-access-state-hash",
    rootMetadataDocument: createDocumentCreateResponse(),
    committedCoreMetadataUpdateIds: [],
    committedProfileUpdateIds: [],
    systemContainers: [],
    challenge: VALID_CHALLENGE,
  };
  const responseResult = RegistrationResponseSchema.safeParse(response);
  expect(responseResult.success).toBe(true);
  expect(responseResult.success && responseResult.data).toBe(response);
  expect(isRegistrationResponse(response)).toBe(true);
  for (const key of [
    "committedCoreMetadataUpdateIds",
    "committedProfileUpdateIds",
    "systemContainers",
  ] as const) {
    const missingAcknowledgement = { ...response };
    Reflect.deleteProperty(missingAcknowledgement, key);
    expect(isRegistrationResponse(missingAcknowledgement)).toBe(false);
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
    authenticated: true as const,
    extension: true,
    organizationId: "org-1",
    token: "abc123",
    userId: "user-1",
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
