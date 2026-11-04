import { expect, test } from "bun:test";
import { db } from "@tearleads/api-shared/postgres";
import { DOCUMENT_SYNC_ERROR_CODES } from "@tearleads/validators/response";
import {
  createVerifiedContainerManifest,
  createVerifiedDocumentLinkSetManifest,
  insertContainerKeyEpoch,
  setupDocumentTargets,
  targetEnvelopes,
} from "../../../test/helpers/documentContentKeyStoreFixtures";
import { getLatestCurrentDocumentContentKeyBundle } from "../read/documentContentKeyStore";
import { resolveCurrentDocumentKekTargets } from "../read/documentKekTargets";
import { storeVerifiedAccessManifest } from "./accessManifestStore";
import {
  DocumentContentKeyBundleError,
  storeDocumentContentKeyBundle,
} from "./documentContentKeyStore";

test("storeDocumentContentKeyBundle requires a new content key epoch after container move", async () => {
  const setup = await setupDocumentTargets(1);
  const initialTargets = await resolveCurrentDocumentKekTargets(
    setup.documentId,
    db,
  );
  const initialEnvelopes = targetEnvelopes(initialTargets);
  await storeDocumentContentKeyBundle(
    {
      documentId: setup.documentId,
      contentKeyEpoch: 1,
      linkSetManifestHash: initialTargets.linkSetManifestHash,
      targetHash: initialTargets.documentKeyTargetHash,
      targets: initialEnvelopes,
    },
    db,
  );

  const movedKeyEpochId = `${setup.firstContainerId}:key-epoch-2`;
  const movedContainer = await createVerifiedContainerManifest({
    containerId: setup.firstContainerId,
    containerKeyEpochId: movedKeyEpochId,
    eventType: "container.move",
    epoch: 2,
    organizationId: setup.organizationId,
    parentContainerId: setup.secondContainerId,
    parentManifestHash: setup.secondContainer.manifestHash,
    previousManifestHash: setup.firstContainer.manifestHash,
    salt: "first-move",
  });
  await storeVerifiedAccessManifest({ verifiedManifest: movedContainer }, db);
  await insertContainerKeyEpoch({
    containerId: setup.firstContainerId,
    keyEpoch: 2,
    keyEpochId: movedKeyEpochId,
    manifestHash: movedContainer.manifestHash,
    parentContainerKeyEpochId: `${setup.secondContainerId}:key-epoch-1`,
  });

  const movedTargets = await resolveCurrentDocumentKekTargets(
    setup.documentId,
    db,
  );
  await expect(
    getLatestCurrentDocumentContentKeyBundle(
      {
        currentTargets: movedTargets,
        documentId: setup.documentId,
      },
      db,
    ),
  ).rejects.toMatchObject(
    new DocumentContentKeyBundleError(
      "Document content-key bundle is stale",
      409,
      DOCUMENT_SYNC_ERROR_CODES.stateStale,
    ),
  );

  await expect(
    storeDocumentContentKeyBundle(
      {
        documentId: setup.documentId,
        contentKeyEpoch: 1,
        linkSetManifestHash: movedTargets.linkSetManifestHash,
        targetHash: movedTargets.documentKeyTargetHash,
        targets: targetEnvelopes(movedTargets, "moved"),
      },
      db,
    ),
  ).rejects.toMatchObject(
    new DocumentContentKeyBundleError(
      "Document content key epoch must rotate after target key material changes",
      409,
    ),
  );

  const rotatedEnvelopes = targetEnvelopes(movedTargets, "rotated");
  await expect(
    storeDocumentContentKeyBundle(
      {
        documentId: setup.documentId,
        contentKeyEpoch: 2,
        linkSetManifestHash: movedTargets.linkSetManifestHash,
        targetHash: movedTargets.documentKeyTargetHash,
        targets: rotatedEnvelopes,
      },
      db,
    ),
  ).resolves.toMatchObject({
    contentKeyEpoch: 2,
    targets: rotatedEnvelopes,
  });
});

