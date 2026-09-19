import { expect, test } from "bun:test";
import { generateSigningSeedAndKeyPair } from "../signing/generateKeyPair";
import { containerWrappingPublicKeyForTest } from "./containerWrapping.testFixtures";
import {
  computeAccessManifestHash,
  deriveContainerAccessManifest,
  verifyContainerAccessManifest,
} from "./index";
import {
  createContainerManifestFixture,
  createVerifiedContainerAccessEvent,
} from "./testFixtures";
import type { ContainerCreateAccessEventBody } from "./types";

const SLOT = `sys_v1_${"a".repeat(43)}`;

test.each(["root", "grandchild", "truncated-grandchild"] as const)(
  "a system slot cannot be created as a %s",
  async (kind) => {
    const signer = generateSigningSeedAndKeyPair();
    const directGrants = [
      { subjectType: "user", subjectId: "owner", accessLevel: "admin" },
    ] as const;
    const root = await createContainerManifestFixture({
      containerId: "root",
      directGrants,
      signer,
      signerUserId: "owner",
    });
    const parent = await createContainerManifestFixture({
      containerId: "parent",
      parentContainerId: root.state.containerId,
      parentManifestHash: root.manifestHash,
      directGrants,
      signer,
      signerUserId: "owner",
    });
    const body: ContainerCreateAccessEventBody = {
      containerKeyPublicKey: containerWrappingPublicKeyForTest("key-1"),
      eventType: "container.create",
      systemSlot: SLOT,
      containerKeyEpochId: "key-1",
      metadataDocumentId: "metadata",
      parentContainerId: kind === "root" ? null : parent.state.containerId,
      parentManifestHash: kind === "root" ? null : parent.manifestHash,
      directGrants: [...directGrants],
      referencedPrincipalHeads: [],
    };
    const event = await createVerifiedContainerAccessEvent({
      body,
      objectId: "system",
      organizationId: root.state.organizationId,
      previousManifestHash: null,
      signer,
      signerUserId: "owner",
    });
    const { eventType: _eventType, ...fields } = body;
    const manifest = await deriveContainerAccessManifest({
      ...fields,
      version: 1,
      containerId: "system",
      organizationId: root.state.organizationId,
      epoch: 1,
      previousManifestHash: null,
      eventHash: event.eventHash,
    });
    const result = await verifyContainerAccessManifest({
      event,
      manifest,
      expectedManifestHash: await computeAccessManifestHash(manifest),
      parentContainerPath:
        kind === "root"
          ? []
          : kind === "grandchild"
            ? [root, parent]
            : [parent],
    });
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.code).toBe("invalid_shape");
      expect(result.error.message).toBe(
        kind === "root"
          ? "root containers cannot have a system slot"
          : "system container parent must be a root",
      );
    }
  },
);

for (const accessLevel of ["write", "admin"] as const) {
  for (const systemSlot of [null, SLOT]) {
    test(`a ${accessLevel} member creates a ${systemSlot === null ? "normal" : "system"} container`, async () => {
      const signer = generateSigningSeedAndKeyPair();
      const parent = await createContainerManifestFixture({
        containerId: "root",
        signer,
        signerUserId: "owner",
        directGrants: [
          { subjectType: "user", subjectId: "member", accessLevel },
          { subjectType: "user", subjectId: "owner", accessLevel: "admin" },
        ],
      });
      const body: ContainerCreateAccessEventBody = {
        containerKeyPublicKey: containerWrappingPublicKeyForTest("key-1"),
        eventType: "container.create",
        systemSlot,
        containerKeyEpochId: "key-1",
        metadataDocumentId: "metadata",
        parentContainerId: "root",
        parentManifestHash: parent.manifestHash,
        // Shared system containers remain legitimate destinations.
        directGrants: [
          { subjectType: "user", subjectId: "peer", accessLevel: "read" },
        ],
        referencedPrincipalHeads: [],
      };
      const event = await createVerifiedContainerAccessEvent({
        body,
        objectId: "child",
        organizationId: parent.state.organizationId,
        previousManifestHash: null,
        signer,
        signerUserId: "member",
      });
      const { eventType: _eventType, ...fields } = body;
      const state = {
        ...fields,
        version: 1 as const,
        containerId: "child",
        organizationId: parent.state.organizationId,
        epoch: 1,
        previousManifestHash: null,
        eventHash: event.eventHash,
      };
      const manifest = await deriveContainerAccessManifest(state);
      const result = await verifyContainerAccessManifest({
        event,
        manifest,
        expectedManifestHash: await computeAccessManifestHash(manifest),
        parentContainerPath: [parent],
      });
      expect(result.ok).toBe(systemSlot === null || accessLevel === "admin");
      if (!result.ok) expect(result.error.code).toBe("unauthorized");
      if (result.ok && accessLevel === "admin") {
        const moveBody = {
          containerKeyPublicKey: containerWrappingPublicKeyForTest("key-2"),
          eventType: "container.move" as const,
          parentContainerId: "root",
          parentManifestHash: parent.manifestHash,
          containerKeyEpochId: "key-2",
          keyringHash: "a".repeat(64),
          predecessorBridgeHash: "b".repeat(64),
        };
        const moveEvent = await createVerifiedContainerAccessEvent({
          body: moveBody,
          objectId: "child",
          organizationId: state.organizationId,
          previousManifestHash: result.value.manifestHash,
          signer,
          signerUserId: "member",
        });
        const moved = await deriveContainerAccessManifest({
          ...state,
          epoch: 2,
          containerKeyEpochId: "key-2",
          containerKeyPublicKey: containerWrappingPublicKeyForTest("key-2"),
          previousManifestHash: result.value.manifestHash,
          eventHash: moveEvent.eventHash,
        });
        const checkedMove = await verifyContainerAccessManifest({
          event: moveEvent,
          manifest: moved,
          expectedManifestHash: await computeAccessManifestHash(moved),
          previousManifest: result.value,
          previousContainerPath: [parent, result.value],
          destinationParentContainerPath: [parent],
        });
        expect(checkedMove.ok).toBe(systemSlot === null);
        if (!checkedMove.ok)
          expect(checkedMove.error.message).toBe(
            "root and system containers cannot move",
          );
      }
      const other = await deriveContainerAccessManifest({
        ...state,
        systemSlot: systemSlot === null ? SLOT : null,
      });
      expect(await computeAccessManifestHash(other)).not.toBe(
        await computeAccessManifestHash(manifest),
      );
    });
  }
}
