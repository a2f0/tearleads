import { expect, test } from "bun:test";
import { generateSigningSeedAndKeyPair } from "../signing/generateKeyPair";
import { createVerifiedContainerAccessEvent } from "./accessEvent.testFixtures";
import { fixtureHash } from "./canonical.testFixtures";
import {
  createContainerManifestFixture,
  KEYRING_HASH,
  PREDECESSOR_BRIDGE_HASH,
} from "./containerAccess.testFixtures";
import { containerWrappingPublicKeyForTest } from "./containerWrapping.testFixtures";
import type {
  ContainerAccessEventBody,
  ContainerAccessManifestState,
  ContainerDirectGrant,
} from "./index";
import {
  computeAccessManifestHash,
  deriveContainerAccessManifest,
  verifyContainerAccessManifest,
} from "./index";
import { expectVerificationError } from "./verificationError.testFixtures";

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
    containerKeyPublicKey: previous.state.containerKeyPublicKey,
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
    containerKeyPublicKey: previous.state.containerKeyPublicKey,
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

test("container managed-principal grants commit matching principal heads", async () => {
  const groupGrant: ContainerDirectGrant = {
    subjectType: "group",
    subjectId: "group-1",
    accessLevel: "write",
  };
  const state: ContainerAccessManifestState = {
    containerKeyPublicKey: containerWrappingPublicKeyForTest(
      "container-key-epoch-1",
    ),
    systemSlot: null,
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
    containerKeyPublicKey: previous.state.containerKeyPublicKey,
    eventType: "container.revoke",
    parentManifestHash: null,
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
