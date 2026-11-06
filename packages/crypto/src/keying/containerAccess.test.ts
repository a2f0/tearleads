import { expect, test } from "bun:test";
import { generateSigningSeedAndKeyPair } from "../signing/generateKeyPair";
import { createVerifiedContainerAccessEvent } from "./accessEvent.testFixtures";
import { fixtureHash } from "./canonical.testFixtures";
import { createContainerManifestFixture } from "./containerAccess.testFixtures";
import { containerWrappingPublicKeyForTest } from "./containerWrapping.testFixtures";
import type {
  ContainerAccessEventBody,
  ContainerAccessManifestState,
  ContainerCreateAccessEventBody,
} from "./index";
import {
  computeAccessManifestHash,
  deriveContainerAccessManifest,
  verifyContainerAccessManifest,
  verifyContainerParentEdge,
} from "./index";
import { expectVerificationError } from "./verificationError.testFixtures";

test("verifyContainerAccessManifest accepts a signed child create under a writable parent", async () => {
  const adminUserId = "admin-user";
  const adminSigning = generateSigningSeedAndKeyPair();
  const parent = await createContainerManifestFixture({
    containerId: "parent-container",
    containerKeyEpochId: "parent-key-epoch-1",
    directGrants: [
      {
        subjectType: "user",
        subjectId: adminUserId,
        accessLevel: "admin",
      },
    ],
    signer: adminSigning,
    signerUserId: adminUserId,
  });
  const createBody: ContainerCreateAccessEventBody = {
    containerKeyPublicKey:
      containerWrappingPublicKeyForTest("child-key-epoch-1"),
    systemSlot: null,
    eventType: "container.create",
    parentContainerId: parent.state.containerId,
    parentManifestHash: parent.manifestHash,
    metadataDocumentId: "child-metadata-document",
    containerKeyEpochId: "child-key-epoch-1",
    directGrants: [
      {
        subjectType: "user",
        subjectId: adminUserId,
        accessLevel: "admin",
      },
    ],
    referencedPrincipalHeads: [],
  };
  const event = await createVerifiedContainerAccessEvent({
    body: createBody,
    objectId: "child-container",
    organizationId: parent.state.organizationId,
    previousManifestHash: null,
    signer: adminSigning,
    signerUserId: adminUserId,
  });
  const state: ContainerAccessManifestState = {
    containerKeyPublicKey:
      containerWrappingPublicKeyForTest("child-key-epoch-1"),
    systemSlot: null,
    version: 1,
    containerId: "child-container",
    organizationId: parent.state.organizationId,
    epoch: 1,
    previousManifestHash: null,
    eventHash: event.eventHash,
    parentContainerId: parent.state.containerId,
    parentManifestHash: parent.manifestHash,
    metadataDocumentId: createBody.metadataDocumentId,
    containerKeyEpochId: "child-key-epoch-1",
    directGrants: createBody.directGrants,
    referencedPrincipalHeads: [],
  };
  const manifest = await deriveContainerAccessManifest(state);
  const manifestHash = await computeAccessManifestHash(manifest);

  const result = await verifyContainerAccessManifest({
    manifest,
    expectedManifestHash: manifestHash,
    event,
    parentContainerPath: [parent],
  });

  expect(result.ok).toBe(true);
  if (result.ok) {
    expect(result.value.state.parentManifestHash).toBe(parent.manifestHash);
  }
});

test("verifyContainerAccessManifest rejects child create signed without parent write access", async () => {
  const readerUserId = "reader-user";
  const readerSigning = generateSigningSeedAndKeyPair();
  const parent = await createContainerManifestFixture({
    containerId: "parent-container",
    containerKeyEpochId: "parent-key-epoch-1",
    directGrants: [
      {
        subjectType: "user",
        subjectId: readerUserId,
        accessLevel: "read",
      },
    ],
    signer: readerSigning,
    signerUserId: readerUserId,
  });
  const body: ContainerCreateAccessEventBody = {
    containerKeyPublicKey:
      containerWrappingPublicKeyForTest("child-key-epoch-1"),
    systemSlot: null,
    eventType: "container.create",
    parentContainerId: parent.state.containerId,
    parentManifestHash: parent.manifestHash,
    metadataDocumentId: "child-metadata-document",
    containerKeyEpochId: "child-key-epoch-1",
    directGrants: [
      {
        subjectType: "user",
        subjectId: readerUserId,
        accessLevel: "admin",
      },
    ],
    referencedPrincipalHeads: [],
  };
  const event = await createVerifiedContainerAccessEvent({
    body,
    objectId: "child-container",
    organizationId: parent.state.organizationId,
    previousManifestHash: null,
    signer: readerSigning,
    signerUserId: readerUserId,
  });
  const manifest = await deriveContainerAccessManifest({
    containerKeyPublicKey:
      containerWrappingPublicKeyForTest("child-key-epoch-1"),
    systemSlot: null,
    version: 1,
    containerId: "child-container",
    organizationId: parent.state.organizationId,
    epoch: 1,
    previousManifestHash: null,
    eventHash: event.eventHash,
    parentContainerId: parent.state.containerId,
    parentManifestHash: parent.manifestHash,
    metadataDocumentId: body.metadataDocumentId,
    containerKeyEpochId: "child-key-epoch-1",
    directGrants: body.directGrants,
    referencedPrincipalHeads: [],
  });

  const result = await verifyContainerAccessManifest({
    manifest,
    expectedManifestHash: await computeAccessManifestHash(manifest),
    event,
    parentContainerPath: [parent],
  });

  expectVerificationError(result, "unauthorized");
});

