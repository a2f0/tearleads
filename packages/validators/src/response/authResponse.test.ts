import { expect, test } from "bun:test";
import { isRegistrationResponse, isVerifyResponse } from "./index";

const VALID_ACCOUNT = {
  disabledAt: null,
  purgeAfter: null,
  purgeStartedAt: null,
  purgedAt: null,
  remoteDataEpoch: 1,
  status: "trialing",
  trialEndsAt: "2026-06-08T00:00:00.000Z",
};
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
  expect(
    isRegistrationResponse({
      account: VALID_ACCOUNT,
      userId: "abc-123",
      organizationId: "org-456",
      rootContainerId: "ctr-789",
      rootMetadataDocumentId: "doc-root",
      rootMetadataAccessEpoch: 1,
      rootMetadataAccessStateHash: "root-access-state-hash",
      rootMetadataDocument: createDocumentCreateResponse(),
      challenge: VALID_CHALLENGE,
    }),
  ).toBe(true);
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
  expect(isVerifyResponse({ authenticated: true })).toBe(false);
  expect(
    isVerifyResponse({
      account: VALID_ACCOUNT,
      authenticated: true,
      organizationId: "org-1",
      token: "abc123",
      userId: "user-1",
    }),
  ).toBe(true);
  expect(isVerifyResponse({ authenticated: true, token: "abc123" })).toBe(
    false,
  );
  expect(isVerifyResponse({ authenticated: false, error: "bad sig" })).toBe(
    true,
  );
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
