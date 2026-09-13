import { expect, test } from "bun:test";
import { generateSigningSeedAndKeyPair } from "../signing/generateKeyPair";
import {
  computeDocumentContentKeyTargetHash,
  makeVerifiedDocumentKekTargets,
  verifyAttachmentBindingEvent,
  verifyWriteHeader,
} from "./index";
import {
  createContainerManifestFixture,
  createDocumentLinkSetManifestFixture,
  createPrincipalPolicyFixture,
  createSignedAttachmentEvent,
  createVerifiedDocumentAccessEvent,
  createWriteHeaderFixture,
  fixtureHash,
} from "./testFixtures";
import type {
  ContainerGrantPrincipalHead,
  VerifiedPrincipalPolicy,
} from "./types";

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
  const policy = {
    ...createPrincipalPolicyFixture(newHead),
    projection: [{ role: "member", userId: "later" }],
    history: [
      {
        state: oldHead,
        grants: [],
        projection: [{ role: "member", userId: "former" }],
      },
      {
        state: newHead,
        grants: [],
        projection: [{ role: "member", userId: "later" }],
      },
    ],
  } as unknown as VerifiedPrincipalPolicy;
  const signer = generateSigningSeedAndKeyPair();
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
      containerId: "container",
      containerManifestHash: container.manifestHash,
    },
    dependencyManifestHashes: [container.manifestHash],
    objectId: documentId,
    organizationId,
    previousManifestHash: null,
    signer,
    signerUserId: "former",
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
  for (const writerUserId of ["former", "later"]) {
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
