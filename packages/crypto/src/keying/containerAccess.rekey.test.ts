import { expect, test } from "bun:test";
import { generateSigningSeedAndKeyPair } from "../signing/generateKeyPair";
import { createVerifiedContainerAccessEvent } from "./accessEvent.testFixtures";
import {
  createContainerManifestFixture,
  KEYRING_HASH,
  PREDECESSOR_BRIDGE_HASH,
} from "./containerAccess.testFixtures";
import { containerWrappingPublicKeyForTest } from "./containerWrapping.testFixtures";
import type { ContainerAccessEventBody } from "./index";
import {
  computeAccessManifestHash,
  deriveContainerAccessManifest,
  verifyContainerAccessManifest,
} from "./index";
import { expectVerificationError } from "./verificationError.testFixtures";

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
    containerKeyPublicKey: containerWrappingPublicKeyForTest(
      "container-key-epoch-2",
    ),
    eventType: "container.rekey",
    parentManifestHash: null,
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
    containerKeyPublicKey: body.containerKeyPublicKey,
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
    containerKeyPublicKey: containerWrappingPublicKeyForTest(
      "container-key-epoch-2",
    ),
    eventType: "container.rekey",
    parentManifestHash: null,
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
    containerKeyPublicKey: body.containerKeyPublicKey,
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
    containerKeyPublicKey: containerWrappingPublicKeyForTest(
      previous.state.containerKeyEpochId ?? "",
    ),
    eventType: "container.rekey",
    parentManifestHash: null,
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

test("verifyContainerAccessManifest rejects rekeys that reuse the wrapping key", async () => {
  const writerUserId = "writer-user";
  const writerSigning = generateSigningSeedAndKeyPair();
  const previous = await createContainerManifestFixture({
    containerId: "container-reused-wrapping-key",
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
  // A fresh epoch id, but the wrapping key of the epoch being retired.
  // Descendants wrap to the published key without holding this container's
  // material, so accepting this would let the retired KEK's holder open every
  // child key minted afterwards — the rotation would not actually revoke.
  const retiredPublicKey = previous.state.containerKeyPublicKey;
  if (!retiredPublicKey) throw new Error("fixture needs a wrapping key");
  const body: ContainerAccessEventBody = {
    containerKeyPublicKey: retiredPublicKey,
    eventType: "container.rekey",
    parentManifestHash: null,
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
    containerKeyPublicKey: body.containerKeyPublicKey,
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
