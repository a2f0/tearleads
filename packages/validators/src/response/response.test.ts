import { expect, test } from "bun:test";
import {
  isChallengeErrorResponse,
  isChallengeResponse,
  isCommitDocumentChangeResponse,
  isCreateContainerResponse,
  isCurrentPrincipalMemberEnvelopesResponse,
  isHealthResponse,
  isLinkDocumentToContainerResponse,
  isListContainerDocumentsResponse,
  isListContainersResponse,
  isMoveContainerResponse,
  isPrincipalPolicyBundleResponse,
  isPrincipalStateResponse,
  isPublicKeyResponse,
  isShareContainerResponse,
  isStageBlobResponse,
  isUnlinkDocumentFromContainerResponse,
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
      rootMetadataDocumentId: "doc-root",
      rootMetadataAccessEpoch: 1,
      rootMetadataRecipientEncapsulationPublicKeys: ["pub-key"],
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
      documentRecipientEnvelopes: null,
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
      metadataDocumentId: "doc-123",
      metadataAccessEpoch: 1,
      metadataRecipientEncapsulationPublicKeys: ["pub-key"],
      metadataReferencedPrincipals: [
        {
          principalType: "group",
          principalId: "group-123",
          version: 1,
          keyEpoch: 1,
          stateHash: "state-hash",
        },
      ],
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

test("isListContainersResponse", () => {
  expect(
    isListContainersResponse([
      {
        id: "ctr-root",
        organizationId: "org-123",
        parentId: null,
        metadataDocumentId: "doc-root",
        metadataAccessEpoch: 1,
        metadataRecipientEncapsulationPublicKeys: ["pub-key"],
        metadataReferencedPrincipals: [
          {
            principalType: "organization",
            principalId: "org-123",
            version: 2,
            keyEpoch: 1,
            stateHash: "state-hash",
          },
        ],
      },
    ]),
  ).toBe(true);
  expect(
    isListContainersResponse([
      {
        id: "ctr-root",
        organizationId: "org-123",
        metadataDocumentId: "doc-root",
        metadataAccessEpoch: 1,
        metadataRecipientEncapsulationPublicKeys: ["pub-key"],
      },
    ]),
  ).toBe(false);
  expect(isListContainersResponse(null)).toBe(false);
});

test("isShareContainerResponse", () => {
  expect(
    isShareContainerResponse({
      id: "ctr-123",
      metadataDocumentId: "doc-123",
      metadataAccessEpoch: 2,
      metadataRecipientEncapsulationPublicKeys: ["pub-key"],
      metadataReferencedPrincipals: [
        {
          principalType: "group",
          principalId: "group-123",
          version: 1,
          keyEpoch: 1,
          stateHash: "state-hash",
        },
      ],
    }),
  ).toBe(true);
  expect(
    isShareContainerResponse({
      id: "ctr-123",
      metadataAccessEpoch: 2,
    }),
  ).toBe(false);
  expect(isShareContainerResponse(null)).toBe(false);
});

test("isMoveContainerResponse", () => {
  expect(
    isMoveContainerResponse({
      id: "ctr-123",
      organizationId: "org-123",
      parentId: "ctr-parent",
      metadataDocumentId: "doc-123",
      metadataAccessEpoch: 2,
      metadataRecipientEncapsulationPublicKeys: ["pub-key"],
    }),
  ).toBe(true);
  expect(
    isMoveContainerResponse({
      id: "ctr-123",
      organizationId: "org-123",
      parentId: null,
      metadataDocumentId: "doc-123",
      metadataAccessEpoch: 2,
      metadataRecipientEncapsulationPublicKeys: ["pub-key"],
    }),
  ).toBe(false);
  expect(isMoveContainerResponse(null)).toBe(false);
});

test("isListContainerDocumentsResponse", () => {
  expect(
    isListContainerDocumentsResponse([
      {
        createdAt: new Date().toISOString(),
        currentAccessEpoch: 2,
        id: "doc-123",
        linkedContainerIds: ["ctr-root"],
        recipientEncapsulationPublicKeys: ["pub-key"],
        referencedPrincipals: [
          {
            principalType: "group",
            principalId: "group-123",
            version: 1,
            keyEpoch: 1,
            stateHash: "state-hash",
          },
        ],
      },
    ]),
  ).toBe(true);
  expect(
    isListContainerDocumentsResponse([
      {
        currentAccessEpoch: 2,
        id: "doc-123",
        linkedContainerIds: ["ctr-root"],
        recipientEncapsulationPublicKeys: ["pub-key"],
      },
    ]),
  ).toBe(false);
  expect(isListContainerDocumentsResponse(null)).toBe(false);
});

test("isLinkDocumentToContainerResponse", () => {
  expect(
    isLinkDocumentToContainerResponse({
      createdAt: new Date().toISOString(),
      currentAccessEpoch: 2,
      id: "doc-123",
      linkedContainerIds: ["ctr-root", "ctr-child"],
      recipientEncapsulationPublicKeys: ["pub-key"],
    }),
  ).toBe(true);
  expect(
    isLinkDocumentToContainerResponse({
      currentAccessEpoch: 2,
      id: "doc-123",
      linkedContainerIds: ["ctr-root", "ctr-child"],
      recipientEncapsulationPublicKeys: ["pub-key"],
    }),
  ).toBe(false);
  expect(isLinkDocumentToContainerResponse(null)).toBe(false);
});

test("isUnlinkDocumentFromContainerResponse", () => {
  expect(
    isUnlinkDocumentFromContainerResponse({
      createdAt: new Date().toISOString(),
      currentAccessEpoch: 3,
      id: "doc-123",
      linkedContainerIds: ["ctr-root"],
      recipientEncapsulationPublicKeys: ["pub-key"],
    }),
  ).toBe(true);
  expect(
    isUnlinkDocumentFromContainerResponse({
      createdAt: new Date().toISOString(),
      id: "doc-123",
      linkedContainerIds: ["ctr-root"],
      recipientEncapsulationPublicKeys: ["pub-key"],
    }),
  ).toBe(false);
  expect(isUnlinkDocumentFromContainerResponse(null)).toBe(false);
});

test("isPrincipalStateResponse", () => {
  expect(
    isPrincipalStateResponse({
      principalType: "group",
      principalId: "group-123",
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
      signerUserId: "user-1",
      signerUserKeyFingerprint: "policy-key-fingerprint-1",
      signature: "signature",
      stateHash: "state-hash",
      createdAt: new Date().toISOString(),
    }),
  ).toBe(true);
  expect(
    isPrincipalStateResponse({
      principalType: "group",
      principalId: "group-123",
      version: 1,
    }),
  ).toBe(false);
  expect(isPrincipalStateResponse(null)).toBe(false);
});

test("isCurrentPrincipalMemberEnvelopesResponse", () => {
  expect(
    isCurrentPrincipalMemberEnvelopesResponse({
      principalType: "organization",
      principalId: "org-123",
      stateHash: "state-hash",
      epoch: 2,
      envelopes: [
        {
          memberPrincipalType: "group",
          memberPrincipalId: "group-234",
          memberKeyFingerprint: "fingerprint",
          kemCipherText: "cipher",
          wrappedKey: "wrapped",
        },
      ],
    }),
  ).toBe(true);
  expect(
    isCurrentPrincipalMemberEnvelopesResponse({
      principalType: "organization",
      principalId: "org-123",
      stateHash: "state-hash",
      envelopes: [],
    }),
  ).toBe(false);
  expect(isCurrentPrincipalMemberEnvelopesResponse(null)).toBe(false);
});

test("isPrincipalPolicyBundleResponse", () => {
  expect(
    isPrincipalPolicyBundleResponse({
      currentState: {
        principalType: "group",
        principalId: "group-123",
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
        signerUserId: "user-1",
        signerUserKeyFingerprint: "policy-key-fingerprint-1",
        signature: "signature",
        stateHash: "state-hash",
        createdAt: new Date().toISOString(),
      },
      currentProjection: [
        {
          memberPrincipalType: "user",
          memberPrincipalId: "user-1",
          role: "admin",
        },
      ],
      currentPayload: {
        principalType: "group",
        principalId: "group-123",
        stateHash: "state-hash",
        cipherSuite: "aes-256-gcm-v1",
        ciphertext: "ciphertext",
        ciphertextHash: "ciphertext-hash",
        createdAt: new Date().toISOString(),
      },
      currentMemberEnvelopes: {
        principalType: "group",
        principalId: "group-123",
        stateHash: "state-hash",
        epoch: 1,
        envelopes: [],
      },
    }),
  ).toBe(true);
  expect(
    isPrincipalPolicyBundleResponse({
      currentState: {
        principalType: "group",
      },
      currentPayload: {
        principalType: "group",
        principalId: "group-123",
        stateHash: "state-hash",
        cipherSuite: "aes-256-gcm-v1",
        ciphertext: "ciphertext",
        ciphertextHash: "ciphertext-hash",
        createdAt: new Date().toISOString(),
      },
      currentMemberEnvelopes: {
        principalType: "group",
        principalId: "group-123",
        stateHash: "state-hash",
        epoch: 1,
        envelopes: [],
      },
    }),
  ).toBe(false);
  expect(isPrincipalPolicyBundleResponse(null)).toBe(false);
});