test("storeDocumentContentKeyBundle requires a new content key epoch after container rekey", async () => {
  const setup = await setupDocumentTargets(1);
  const initialTargets = await resolveCurrentDocumentKekTargets(
    setup.documentId,
    db,
  );
  await storeDocumentContentKeyBundle(
    {
      documentId: setup.documentId,
      contentKeyEpoch: 1,
      linkSetManifestHash: initialTargets.linkSetManifestHash,
      targetHash: initialTargets.documentKeyTargetHash,
      targets: targetEnvelopes(initialTargets),
    },
    db,
  );

  const rekeyedKeyEpochId = `${setup.firstContainerId}:key-epoch-2`;
  const rekeyedContainer = await createVerifiedContainerManifest({
    containerId: setup.firstContainerId,
    containerKeyEpochId: rekeyedKeyEpochId,
    eventType: "container.rekey",
    epoch: 2,
    organizationId: setup.organizationId,
    previousManifestHash: setup.firstContainer.manifestHash,
    salt: "first-rekey",
  });
  await storeVerifiedAccessManifest({ verifiedManifest: rekeyedContainer }, db);
  await insertContainerKeyEpoch({
    containerId: setup.firstContainerId,
    keyEpoch: 2,
    keyEpochId: rekeyedKeyEpochId,
    manifestHash: rekeyedContainer.manifestHash,
  });
  const rekeyedTargets = await resolveCurrentDocumentKekTargets(
    setup.documentId,
    db,
  );

  await expect(
    getLatestCurrentDocumentContentKeyBundle(
      {
        currentTargets: rekeyedTargets,
        documentId: setup.documentId,
      },
      db,
    ),
  ).rejects.toMatchObject(
    new DocumentContentKeyBundleError(
      "Document content-key bundle is stale",
      409,
      DOCUMENT_SYNC_ERROR_CODES.stateStale,
    ),
  );

  await expect(
    storeDocumentContentKeyBundle(
      {
        documentId: setup.documentId,
        contentKeyEpoch: 1,
        linkSetManifestHash: rekeyedTargets.linkSetManifestHash,
        targetHash: rekeyedTargets.documentKeyTargetHash,
        targets: targetEnvelopes(rekeyedTargets, "rekeyed"),
      },
      db,
    ),
  ).rejects.toMatchObject(
    new DocumentContentKeyBundleError(
      "Document content key epoch must rotate after target key material changes",
      409,
    ),
  );

  const rotatedEnvelopes = targetEnvelopes(rekeyedTargets, "rotated");
  await expect(
    storeDocumentContentKeyBundle(
      {
        documentId: setup.documentId,
        contentKeyEpoch: 2,
        linkSetManifestHash: rekeyedTargets.linkSetManifestHash,
        targetHash: rekeyedTargets.documentKeyTargetHash,
        targets: rotatedEnvelopes,
      },
      db,
    ),
  ).resolves.toMatchObject({
    contentKeyEpoch: 2,
    targets: rotatedEnvelopes,
  });
});

test("storeDocumentContentKeyBundle requires a new content key epoch after target shrink", async () => {
  const setup = await setupDocumentTargets(2);
  const initialTargets = await resolveCurrentDocumentKekTargets(
    setup.documentId,
    db,
  );
  await storeDocumentContentKeyBundle(
    {
      documentId: setup.documentId,
      contentKeyEpoch: 1,
      linkSetManifestHash: initialTargets.linkSetManifestHash,
      targetHash: initialTargets.documentKeyTargetHash,
      targets: targetEnvelopes(initialTargets),
    },
    db,
  );
  const shrunkManifest = await createVerifiedDocumentLinkSetManifest({
    containerManifestHashes: [setup.firstContainer.manifestHash],
    documentId: setup.documentId,
    epoch: 2,
    linkedContainerIds: [setup.firstContainerId],
    organizationId: setup.organizationId,
    previousManifestHash: setup.documentManifest.manifestHash,
  });
  await storeVerifiedAccessManifest({ verifiedManifest: shrunkManifest }, db);
  const shrunkTargets = await resolveCurrentDocumentKekTargets(
    setup.documentId,
    db,
  );
  const shrunkEnvelopes = targetEnvelopes(shrunkTargets, "rotated");

  await expect(
    storeDocumentContentKeyBundle(
      {
        documentId: setup.documentId,
        contentKeyEpoch: 1,
        linkSetManifestHash: shrunkTargets.linkSetManifestHash,
        targetHash: shrunkTargets.documentKeyTargetHash,
        targets: shrunkEnvelopes,
      },
      db,
    ),
  ).rejects.toMatchObject(
    new DocumentContentKeyBundleError(
      "Document content key epoch must rotate after target key material changes",
      409,
    ),
  );

  await expect(
    storeDocumentContentKeyBundle(
      {
        documentId: setup.documentId,
        contentKeyEpoch: 2,
        linkSetManifestHash: shrunkTargets.linkSetManifestHash,
        targetHash: shrunkTargets.documentKeyTargetHash,
        targets: shrunkEnvelopes,
      },
      db,
    ),
  ).resolves.toMatchObject({
    contentKeyEpoch: 2,
    targets: shrunkEnvelopes,
  });
});