test("verifyContainerAccessManifest rejects parent manifest hash mismatches", async () => {
  const adminUserId = "admin-user";
  const adminSigning = generateSigningSeedAndKeyPair();
  const parent = await createContainerManifestFixture({
    containerId: "parent-container",
    containerKeyEpochId: "parent-key-epoch-1",
    directGrants: [
      {
        subjectType: "user",
        subjectId: adminUserId,
        accessLevel: "admin",
      },
    ],
    signer: adminSigning,
    signerUserId: adminUserId,
  });
  const wrongParentManifestHash = await fixtureHash("wrong-parent-manifest");
  const body: ContainerCreateAccessEventBody = {
    containerKeyPublicKey:
      containerWrappingPublicKeyForTest("child-key-epoch-1"),
    systemSlot: null,
    eventType: "container.create",
    parentContainerId: parent.state.containerId,
    parentManifestHash: wrongParentManifestHash,
    metadataDocumentId: "child-metadata-document",
    containerKeyEpochId: "child-key-epoch-1",
    directGrants: [],
    referencedPrincipalHeads: [],
  };
  const event = await createVerifiedContainerAccessEvent({
    body,
    objectId: "child-container",
    organizationId: parent.state.organizationId,
    previousManifestHash: null,
    signer: adminSigning,
    signerUserId: adminUserId,
  });
  const manifest = await deriveContainerAccessManifest({
    containerKeyPublicKey:
      containerWrappingPublicKeyForTest("child-key-epoch-1"),
    systemSlot: null,
    version: 1,
    containerId: "child-container",
    organizationId: parent.state.organizationId,
    epoch: 1,
    previousManifestHash: null,
    eventHash: event.eventHash,
    parentContainerId: parent.state.containerId,
    parentManifestHash: wrongParentManifestHash,
    metadataDocumentId: body.metadataDocumentId,
    containerKeyEpochId: "child-key-epoch-1",
    directGrants: [],
    referencedPrincipalHeads: [],
  });

  const result = await verifyContainerAccessManifest({
    manifest,
    expectedManifestHash: await computeAccessManifestHash(manifest),
    event,
    parentContainerPath: [parent],
  });

  expectVerificationError(result, "missing_dependency");
});

test("parent sharing does not require descendant container manifest rewrites", async () => {
  const adminUserId = "admin-user";
  const aliceUserId = "alice-user";
  const adminSigning = generateSigningSeedAndKeyPair();
  const parent = await createContainerManifestFixture({
    containerId: "parent-container",
    containerKeyEpochId: "parent-key-epoch-1",
    directGrants: [
      {
        subjectType: "user",
        subjectId: adminUserId,
        accessLevel: "admin",
      },
    ],
    signer: adminSigning,
    signerUserId: adminUserId,
  });
  const child = await createContainerManifestFixture({
    containerId: "child-container",
    containerKeyEpochId: "child-key-epoch-1",
    directGrants: [],
    parentContainerId: parent.state.containerId,
    parentManifestHash: parent.manifestHash,
    signer: adminSigning,
    signerUserId: adminUserId,
  });
  const childManifestHashBeforeParentShare = child.manifestHash;
  const body: ContainerAccessEventBody = {
    containerKeyPublicKey: parent.state.containerKeyPublicKey,
    eventType: "container.grant",
    containerKeyEpochId: parent.state.containerKeyEpochId,
    grant: {
      subjectType: "user",
      subjectId: aliceUserId,
      accessLevel: "read",
    },
    referencedPrincipalHead: null,
  };
  const event = await createVerifiedContainerAccessEvent({
    body,
    objectId: parent.state.containerId,
    organizationId: parent.state.organizationId,
    previousManifestHash: parent.manifestHash,
    signer: adminSigning,
    signerUserId: adminUserId,
  });
  const parentAfterShareManifest = await deriveContainerAccessManifest({
    ...parent.state,
    epoch: parent.state.epoch + 1,
    previousManifestHash: parent.manifestHash,
    eventHash: event.eventHash,
    directGrants: [...parent.state.directGrants, body.grant],
  });
  const parentAfterShare = await verifyContainerAccessManifest({
    manifest: parentAfterShareManifest,
    expectedManifestHash: await computeAccessManifestHash(
      parentAfterShareManifest,
    ),
    event,
    previousManifest: parent,
    previousContainerPath: [parent],
  });

  expect(parentAfterShare.ok).toBe(true);
  if (!parentAfterShare.ok) {
    throw parentAfterShare.error;
  }

  expect(child.manifestHash).toBe(childManifestHashBeforeParentShare);
  expect(
    verifyContainerParentEdge({
      child,
      parentHistory: [parentAfterShare.value, parent],
    }).ok,
  ).toBe(true);
});
