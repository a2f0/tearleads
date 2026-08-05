import { expect, test } from "bun:test";
import { generateSigningSeedAndKeyPair } from "../signing/generateKeyPair";
import type {
  ContainerAccessEventBody,
  ContainerAccessManifestState,
  ContainerCreateAccessEventBody,
  ContainerDirectGrant,
} from "./index";
import {
  computeAccessManifestHash,
  deriveContainerAccessManifest,
  verifyContainerAccessManifest,
  verifyContainerParentEdge,
} from "./index";
import {
  createContainerManifestFixture,
  createVerifiedContainerAccessEvent,
  expectVerificationError,
  fixtureHash,
} from "./testFixtures";

const PREDECESSOR_BRIDGE_HASH = "0".repeat(64);
const KEYRING_HASH = "1".repeat(64);

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

test("verifyContainerAccessManifest rejects a forged API-only grant row", async () => {
  const adminUserId = "admin-user";
  const aliceUserId = "alice-user";
  const bobUserId = "bob-user";
  const adminSigning = generateSigningSeedAndKeyPair();
  const previous = await createContainerManifestFixture({
    containerId: "container-1",
    containerKeyEpochId: "container-key-epoch-1",
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
  const body: ContainerAccessEventBody = {
    eventType: "container.grant",
    containerKeyEpochId: previous.state.containerKeyEpochId,
    grant: {
      subjectType: "user",
      subjectId: aliceUserId,
      accessLevel: "read",
    },
    referencedPrincipalHead: null,
  };
  const event = await createVerifiedContainerAccessEvent({
    body,
    objectId: previous.state.containerId,
    organizationId: previous.state.organizationId,
    previousManifestHash: previous.manifestHash,
    signer: adminSigning,
    signerUserId: adminUserId,
  });
  const forgedState: ContainerAccessManifestState = {
    ...previous.state,
    epoch: previous.state.epoch + 1,
    previousManifestHash: previous.manifestHash,
    eventHash: event.eventHash,
    directGrants: [
      ...previous.state.directGrants,
      body.grant,
      {
        subjectType: "user",
        subjectId: bobUserId,
        accessLevel: "read",
      },
    ],
  };
  const forgedManifest = await deriveContainerAccessManifest(forgedState);

  const result = await verifyContainerAccessManifest({
    manifest: forgedManifest,
    expectedManifestHash: await computeAccessManifestHash(forgedManifest),
    event,
    previousManifest: previous,
    previousContainerPath: [previous],
  });

  expectVerificationError(result, "hash_mismatch");
});

test("verifyContainerAccessManifest rejects container grants signed by non-admins", async () => {
  const adminUserId = "admin-user";
  const writerUserId = "writer-user";
  const aliceUserId = "alice-user";
  const adminSigning = generateSigningSeedAndKeyPair();
  const writerSigning = generateSigningSeedAndKeyPair();
  const previous = await createContainerManifestFixture({
    containerId: "container-1",
    containerKeyEpochId: "container-key-epoch-1",
    directGrants: [
      {
        subjectType: "user",
        subjectId: adminUserId,
        accessLevel: "admin",
      },
      {
        subjectType: "user",
        subjectId: writerUserId,
        accessLevel: "write",
      },
    ],
    signer: adminSigning,
    signerUserId: adminUserId,
  });
  const body: ContainerAccessEventBody = {
    eventType: "container.grant",
    containerKeyEpochId: previous.state.containerKeyEpochId,
    grant: {
      subjectType: "user",
      subjectId: aliceUserId,
      accessLevel: "read",
    },
    referencedPrincipalHead: null,
  };
  const event = await createVerifiedContainerAccessEvent({
    body,
    objectId: previous.state.containerId,
    organizationId: previous.state.organizationId,
    previousManifestHash: previous.manifestHash,
    signer: writerSigning,
    signerUserId: writerUserId,
  });
  const manifest = await deriveContainerAccessManifest({
    ...previous.state,
    epoch: previous.state.epoch + 1,
    previousManifestHash: previous.manifestHash,
    eventHash: event.eventHash,
    directGrants: [...previous.state.directGrants, body.grant],
  });

  const result = await verifyContainerAccessManifest({
    manifest,
    expectedManifestHash: await computeAccessManifestHash(manifest),
    event,
    previousManifest: previous,
    previousContainerPath: [previous],
  });

  expectVerificationError(result, "unauthorized");
});

test("verifyContainerAccessManifest accepts writer rekeys without grant changes", async () => {
  const writerUserId = "writer-user";
  const writerSigning = generateSigningSeedAndKeyPair();
  const previous = await createContainerManifestFixture({
    containerId: "container-rekey",
    containerKeyEpochId: "container-key-epoch-1",
    directGrants: [
      {
        subjectType: "user",
        subjectId: writerUserId,
        accessLevel: "write",
      },
    ],
    signer: writerSigning,
    signerUserId: writerUserId,
  });
  const body: ContainerAccessEventBody = {
    eventType: "container.rekey",
    containerKeyEpochId: "container-key-epoch-2",
    keyringHash: KEYRING_HASH,
    predecessorBridgeHash: PREDECESSOR_BRIDGE_HASH,
    referencedPrincipalHeads: previous.state.referencedPrincipalHeads,
  };
  const event = await createVerifiedContainerAccessEvent({
    body,
    objectId: previous.state.containerId,
    organizationId: previous.state.organizationId,
    previousManifestHash: previous.manifestHash,
    signer: writerSigning,
    signerUserId: writerUserId,
  });
  const manifest = await deriveContainerAccessManifest({
    ...previous.state,
    epoch: previous.state.epoch + 1,
    previousManifestHash: previous.manifestHash,
    eventHash: event.eventHash,
    containerKeyEpochId: body.containerKeyEpochId,
  });

  const result = await verifyContainerAccessManifest({
    manifest,
    expectedManifestHash: await computeAccessManifestHash(manifest),
    event,
    previousManifest: previous,
    previousContainerPath: [previous],
  });

  expect(result.ok).toBe(true);
  if (result.ok) {
    expect(result.value.state.directGrants).toEqual(
      previous.state.directGrants,
    );
    expect(result.value.state.containerKeyEpochId).toBe(
      "container-key-epoch-2",
    );
  }
});

test("verifyContainerAccessManifest rejects rekeys that change grants", async () => {
  const writerUserId = "writer-user";
  const aliceUserId = "alice-user";
  const writerSigning = generateSigningSeedAndKeyPair();
  const previous = await createContainerManifestFixture({
    containerId: "container-forged-rekey",
    containerKeyEpochId: "container-key-epoch-1",
    directGrants: [
      {
        subjectType: "user",
        subjectId: writerUserId,
        accessLevel: "write",
      },
    ],
    signer: writerSigning,
    signerUserId: writerUserId,
  });
  const body: ContainerAccessEventBody = {
    eventType: "container.rekey",
    containerKeyEpochId: "container-key-epoch-2",
    keyringHash: KEYRING_HASH,
    predecessorBridgeHash: PREDECESSOR_BRIDGE_HASH,
    referencedPrincipalHeads: previous.state.referencedPrincipalHeads,
  };
  const event = await createVerifiedContainerAccessEvent({
    body,
    objectId: previous.state.containerId,
    organizationId: previous.state.organizationId,
    previousManifestHash: previous.manifestHash,
    signer: writerSigning,
    signerUserId: writerUserId,
  });
  const forgedManifest = await deriveContainerAccessManifest({
    ...previous.state,
    epoch: previous.state.epoch + 1,
    previousManifestHash: previous.manifestHash,
    eventHash: event.eventHash,
    containerKeyEpochId: body.containerKeyEpochId,
    directGrants: [
      ...previous.state.directGrants,
      {
        subjectType: "user",
        subjectId: aliceUserId,
        accessLevel: "read",
      },
    ],
  });

  const result = await verifyContainerAccessManifest({
    manifest: forgedManifest,
    expectedManifestHash: await computeAccessManifestHash(forgedManifest),
    event,
    previousManifest: previous,
    previousContainerPath: [previous],
  });

  expectVerificationError(result, "hash_mismatch");
});

test("verifyContainerAccessManifest rejects rekeys that reuse the current KEK epoch", async () => {
  const writerUserId = "writer-user";
  const writerSigning = generateSigningSeedAndKeyPair();
  const previous = await createContainerManifestFixture({
    containerId: "container-stale-rekey",
    containerKeyEpochId: "container-key-epoch-1",
    directGrants: [
      {
        subjectType: "user",
        subjectId: writerUserId,
        accessLevel: "write",
      },
    ],
    signer: writerSigning,
    signerUserId: writerUserId,
  });
  const body: ContainerAccessEventBody = {
    eventType: "container.rekey",
    containerKeyEpochId: previous.state.containerKeyEpochId ?? "",
    keyringHash: KEYRING_HASH,
    predecessorBridgeHash: PREDECESSOR_BRIDGE_HASH,
    referencedPrincipalHeads: previous.state.referencedPrincipalHeads,
  };
  const event = await createVerifiedContainerAccessEvent({
    body,
    objectId: previous.state.containerId,
    organizationId: previous.state.organizationId,
    previousManifestHash: previous.manifestHash,
    signer: writerSigning,
    signerUserId: writerUserId,
  });
  const manifest = await deriveContainerAccessManifest({
    ...previous.state,
    epoch: previous.state.epoch + 1,
    previousManifestHash: previous.manifestHash,
    eventHash: event.eventHash,
  });

  const result = await verifyContainerAccessManifest({
    manifest,
    expectedManifestHash: await computeAccessManifestHash(manifest),
    event,
    previousManifest: previous,
    previousContainerPath: [previous],
  });

  expectVerificationError(result, "key_epoch_reuse");
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

test("verifyContainerAccessManifest rejects moving a container under its descendant", async () => {
  const adminUserId = "admin-user";
  const adminSigning = generateSigningSeedAndKeyPair();
  const root = await createContainerManifestFixture({
    containerId: "root-container",
    containerKeyEpochId: "root-key-epoch-1",
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
    parentContainerId: root.state.containerId,
    parentManifestHash: root.manifestHash,
    signer: adminSigning,
    signerUserId: adminUserId,
  });
  const grandchild = await createContainerManifestFixture({
    containerId: "grandchild-container",
    containerKeyEpochId: "grandchild-key-epoch-1",
    directGrants: [],
    parentContainerId: child.state.containerId,
    parentManifestHash: child.manifestHash,
    signer: adminSigning,
    signerUserId: adminUserId,
  });
  const body: ContainerAccessEventBody = {
    eventType: "container.move",
    parentContainerId: grandchild.state.containerId,
    parentManifestHash: grandchild.manifestHash,
    containerKeyEpochId: "child-key-epoch-2",
    keyringHash: KEYRING_HASH,
    predecessorBridgeHash: PREDECESSOR_BRIDGE_HASH,
  };
  const event = await createVerifiedContainerAccessEvent({
    body,
    objectId: child.state.containerId,
    organizationId: child.state.organizationId,
    previousManifestHash: child.manifestHash,
    signer: adminSigning,
    signerUserId: adminUserId,
  });
  const manifest = await deriveContainerAccessManifest({
    ...child.state,
    epoch: child.state.epoch + 1,
    previousManifestHash: child.manifestHash,
    eventHash: event.eventHash,
    parentContainerId: grandchild.state.containerId,
    parentManifestHash: grandchild.manifestHash,
    containerKeyEpochId: "child-key-epoch-2",
  });

  const result = await verifyContainerAccessManifest({
    manifest,
    expectedManifestHash: await computeAccessManifestHash(manifest),
    event,
    previousManifest: child,
    previousContainerPath: [root, child],
    destinationParentContainerPath: [root, child, grandchild],
  });

  expectVerificationError(result, "object_mismatch");
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

test("container managed-principal grants commit matching principal heads", async () => {
  const groupGrant: ContainerDirectGrant = {
    subjectType: "group",
    subjectId: "group-1",
    accessLevel: "write",
  };
  const state: ContainerAccessManifestState = {
    version: 1,
    containerId: "container-1",
    organizationId: "organization-1",
    epoch: 1,
    previousManifestHash: null,
    eventHash: await fixtureHash("container-event"),
    parentContainerId: null,
    parentManifestHash: null,
    metadataDocumentId: "container-1-metadata-document",
    containerKeyEpochId: "container-key-epoch-1",
    directGrants: [groupGrant],
    referencedPrincipalHeads: [],
  };

  await expect(deriveContainerAccessManifest(state)).rejects.toThrow(
    "container access manifest is missing a referenced principal head",
  );

  await expect(
    deriveContainerAccessManifest({
      ...state,
      referencedPrincipalHeads: [
        {
          principalType: "group",
          principalId: groupGrant.subjectId,
          version: 1,
          keyEpoch: 1,
          stateHash: await fixtureHash("group-state"),
          keyFingerprint: await fixtureHash("group-key"),
        },
      ],
    }),
  ).resolves.toMatchObject({
    objectKind: "container",
    objectId: state.containerId,
  });
});

test("verifyContainerAccessManifest requires revokes to advance the KEK epoch", async () => {
  const adminSigning = generateSigningSeedAndKeyPair();
  const previous = await createContainerManifestFixture({
    containerId: "revoke-container",
    containerKeyEpochId: "container-key-epoch-1",
    directGrants: [
      {
        subjectType: "user",
        subjectId: "admin-user",
        accessLevel: "admin",
      },
      {
        subjectType: "user",
        subjectId: "revoked-user",
        accessLevel: "read",
      },
    ],
    signer: adminSigning,
    signerUserId: "admin-user",
  });
  const body: ContainerAccessEventBody = {
    eventType: "container.revoke",
    containerKeyEpochId: previous.state.containerKeyEpochId,
    keyringHash: KEYRING_HASH,
    predecessorBridgeHash: PREDECESSOR_BRIDGE_HASH,
    subjectType: "user",
    subjectId: "revoked-user",
  };
  const event = await createVerifiedContainerAccessEvent({
    body,
    objectId: previous.state.containerId,
    organizationId: previous.state.organizationId,
    previousManifestHash: previous.manifestHash,
    signer: adminSigning,
    signerUserId: "admin-user",
  });

  expectVerificationError(
    await verifyContainerAccessManifest({
      manifest: previous.manifest,
      expectedManifestHash: previous.manifestHash,
      event,
      previousManifest: previous,
      previousContainerPath: [previous],
    }),
    "key_epoch_reuse",
  );
});
