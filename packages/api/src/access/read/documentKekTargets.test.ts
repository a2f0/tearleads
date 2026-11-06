import { expect, test } from "bun:test";
import { db } from "@tearleads/api-shared/postgres";
import { computeDocumentContentKeyTargetHash } from "@tearleads/crypto";
import {
  createVerifiedContainerManifest,
  createVerifiedDocumentLinkSetManifest,
  insertContainerKeyEpoch,
} from "../../../test/helpers/documentContentKeyStoreFixtures";
import { staleLink } from "../../../test/helpers/documentKekTargetFixtures";
import { storeVerifiedAccessManifest } from "../write/accessManifestStore";
import { resolveCurrentDocumentKekTargets } from "./documentKekTargets";

test("resolveCurrentDocumentKekTargets derives targets from linked container heads", async () => {
  const organizationId = crypto.randomUUID();
  const documentId = crypto.randomUUID();
  const firstContainerId = crypto.randomUUID();
  const secondContainerId = crypto.randomUUID();
  const firstContainer = await createVerifiedContainerManifest({
    containerId: firstContainerId,
    organizationId,
    salt: "first",
  });
  const secondContainer = await createVerifiedContainerManifest({
    containerId: secondContainerId,
    organizationId,
    salt: "second",
  });
  await storeVerifiedAccessManifest({ verifiedManifest: firstContainer }, db);
  await storeVerifiedAccessManifest({ verifiedManifest: secondContainer }, db);
  await insertContainerKeyEpoch({
    containerId: firstContainerId,
    keyEpochId: `${firstContainerId}:key-epoch-1`,
    manifestHash: firstContainer.manifestHash,
  });
  await insertContainerKeyEpoch({
    containerId: secondContainerId,
    keyEpochId: `${secondContainerId}:key-epoch-1`,
    manifestHash: secondContainer.manifestHash,
  });
  const documentManifest = await createVerifiedDocumentLinkSetManifest({
    containerManifestHashes: [
      firstContainer.manifestHash,
      secondContainer.manifestHash,
    ],
    documentId,
    linkedContainerIds: [secondContainerId, firstContainerId],
    organizationId,
  });
  await storeVerifiedAccessManifest(
    {
      verifiedManifest: documentManifest,
    },
    db,
  );

  const targets = await resolveCurrentDocumentKekTargets(documentId, db);
  const expectedTargets = [
    {
      containerId: firstContainerId,
      containerManifestHash: firstContainer.manifestHash,
      containerKeyEpochId: `${firstContainerId}:key-epoch-1`,
      containerKeyEpoch: 1,
    },
    {
      containerId: secondContainerId,
      containerManifestHash: secondContainer.manifestHash,
      containerKeyEpochId: `${secondContainerId}:key-epoch-1`,
      containerKeyEpoch: 1,
    },
  ].sort((left, right) => left.containerId.localeCompare(right.containerId));

  expect(targets.linkSetManifestHash).toBe(documentManifest.manifestHash);
  expect(targets.targets).toEqual(expectedTargets);
  expect(targets.documentKeyTargetHash).toBe(
    await computeDocumentContentKeyTargetHash(targets.targets),
  );
});

test("resolveCurrentDocumentKekTargets uses the container manifest key epoch", async () => {
  const organizationId = crypto.randomUUID();
  const documentId = crypto.randomUUID();
  const containerId = crypto.randomUUID();
  const container = await createVerifiedContainerManifest({
    containerId,
    organizationId,
    salt: "manifest-key-epoch",
  });
  const manifestKeyEpochId = `${containerId}:key-epoch-1`;
  await storeVerifiedAccessManifest({ verifiedManifest: container }, db);
  await insertContainerKeyEpoch({
    containerId,
    keyEpochId: manifestKeyEpochId,
    manifestHash: container.manifestHash,
  });
  await insertContainerKeyEpoch({
    containerId,
    keyEpoch: 2,
    keyEpochId: `${containerId}:unreferenced-key-epoch-2`,
    manifestHash: container.manifestHash,
  });
  const documentManifest = await createVerifiedDocumentLinkSetManifest({
    containerManifestHashes: [container.manifestHash],
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

  const targets = await resolveCurrentDocumentKekTargets(documentId, db);

  expect(targets.targets).toEqual([
    {
      containerId,
      containerManifestHash: container.manifestHash,
      containerKeyEpochId: manifestKeyEpochId,
      containerKeyEpoch: 1,
    },
  ]);
});

test("resolveCurrentDocumentKekTargets rejects key epochs bound outside current same-epoch history", async () => {
  const organizationId = crypto.randomUUID();
  const documentId = crypto.randomUUID();
  const containerId = crypto.randomUUID();
  const initialKeyEpochId = `${containerId}:key-epoch-1`;
  const currentKeyEpochId = `${containerId}:key-epoch-2`;
  const initialContainer = await createVerifiedContainerManifest({
    containerId,
    containerKeyEpochId: initialKeyEpochId,
    organizationId,
    salt: "initial-key-epoch",
  });
  const currentContainer = await createVerifiedContainerManifest({
    containerId,
    containerKeyEpochId: currentKeyEpochId,
    epoch: 2,
    organizationId,
    previousManifestHash: initialContainer.manifestHash,
    salt: "current-key-epoch",
  });
  await storeVerifiedAccessManifest({ verifiedManifest: initialContainer }, db);
  await storeVerifiedAccessManifest({ verifiedManifest: currentContainer }, db);
  await insertContainerKeyEpoch({
    containerId,
    keyEpoch: 2,
    keyEpochId: currentKeyEpochId,
    manifestHash: initialContainer.manifestHash,
  });
  const documentManifest = await createVerifiedDocumentLinkSetManifest({
    containerManifestHashes: [currentContainer.manifestHash],
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

  await expect(
    resolveCurrentDocumentKekTargets(documentId, db),
  ).rejects.toEqual(staleLink("epoch", containerId));
});

test("resolveCurrentDocumentKekTargets rejects linked containers with stale parent KEK edges", async () => {
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
  await storeVerifiedAccessManifest(
    {
      verifiedManifest: documentManifest,
    },
    db,
  );

  await expect(
    resolveCurrentDocumentKekTargets(documentId, db),
  ).resolves.toEqual(
    expect.objectContaining({
      linkedContainerKeyEpochIds: [childKeyEpochId],
    }),
  );

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

  await expect(
    resolveCurrentDocumentKekTargets(documentId, db),
  ).rejects.toEqual(staleLink("parent edge", childContainerId));

  const rotatedChildKeyEpochId = `${childContainerId}:key-epoch-2`;
  const rotatedChild = await createVerifiedContainerManifest({
    containerId: childContainerId,
    containerKeyEpochId: rotatedChildKeyEpochId,
    epoch: 2,
    organizationId,
    parentContainerId: rootContainerId,
    parentManifestHash: rotatedRoot.manifestHash,
    previousManifestHash: child.manifestHash,
    salt: "child-rotated",
  });
  await storeVerifiedAccessManifest({ verifiedManifest: rotatedChild }, db);
  await insertContainerKeyEpoch({
    containerId: childContainerId,
    keyEpoch: 2,
    keyEpochId: rotatedChildKeyEpochId,
    manifestHash: rotatedChild.manifestHash,
    parentContainerKeyEpochId: rotatedRootKeyEpochId,
  });

  await expect(
    resolveCurrentDocumentKekTargets(documentId, db),
  ).resolves.toEqual(
    expect.objectContaining({
      linkedContainerKeyEpochIds: [rotatedChildKeyEpochId],
    }),
  );
});
