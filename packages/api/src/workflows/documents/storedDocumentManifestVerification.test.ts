import { expect, test } from "bun:test";
import type {
  ContainerGrantPrincipalHead,
  DocumentAccessEventBody,
  VerifiedPrincipalPolicy,
} from "@symcrypt/crypto";
import { generateSigningSeedAndKeyPair } from "@symcrypt/crypto";
import {
  createContainerManifestFixture,
  createDocumentLinkSetManifestFixture,
  createPrincipalPolicyFixture,
  createVerifiedDocumentAccessEvent,
  fixtureHash,
} from "@symcrypt/crypto/test-fixtures";
import { verifyStoredDocumentManifestTransition } from "./storedDocumentManifestVerification";

function policyState(
  reference: ContainerGrantPrincipalHead,
): VerifiedPrincipalPolicy["state"] {
  return {
    principalType: reference.principalType,
    principalId: reference.principalId,
    version: reference.version,
    keyEpoch: reference.keyEpoch,
    stateHash: reference.stateHash,
    keyFingerprint: reference.keyFingerprint,
  } as VerifiedPrincipalPolicy["state"];
}

test("stored document history uses membership at the referenced group head", async () => {
  const historicalHead: ContainerGrantPrincipalHead = {
    principalType: "group",
    principalId: "rotated-document-group",
    version: 1,
    keyEpoch: 1,
    stateHash: await fixtureHash("rotated-document-group-state-1"),
    keyFingerprint: await fixtureHash("rotated-document-group-key-1"),
  };
  const currentHead: ContainerGrantPrincipalHead = {
    ...historicalHead,
    version: 2,
    keyEpoch: 2,
    stateHash: await fixtureHash("rotated-document-group-state-2"),
    keyFingerprint: await fixtureHash("rotated-document-group-key-2"),
  };
  const formerMember = "former-document-writer";
  const laterMember = "later-document-writer";
  const currentPolicy = createPrincipalPolicyFixture(currentHead);
  const policy = {
    ...currentPolicy,
    projection: [{ role: "member", userId: laterMember }],
    history: [
      {
        grants: [],
        projection: [{ role: "member", userId: formerMember }],
        state: policyState(historicalHead),
      },
      {
        grants: [],
        projection: [{ role: "member", userId: laterMember }],
        state: policyState(currentHead),
      },
    ],
  } as unknown as VerifiedPrincipalPolicy;
  const container = await createContainerManifestFixture({
    containerId: "historical-document-container",
    directGrants: [
      {
        accessLevel: "write",
        subjectId: historicalHead.principalId,
        subjectType: "group",
      },
    ],
    referencedPrincipalHeads: [historicalHead],
  });

  async function verifyInitialLink(signerUserId: string) {
    const body: DocumentAccessEventBody = {
      eventType: "document.link",
      containerId: container.state.containerId,
      containerManifestHash: container.manifestHash,
    };
    const event = await createVerifiedDocumentAccessEvent({
      body,
      dependencyManifestHashes: [container.manifestHash],
      objectId: `document-${signerUserId}`,
      organizationId: container.state.organizationId,
      previousManifestHash: null,
      signer: generateSigningSeedAndKeyPair(),
      signerUserId,
    });
    const documentManifest = await createDocumentLinkSetManifestFixture({
      documentId: event.event.objectId,
      event,
      linkedContainerIds: [container.state.containerId],
      organizationId: container.state.organizationId,
    });

    return verifyStoredDocumentManifestTransition({
      event,
      expectedManifestHash: documentManifest.manifestHash,
      manifest: documentManifest.manifest,
      principalPolicies: [policy],
      targetContainerPath: [container],
    });
  }

  expect((await verifyInitialLink(formerMember)).ok).toBe(true);
  expect(await verifyInitialLink(laterMember)).toMatchObject({
    error: { code: "unauthorized" },
    ok: false,
  });
});
