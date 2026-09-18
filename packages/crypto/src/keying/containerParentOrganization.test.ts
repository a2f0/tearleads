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
import type { ContainerAccessEventBody } from "./types";

for (const eventType of ["container.create", "container.move"] as const) {
  for (const foreign of [false, true]) {
    test(`${eventType} enforces its parent organization (foreign=${foreign})`, async () => {
      const signer = generateSigningSeedAndKeyPair();
      const signerUserId = "admin";
      const directGrants = [
        {
          subjectType: "user" as const,
          subjectId: signerUserId,
          accessLevel: "admin" as const,
        },
      ];
      const originalParent = await createContainerManifestFixture({
        containerId: "original-root",
        organizationId: "org",
        directGrants,
        signer,
        signerUserId,
      });
      const previous = await createContainerManifestFixture({
        parentContainerId: originalParent.state.containerId,
        parentManifestHash: originalParent.manifestHash,
        containerId: "child",
        organizationId: "org",
        directGrants,
        signer,
        signerUserId,
      });
      const parent = await createContainerManifestFixture({
        containerId: "parent",
        organizationId: foreign ? "foreign" : "org",
        directGrants,
        signer,
        signerUserId,
      });
      const body: ContainerAccessEventBody =
        eventType === "container.create"
          ? {
              containerKeyPublicKey:
                containerWrappingPublicKeyForTest("new-key"),
              eventType,
              parentContainerId: parent.state.containerId,
              parentManifestHash: parent.manifestHash,
              systemSlot: null,
              metadataDocumentId: previous.state.metadataDocumentId,
              containerKeyEpochId: "new-key",
              directGrants,
              referencedPrincipalHeads: [],
            }
          : {
              containerKeyPublicKey:
                containerWrappingPublicKeyForTest("new-key"),
              eventType,
              parentContainerId: parent.state.containerId,
              parentManifestHash: parent.manifestHash,
              containerKeyEpochId: "new-key",
              keyringHash: "1".repeat(64),
              predecessorBridgeHash: "0".repeat(64),
            };
      const creating = eventType === "container.create";
      const event = await createVerifiedContainerAccessEvent({
        body,
        objectId: "child",
        organizationId: "org",
        previousManifestHash: creating ? null : previous.manifestHash,
        signer,
        signerUserId,
      });
      const manifest = await deriveContainerAccessManifest({
        ...previous.state,
        containerKeyPublicKey: body.containerKeyPublicKey,
        eventHash: event.eventHash,
        epoch: creating ? 1 : 2,
        previousManifestHash: creating ? null : previous.manifestHash,
        parentContainerId: parent.state.containerId,
        parentManifestHash: parent.manifestHash,
        containerKeyEpochId: "new-key",
      });
      const result = await verifyContainerAccessManifest({
        manifest,
        expectedManifestHash: await computeAccessManifestHash(manifest),
        event,
        ...(creating
          ? { parentContainerPath: [parent] }
          : {
              previousManifest: previous,
              previousContainerPath: [originalParent, previous],
              destinationParentContainerPath: [parent],
            }),
      });
      expect(result.ok).toBe(!foreign);
      if (!result.ok) expect(result.error.code).toBe("object_mismatch");
    });
  }
}
