import { expect, test } from "bun:test";
import { generateSigningSeedAndKeyPair } from "../signing/generateKeyPair";
import { computeAccessManifestHash } from "./accessEvent";
import {
  deriveContainerAccessManifest,
  verifyContainerAccessManifest,
} from "./containerAccess";
import { containerWrappingPublicKeyForTest } from "./containerWrapping.testFixtures";
import {
  createContainerManifestFixture,
  createVerifiedContainerAccessEvent,
} from "./testFixtures";
import type {
  ContainerRekeyAccessEventBody,
  ContainerRevokeAccessEventBody,
} from "./types";

for (const eventType of ["container.rekey", "container.revoke"] as const) {
  for (const scenario of ["root", "current", "stale", "unsigned"] as const) {
    test(`${eventType} binds its rotation parent citation: ${scenario}`, async () => {
      const signer = generateSigningSeedAndKeyPair();
      const signerUserId = "admin";
      const directGrants = [
        { subjectType: "user", subjectId: signerUserId, accessLevel: "admin" },
      ] as const;
      const parent = await createContainerManifestFixture({
        containerId: "rotation-parent",
        containerKeyEpochId: "parent-epoch",
        directGrants,
        signer,
        signerUserId,
      });
      const root = scenario === "root";
      const previous = await createContainerManifestFixture({
        containerId: "rotation-child",
        containerKeyEpochId: "old-epoch",
        directGrants,
        signer,
        signerUserId,
        parentContainerId: root ? null : parent.state.containerId,
        parentManifestHash: root ? null : parent.manifestHash,
      });
      const parentManifestHash =
        scenario === "stale" ? "f".repeat(64) : parent.manifestHash;
      const rotation = {
        parentManifestHash,
        containerKeyEpochId: "new-epoch",
        containerKeyPublicKey: containerWrappingPublicKeyForTest("new-epoch"),
        keyringHash: "1".repeat(64),
        predecessorBridgeHash: "0".repeat(64),
      };
      const body:
        | ContainerRekeyAccessEventBody
        | ContainerRevokeAccessEventBody =
        eventType === "container.rekey"
          ? { ...rotation, eventType, referencedPrincipalHeads: [] }
          : {
              ...rotation,
              eventType,
              subjectType: "user",
              subjectId: "absent-user",
            };
      const event = await createVerifiedContainerAccessEvent({
        body,
        objectId: previous.state.containerId,
        organizationId: previous.state.organizationId,
        previousManifestHash: previous.manifestHash,
        dependencyManifestHashes:
          scenario === "unsigned" ? [] : [parentManifestHash],
        signer,
        signerUserId,
      });
      const manifest = await deriveContainerAccessManifest({
        ...previous.state,
        epoch: 2,
        eventHash: event.eventHash,
        previousManifestHash: previous.manifestHash,
        parentManifestHash: root ? null : parentManifestHash,
        containerKeyEpochId: rotation.containerKeyEpochId,
        containerKeyPublicKey: rotation.containerKeyPublicKey,
      });
      const result = await verifyContainerAccessManifest({
        manifest,
        expectedManifestHash: await computeAccessManifestHash(manifest),
        event,
        previousManifest: previous,
        previousContainerPath: root ? [previous] : [parent, previous],
      });
      if (scenario === "current") {
        expect(result.ok).toBe(true);
      } else {
        expect(result.ok).toBe(false);
        if (!result.ok) {
          expect(result.error.code).toBe(
            root ? "object_mismatch" : "missing_dependency",
          );
          expect(result.error.message).toBe(
            root
              ? "root rotation must not cite a parent"
              : scenario === "stale"
                ? `${eventType} parent manifest hash mismatch`
                : "container rotation requires its signed parent citation",
          );
        }
      }
    });
  }
}
