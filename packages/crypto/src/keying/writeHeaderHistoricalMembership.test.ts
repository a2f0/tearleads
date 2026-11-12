import { expect, test } from "bun:test";
import { createVerifiedDocumentAccessEvent } from "./accessEvent.testFixtures";
import { createSignedAttachmentEvent } from "./attachmentAccessEvent.testFixtures";
import { fixtureHash } from "./canonical.testFixtures";
import {
  createContainerManifestFixture,
  createPrincipalPolicyFixture,
} from "./containerAccess.testFixtures";
import type { ContainerGrantPrincipalHead } from "./containerAccessTypes";
import { createDocumentLinkSetManifestFixture } from "./documentLinkSetManifest.testFixtures";
import {
  computeDocumentContentKeyTargetHash,
  makeVerifiedDocumentKekTargets,
  verifyAttachmentBindingEvent,
  verifyWriteHeader,
} from "./index";
import {
  createPolicySigner,
  policyMember,
} from "./principalPolicyTestFixtures";
import type { VerifiedPrincipalPolicy } from "./principalPolicyTypes";
import { createWriteHeaderFixture } from "./writeHeader.testFixtures";

test("historical content authority uses the cited group membership, while submissions use current membership", async () => {
  const oldHead: ContainerGrantPrincipalHead = {
    principalType: "group",
    principalId: "group",
    version: 1,
    keyEpoch: 1,
    stateHash: await fixtureHash("group-1"),
    keyFingerprint: await fixtureHash("key-1"),
  };
  const newHead = {
    ...oldHead,
    version: 2,
    keyEpoch: 2,
    stateHash: await fixtureHash("group-2"),
    keyFingerprint: await fixtureHash("key-2"),
  };
  const former = await createPolicySigner("former");
  const later = await createPolicySigner("later");
  const policy = {
    ...createPrincipalPolicyFixture(newHead),
    projection: [policyMember(later)],
    history: [
      {
        state: oldHead,
        grants: [],
        projection: [policyMember(former)],
      },
      {
        state: newHead,
        grants: [],
        projection: [policyMember(later)],
      },
    ],
  } as unknown as VerifiedPrincipalPolicy;
  const container = await createContainerManifestFixture({
    containerId: "container",
    containerKeyEpochId: "key",
    directGrants: [
      { subjectType: "group", subjectId: "group", accessLevel: "write" },
    ],
    referencedPrincipalHeads: [oldHead],
  });
  const organizationId = container.state.organizationId;
  const documentId = "document";
  const event = await createVerifiedDocumentAccessEvent({
    body: {
      eventType: "document.link",
      blobRewraps: [],
      containerId: "container",
      containerManifestHash: container.manifestHash,
    },
    dependencyManifestHashes: [container.manifestHash],
    objectId: documentId,
    organizationId,
    previousManifestHash: null,
    signer: former,
    signerUserId: former.userId,
  });
  const documentManifest = await createDocumentLinkSetManifestFixture({
    documentId,
    organizationId,
    event,
    linkedContainerIds: ["container"],
  });
  const targets = [
    {
      containerId: "container",
      containerManifestHash: container.manifestHash,
      containerKeyEpoch: 1,
      containerKeyEpochId: "key",
    },
  ];
  const targetHash = await computeDocumentContentKeyTargetHash(targets);
  const documentKekTargets = makeVerifiedDocumentKekTargets({
    documentId,
    documentKeyTargetHash: targetHash,
    linkSetManifestHash: documentManifest.manifestHash,
    linkedContainerManifestHashes: [container.manifestHash],
    linkedContainerKeyEpochIds: ["key"],
    targets,
  });
  for (const signer of [former, later]) {
    const writerUserId = signer.userId;
    const header = await createWriteHeaderFixture({
      accessManifestHash: documentManifest.manifestHash,
      dependencyManifestHashes: [container.manifestHash],
      objectId: documentId,
      organizationId,
      signing: signer,
      targetHash,
      writerUserId,
    });
    const input = {
      header,
      writerPublicKey: signer.signingPublicKey,
      documentAuthorization: {
        documentManifest,
        documentKekTargets,
        authorizingContainerPaths: [[container]],
        principalPolicies: [policy],
      },
    };
    const body = {
      eventType: "attachment.bind" as const,
      bindingId: "binding",
      blobId: "blob",
      documentId,
      slotId: "slot",
      expectedBindingId: null,
      documentManifestHash: documentManifest.manifestHash,
    };
    const bindingInput = {
      body,
      event: await createSignedAttachmentEvent({
        body,
        dependencyManifestHashes: [
          documentManifest.manifestHash,
          container.manifestHash,
        ],
        objectId: "blob",
        organizationId,
        signer,
        signerUserId: writerUserId,
      }),
      signerPublicKey: signer.signingPublicKey,
      documentManifest,
      authorizingContainerPaths: [[container]],
      principalPolicies: [policy],
    };
    expect((await verifyAttachmentBindingEvent(bindingInput)).ok).toBe(
      writerUserId === "later",
    );
    expect(
      (
        await verifyAttachmentBindingEvent({
          ...bindingInput,
          authorizationMembership: "referenced",
        })
      ).ok,
    ).toBe(writerUserId === "former");
    expect((await verifyWriteHeader(input)).ok).toBe(writerUserId === "later");
    expect(
      (
        await verifyWriteHeader({
          ...input,
          authorizationMembership: "referenced",
        })
      ).ok,
    ).toBe(writerUserId === "former");
  }
});
