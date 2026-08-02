import { expect, test } from "bun:test";
import {
  ML_DSA87_PUBLIC_KEY_BYTES,
  ML_KEM1024_PUBLIC_KEY_BYTES,
} from "../util";
import { isRegistrationRequest } from "./index";
import { createDocumentContentKeyBundle } from "./requestTestFixtures";

const VALID_SIGNING_PUBLIC_KEY = Array.from(
  { length: ML_DSA87_PUBLIC_KEY_BYTES },
  (_, index) => index % 256,
);
const VALID_ENCAPSULATION_PUBLIC_KEY = Array.from(
  { length: ML_KEM1024_PUBLIC_KEY_BYTES },
  (_, index) => index % 256,
);

test("isRegistrationRequest", () => {
  const userId = "550e8400-e29b-41d4-a716-446655440001";
  const organizationId = "550e8400-e29b-41d4-a716-446655440002";
  const adminGroupId = "550e8400-e29b-41d4-a716-446655440003";
  const memberGroupId = "550e8400-e29b-41d4-a716-446655440004";
  const validInitialOrganizationPolicy = {
    state: {
      principalType: "organization" as const,
      principalId: organizationId,
      version: 1,
      prevStateHash: null,
      keyEpoch: 1,
      encapsulationPublicKey: "public-key",
      keyFingerprint: "key-fingerprint",
      membershipMode: "projection" as const,
      membershipRoot: "membership-root",
      memberEnvelopesRoot: "member-envelopes-root",
      projectionRoot: "projection-root",
      payloadCiphertextHash: "ciphertext-hash",
      memberCount: 1,
      externalAuthority: null,
      signedAt: new Date().toISOString(),
      signerUserId: userId,
      signerUserKeyFingerprint: "signing-fingerprint",
      signature: "signature",
    },
    encryptedPayload: {
      cipherSuite: "aes-256-gcm" as const,
      ciphertext: "ciphertext",
      ciphertextHash: "ciphertext-hash",
    },
    projection: [
      {
        memberPrincipalType: "user" as const,
        memberPrincipalId: userId,
        role: "admin" as const,
      },
    ],
    memberEnvelopes: [
      {
        memberPrincipalType: "user" as const,
        memberPrincipalId: userId,
        memberKeyFingerprint: "member-key-fingerprint",
        kemCipherText: "kem-ciphertext",
        wrappedKey: "wrapped-key",
      },
    ],
  };
  const validInitialAdminGroup = {
    groupId: adminGroupId,
    name: "Admins",
    initialGroupPolicy: {
      state: {
        ...validInitialOrganizationPolicy.state,
        principalType: "group" as const,
        principalId: adminGroupId,
      },
      encryptedPayload: validInitialOrganizationPolicy.encryptedPayload,
      projection: validInitialOrganizationPolicy.projection,
      memberEnvelopes: validInitialOrganizationPolicy.memberEnvelopes,
    },
  };
  const validInitialMemberGroup = {
    groupId: memberGroupId,
    name: "Members",
    initialGroupPolicy: {
      state: {
        ...validInitialOrganizationPolicy.state,
        principalType: "group" as const,
        principalId: memberGroupId,
      },
      encryptedPayload: validInitialOrganizationPolicy.encryptedPayload,
      projection: validInitialOrganizationPolicy.projection,
      memberEnvelopes: validInitialOrganizationPolicy.memberEnvelopes,
    },
  };
  const initialUpdate = {
    id: "550e8400-e29b-41d4-a716-446655440111",
    encryptedData: "ciphertext",
    partialStartVersionVector: "{}",
    partialEndVersionVector: '{"actor":1}',
    plaintextHash: "plaintext-hash",
    writeHeader: { updateId: "550e8400-e29b-41d4-a716-446655440111" },
  };
  const createInitialSync = () => ({
    authorizingContainerPathRefs: [
      [
        {
          containerId: "container-1",
          manifestHash: "container-manifest-hash",
        },
      ],
    ],
    contentKeyEpoch: 1,
    expectedLinkSetManifestHash: "document-link-set-hash",
    expectedTargetHash: "target-hash",
    localVersionVector: '{"actor":1}',
    outgoingUpdates: [initialUpdate],
  });
  const createValidRequest = (overrides: Record<string, unknown> = {}) => ({
    userId,
    organizationId,
    rootContainerId: "550e8400-e29b-41d4-a716-446655440000",
    signingPublicKey: VALID_SIGNING_PUBLIC_KEY,
    encapsulationPublicKey: VALID_ENCAPSULATION_PUBLIC_KEY,
    initialAdminGroup: validInitialAdminGroup,
    initialMemberGroup: validInitialMemberGroup,
    initialOrganizationPolicy: validInitialOrganizationPolicy,
    initialRootContainer: {
      event: { eventType: "container.create" },
      body: { eventType: "container.create" },
      expectedManifestHash: "container-manifest-hash",
      manifest: { objectKind: "container" },
      previousManifest: null,
      parentContainerPath: [],
      keyEpoch: { id: "container-key-epoch-id" },
      predecessorBridge: null,
      keyring: null,
      principalPolicies: [],
      wraps: [{ containerKeyEpochId: "container-key-epoch-id" }],
      userRecipientKeys: [{ userId }],
    },
    initialRootMetadataDocument: {
      event: { eventType: "document.link" },
      body: { eventType: "document.link" },
      expectedManifestHash: "document-manifest-hash",
      manifest: { objectKind: "document" },
      previousManifest: null,
      targetContainerPathRefs: [
        { containerId: "container-1", manifestHash: "container-manifest-hash" },
      ],
      contentKeyBundle: createDocumentContentKeyBundle(),
      initialSync: createInitialSync(),
    },
    ...overrides,
  });
  const initialProfileDocument = {
    ...createValidRequest().initialRootMetadataDocument,
    initialSync: createInitialSync(),
  };
  const { initialSync: _initialSync, ...baseDocument } =
    createValidRequest().initialRootMetadataDocument;
  const initialMetadataContainer = {
    container: createValidRequest().initialRootContainer,
    initialMetadataSync: createInitialSync(),
    metadataDocument: baseDocument,
  };

  expect(isRegistrationRequest(createValidRequest())).toBe(true);
  expect(
    isRegistrationRequest(
      createValidRequest({
        initialOrganizationProfileDocument: baseDocument,
        initialRosterProfileDocument: baseDocument,
      }),
    ),
  ).toBe(false);
  expect(
    isRegistrationRequest(
      createValidRequest({
        initialOrganizationProfileDocument: initialProfileDocument,
        initialRosterProfileDocument: initialProfileDocument,
      }),
    ),
  ).toBe(true);
  expect(
    isRegistrationRequest(
      createValidRequest({
        initialOrganizationProfileDocument: {
          ...initialProfileDocument,
          initialSync: {
            ...initialProfileDocument.initialSync,
            outgoingUpdates: [],
          },
        },
      }),
    ),
  ).toBe(false);
  expect(
    isRegistrationRequest(
      createValidRequest({
        initialRootMetadataDocument: baseDocument,
      }),
    ),
  ).toBe(false);
  expect(
    isRegistrationRequest(
      createValidRequest({
        initialRootMetadataDocument: {
          ...initialProfileDocument,
          initialSync: {
            ...initialProfileDocument.initialSync,
            outgoingUpdates: [],
          },
        },
      }),
    ),
  ).toBe(false);
  expect(
    isRegistrationRequest(
      createValidRequest({
        initialOrganizationMetadataContainer: initialMetadataContainer,
        initialRosterProfileContainer: initialMetadataContainer,
      }),
    ),
  ).toBe(true);
  expect(
    isRegistrationRequest(
      createValidRequest({
        initialOrganizationMetadataContainer: {
          container: initialMetadataContainer.container,
          metadataDocument: initialMetadataContainer.metadataDocument,
        },
        initialRosterProfileContainer: {
          container: initialMetadataContainer.container,
          metadataDocument: initialMetadataContainer.metadataDocument,
        },
      }),
    ),
  ).toBe(false);
  expect(
    isRegistrationRequest(
      createValidRequest({
        initialOrganizationMetadataContainer: {
          ...initialMetadataContainer,
          initialMetadataSync: {
            ...initialMetadataContainer.initialMetadataSync,
            containerRekeys: [createValidRequest().initialRootContainer],
          },
        },
      }),
    ),
  ).toBe(false);
  expect(
    isRegistrationRequest(
      createValidRequest({
        initialRosterProfileDocument: {
          ...initialProfileDocument,
          initialSync: {
            ...initialProfileDocument.initialSync,
            containerRekeys: [createValidRequest().initialRootContainer],
          },
        },
      }),
    ),
  ).toBe(false);
  expect(
    isRegistrationRequest(
      createValidRequest({ rootContainerId: "not-a-uuid" }),
    ),
  ).toBe(false);
  expect(
    isRegistrationRequest(
      createValidRequest({ organizationId: organizationId.toUpperCase() }),
    ),
  ).toBe(false);
  expect(
    isRegistrationRequest(
      createValidRequest({
        initialAdminGroup: {
          ...validInitialAdminGroup,
          groupId: adminGroupId.toUpperCase(),
        },
      }),
    ),
  ).toBe(false);
  expect(
    isRegistrationRequest(
      createValidRequest({ signingPublicKey: [], encapsulationPublicKey: [] }),
    ),
  ).toBe(false);
  expect(
    isRegistrationRequest({
      signingPublicKey: VALID_SIGNING_PUBLIC_KEY,
      encapsulationPublicKey: VALID_ENCAPSULATION_PUBLIC_KEY,
    }),
  ).toBe(false);
  expect(
    isRegistrationRequest({
      signingPublicKey: "not-array",
      encapsulationPublicKey: [1],
    }),
  ).toBe(false);
  expect(
    isRegistrationRequest({
      signingPublicKey: [1],
      encapsulationPublicKey: ["a"],
    }),
  ).toBe(false);
  expect(isRegistrationRequest({ signingPublicKey: [1] })).toBe(false);
  expect(isRegistrationRequest({ encapsulationPublicKey: [1] })).toBe(false);
  expect(isRegistrationRequest({})).toBe(false);
  expect(isRegistrationRequest(null)).toBe(false);
});
