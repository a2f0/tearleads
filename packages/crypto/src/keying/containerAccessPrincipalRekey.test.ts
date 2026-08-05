import { expect, test } from "bun:test";
import { generateSigningSeedAndKeyPair } from "../signing/generateKeyPair";
import type { ContainerAccessEventBody } from "./index";
import {
  computeAccessManifestHash,
  deriveContainerAccessManifest,
  verifyContainerAccessManifest,
} from "./index";
import {
  createContainerManifestFixture,
  createVerifiedContainerAccessEvent,
  fixtureHash,
} from "./testFixtures";

test("a rekey advances a managed-principal pin without changing grants", async () => {
  const writerUserId = "writer-user";
  const groupId = "group-1";
  const writerSigning = generateSigningSeedAndKeyPair();
  const previousHead = {
    principalType: "group" as const,
    principalId: groupId,
    version: 1,
    keyEpoch: 1,
    stateHash: await fixtureHash("group-state-1"),
    keyFingerprint: await fixtureHash("group-key-1"),
  };
  const nextHead = {
    ...previousHead,
    version: 2,
    keyEpoch: 2,
    stateHash: await fixtureHash("group-state-2"),
    keyFingerprint: await fixtureHash("group-key-2"),
  };
  const previous = await createContainerManifestFixture({
    containerId: "container-rekey-principal",
    containerKeyEpochId: "container-key-epoch-1",
    directGrants: [
      {
        subjectType: "user",
        subjectId: writerUserId,
        accessLevel: "admin",
      },
      {
        subjectType: "group",
        subjectId: groupId,
        accessLevel: "read",
      },
    ],
    referencedPrincipalHeads: [previousHead],
    signer: writerSigning,
    signerUserId: writerUserId,
  });
  const body: ContainerAccessEventBody = {
    eventType: "container.rekey",
    containerKeyEpochId: "container-key-epoch-2",
    keyringHash: "1".repeat(64),
    predecessorBridgeHash: "0".repeat(64),
    referencedPrincipalHeads: [nextHead],
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
    referencedPrincipalHeads: [nextHead],
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
    expect(result.value.state.directGrants).toHaveLength(
      previous.state.directGrants.length,
    );
    expect(result.value.state.directGrants).toEqual(
      expect.arrayContaining(previous.state.directGrants),
    );
    expect(result.value.state.referencedPrincipalHeads).toEqual([nextHead]);
  }
});

test("a legacy rekey without principal heads preserves predecessor pins", async () => {
  const writerUserId = "legacy-writer";
  const groupId = "legacy-group";
  const writerSigning = generateSigningSeedAndKeyPair();
  const previousHead = {
    principalType: "group" as const,
    principalId: groupId,
    version: 1,
    keyEpoch: 1,
    stateHash: await fixtureHash("legacy-group-state"),
    keyFingerprint: await fixtureHash("legacy-group-key"),
  };
  const previous = await createContainerManifestFixture({
    containerId: "legacy-container-rekey-principal",
    containerKeyEpochId: "legacy-container-key-epoch-1",
    directGrants: [
      {
        subjectType: "user",
        subjectId: writerUserId,
        accessLevel: "admin",
      },
      {
        subjectType: "group",
        subjectId: groupId,
        accessLevel: "read",
      },
    ],
    referencedPrincipalHeads: [previousHead],
    signer: writerSigning,
    signerUserId: writerUserId,
  });
  const body: ContainerAccessEventBody = {
    eventType: "container.rekey",
    containerKeyEpochId: "legacy-container-key-epoch-2",
    keyringHash: "1".repeat(64),
    predecessorBridgeHash: "0".repeat(64),
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

  if (!result.ok) {
    throw result.error;
  }
  expect(result.value.state.referencedPrincipalHeads).toEqual([previousHead]);
});
