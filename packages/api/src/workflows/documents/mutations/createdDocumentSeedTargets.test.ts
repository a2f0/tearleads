import { expect, test } from "bun:test";
import {
  db,
  withDatabaseStatementCounter,
} from "@tearleads/api-shared/postgres";
import {
  createVerifiedContainerManifest,
  createVerifiedDocumentLinkSetManifest,
  insertContainerKeyEpoch,
} from "../../../../test/helpers/documentContentKeyStoreFixtures";
import { documentHeadGuardFixture } from "../../../../test/helpers/documentHeadGuardFixture";
import { staleLink } from "../../../../test/helpers/documentKekTargetFixtures";
import { lockAccessManifestHeadRows } from "../../../access/read/accessManifestStore";
import {
  assertDocumentKekTargetsCurrent,
  resolveCurrentDocumentKekTargets,
} from "../../../access/read/documentKekTargets";
import { storeVerifiedAccessManifest } from "../../../access/write/accessManifestStore";
import { lockSyncDocumentWriteFrontier } from "./syncWriteFrontier";

// Internal fallback tests: old and new targets come from distinct genuine
// signed heads. They do not invent a seed path with intervening link writes.
for (const acquire of ["container", "document"] as const) {
  test(`newly acquired ${acquire} rows supersede earlier create targets`, async () => {
    const f = await documentHeadGuardFixture();
    const containerIds = f.currentManifest.state.linkedContainerIds;
    expect(f.previousTargets.targets.linkSetManifestHash).not.toBe(
      f.currentManifest.manifestHash,
    );
    await db.transaction(async (tx) => {
      if (acquire === "document") {
        await lockAccessManifestHeadRows(
          "container",
          containerIds,
          tx,
          "share",
        );
      } else {
        await lockAccessManifestHeadRows(
          "document",
          [f.document.id],
          tx,
          "update",
        );
      }
      const result = lockSyncDocumentWriteFrontier({
        createdTargets: f.previousTargets,
        authorizingContainerIds: containerIds,
        documentId: f.document.id,
        frontier: {
          linkSetManifestHash: f.currentManifest.manifestHash,
          linkedContainerIds: containerIds,
        },
        tx,
      });
      await expect(result).resolves.toMatchObject({
        targets: { linkSetManifestHash: f.currentManifest.manifestHash },
      });
      expect(
        (await result).targets.targets
          .map((target) => target.containerId)
          .sort(),
      ).toEqual([...containerIds].sort());
    });
  });
}

test("assertDocumentKekTargetsCurrent reuses a target read only at the same strictness", async () => {
  const organizationId = crypto.randomUUID();
  const documentId = crypto.randomUUID();
  const rootContainerId = crypto.randomUUID();
  const childContainerId = crypto.randomUUID();
  const rootKeyEpochId = `${rootContainerId}:key-epoch-1`;
  const childKeyEpochId = `${childContainerId}:key-epoch-1`;
  const root = await createVerifiedContainerManifest({
    containerId: rootContainerId,
    containerKeyEpochId: rootKeyEpochId,
    organizationId,
    salt: "root",
  });
  const child = await createVerifiedContainerManifest({
    containerId: childContainerId,
    containerKeyEpochId: childKeyEpochId,
    organizationId,
    parentContainerId: rootContainerId,
    parentManifestHash: root.manifestHash,
    salt: "child",
  });
  await storeVerifiedAccessManifest({ verifiedManifest: root }, db);
  await storeVerifiedAccessManifest({ verifiedManifest: child }, db);
  await insertContainerKeyEpoch({
    containerId: rootContainerId,
    keyEpochId: rootKeyEpochId,
    manifestHash: root.manifestHash,
  });
  await insertContainerKeyEpoch({
    containerId: childContainerId,
    keyEpochId: childKeyEpochId,
    manifestHash: child.manifestHash,
    parentContainerKeyEpochId: rootKeyEpochId,
  });
  const documentManifest = await createVerifiedDocumentLinkSetManifest({
    containerManifestHashes: [child.manifestHash],
    documentId,
    linkedContainerIds: [childContainerId],
    organizationId,
  });
  await storeVerifiedAccessManifest({ verifiedManifest: documentManifest }, db);
  // Rotating the root leaves the child's parent edge historical: a lenient
  // read accepts it and a strict one refuses it.
  const rotatedRootKeyEpochId = `${rootContainerId}:key-epoch-2`;
  const rotatedRoot = await createVerifiedContainerManifest({
    containerId: rootContainerId,
    containerKeyEpochId: rotatedRootKeyEpochId,
    epoch: 2,
    organizationId,
    previousManifestHash: root.manifestHash,
    salt: "root-rotated",
  });
  await storeVerifiedAccessManifest({ verifiedManifest: rotatedRoot }, db);
  await insertContainerKeyEpoch({
    containerId: rootContainerId,
    keyEpoch: 2,
    keyEpochId: rotatedRootKeyEpochId,
    manifestHash: rotatedRoot.manifestHash,
  });
  const lenient = await resolveCurrentDocumentKekTargets(documentId, db, true);
  const lenientRead = { allowHistoricalParentEpochs: true, targets: lenient };

  const counter = { statements: 0 };
  await expect(
    withDatabaseStatementCounter(counter, () =>
      assertDocumentKekTargetsCurrent(
        {
          allowHistoricalParentEpochs: true,
          documentId,
          expectedTargetHash: lenient.documentKeyTargetHash,
        },
        db,
        lenientRead,
      ),
    ),
  ).resolves.toBe(lenient);
  expect(counter.statements).toBe(0);

  // A strict check never trusts the lenient read: it resolves again.
  await expect(
    assertDocumentKekTargetsCurrent(
      { documentId, expectedTargetHash: lenient.documentKeyTargetHash },
      db,
      lenientRead,
    ),
  ).rejects.toEqual(staleLink("parent edge", childContainerId));
  // Nor does a check of another document.
  await expect(
    assertDocumentKekTargetsCurrent(
      {
        allowHistoricalParentEpochs: true,
        documentId: crypto.randomUUID(),
        expectedTargetHash: lenient.documentKeyTargetHash,
      },
      db,
      lenientRead,
    ),
  ).rejects.toMatchObject({ status: 404 });
  // Even with every head already locked, the create-seed frontier seam must
  // not reinterpret this genuine historical-parent read as a strict one.
  await db.transaction(async (tx) => {
    await lockAccessManifestHeadRows(
      "container",
      [rootContainerId, childContainerId],
      tx,
      "share",
    );
    await lockAccessManifestHeadRows("document", [documentId], tx, "update");
    await expect(
      lockSyncDocumentWriteFrontier({
        createdTargets: lenientRead,
        authorizingContainerIds: [rootContainerId, childContainerId],
        documentId,
        frontier: {
          linkSetManifestHash: documentManifest.manifestHash,
          linkedContainerIds: [childContainerId],
        },
        tx,
      }),
    ).rejects.toEqual(staleLink("parent edge", childContainerId));
  });
});
