import { expect, test } from "bun:test";
import {
  db,
  withDatabaseStatementCounter,
} from "@tearleads/api-shared/postgres";
import { DOCUMENT_SYNC_ERROR_CODES } from "@tearleads/validators/response";
import {
  createVerifiedContainerManifest,
  createVerifiedDocumentLinkSetManifest,
  insertContainerKeyEpoch,
} from "../../../test/helpers/documentContentKeyStoreFixtures";
import { staleLink } from "../../../test/helpers/documentKekTargetFixtures";
import { storeVerifiedAccessManifest } from "../write/accessManifestStore";
import {
  assertDocumentKekTargetsCurrent,
  resolveCurrentDocumentKekTargets,
} from "./documentKekTargets";

test("assertDocumentKekTargetsCurrent rejects stale target hashes", async () => {
  const organizationId = crypto.randomUUID();
  const documentId = crypto.randomUUID();
  const containerId = crypto.randomUUID();
  const firstContainerManifest = await createVerifiedContainerManifest({
    containerId,
    organizationId,
    salt: "initial",
  });
  await storeVerifiedAccessManifest(
    {
      verifiedManifest: firstContainerManifest,
    },
    db,
  );
  await insertContainerKeyEpoch({
    containerId,
    keyEpochId: `${containerId}:key-epoch-1`,
    manifestHash: firstContainerManifest.manifestHash,
  });
  const documentManifest = await createVerifiedDocumentLinkSetManifest({
    containerManifestHashes: [firstContainerManifest.manifestHash],
    documentId,
    linkedContainerIds: [containerId],
    organizationId,
  });
  await storeVerifiedAccessManifest(
    {
      verifiedManifest: documentManifest,
    },
    db,
  );
  const oldTargets = await resolveCurrentDocumentKekTargets(documentId, db);
  const nextContainerManifest = await createVerifiedContainerManifest({
    containerId,
    epoch: 2,
    organizationId,
    previousManifestHash: firstContainerManifest.manifestHash,
    salt: "next",
  });
  await storeVerifiedAccessManifest(
    {
      verifiedManifest: nextContainerManifest,
    },
    db,
  );

  await expect(
    assertDocumentKekTargetsCurrent(
      {
        documentId,
        expectedTargetHash: oldTargets.documentKeyTargetHash,
      },
      db,
    ),
  ).rejects.toMatchObject({
    message: "Document KEK targets are stale",
    status: 409,
    code: DOCUMENT_SYNC_ERROR_CODES.stateStale,
  });
});

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
});
