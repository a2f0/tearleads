import { expect, test } from "bun:test";
import { db } from "@tearleads/api-shared/postgres";
import { computeDocumentContentKeyTargetHash } from "@tearleads/crypto";
import { DOCUMENT_SYNC_ERROR_CODES } from "@tearleads/validators/response";
import { contentKeyEnvelopeFixture } from "../../../test/helpers/contentKeyEnvelope";
import {
  createVerifiedContainerManifest,
  createVerifiedDocumentLinkSetManifest,
  setupDocumentTargets,
  targetEnvelopes,
} from "../../../test/helpers/documentContentKeyStoreFixtures";
import { getLatestCurrentDocumentContentKeyBundle } from "../read/documentContentKeyStore";
import { resolveCurrentDocumentKekTargets } from "../read/documentKekTargets";
import { storeVerifiedAccessManifest } from "./accessManifestStore";
import {
  DocumentContentKeyBundleError,
  requireAndRefreshCurrentDocumentContentKeyBundle,
  storeDocumentContentKeyBundle,
} from "./documentContentKeyStore";

test("storeDocumentContentKeyBundle stores one canonical bundle for current targets", async () => {
  const { documentId } = await setupDocumentTargets(2);
  const currentTargets = await resolveCurrentDocumentKekTargets(documentId, db);
  const envelopes = targetEnvelopes(currentTargets);
  const stored = await storeDocumentContentKeyBundle(
    {
      documentId,
      contentKeyEpoch: 1,
      linkSetManifestHash: currentTargets.linkSetManifestHash,
      targetHash: currentTargets.documentKeyTargetHash,
      targets: envelopes,
    },
    db,
  );

  expect(stored.targets).toEqual(envelopes);
  expect(stored.currentTargets.documentKeyTargetHash).toBe(
    currentTargets.documentKeyTargetHash,
  );
  expect(stored.currentTargets.linkSetManifestHash).toBe(
    currentTargets.linkSetManifestHash,
  );

  await expect(
    storeDocumentContentKeyBundle(
      {
        documentId,
        contentKeyEpoch: 1,
        linkSetManifestHash: currentTargets.linkSetManifestHash,
        targetHash: currentTargets.documentKeyTargetHash,
        targets: targetEnvelopes(currentTargets, "different-material"),
      },
      db,
    ),
  ).rejects.toMatchObject(
    // Coded stateStale so a losing concurrent writer (e.g. a racing
    // stale-bundle heal) refetches the winner's state and retries instead of
    // treating the conflict as terminal.
    new DocumentContentKeyBundleError(
      "Document content-key bundle conflict",
      409,
      DOCUMENT_SYNC_ERROR_CODES.stateStale,
    ),
  );
});

test("storeDocumentContentKeyBundle rejects missing extra duplicate and stale targets", async () => {
  const { documentId } = await setupDocumentTargets(2);
  const currentTargets = await resolveCurrentDocumentKekTargets(documentId, db);
  const envelopes = targetEnvelopes(currentTargets);
  const firstEnvelope = envelopes[0];
  if (!firstEnvelope) {
    throw new Error("Expected at least one document content-key target");
  }
  const missingTarget = envelopes.slice(0, 1);
  const extraTarget = [
    ...envelopes,
    {
      ...firstEnvelope,
      containerId: crypto.randomUUID(),
      // A well-shaped envelope: the target hash check refuses this set before
      // either the count check or the envelope gate is reached, and the
      // fixture keeps that true if the order ever changes.
      wrappedKey: contentKeyEnvelopeFixture("Document", "extra").wrappedKey,
    },
  ];
  const duplicateTarget = [...envelopes, { ...firstEnvelope }];
  const staleTargetHash = await computeDocumentContentKeyTargetHash(
    currentTargets.targets.slice(0, 1),
  );

  for (const targets of [missingTarget, extraTarget, duplicateTarget]) {
    await expect(
      storeDocumentContentKeyBundle(
        {
          documentId,
          contentKeyEpoch: 1,
          linkSetManifestHash: currentTargets.linkSetManifestHash,
          targetHash: currentTargets.documentKeyTargetHash,
          targets,
        },
        db,
      ),
    ).rejects.toBeInstanceOf(DocumentContentKeyBundleError);
  }

  await expect(
    storeDocumentContentKeyBundle(
      {
        documentId,
        contentKeyEpoch: 1,
        linkSetManifestHash: currentTargets.linkSetManifestHash,
        targetHash: staleTargetHash,
        targets: missingTarget,
      },
      db,
    ),
  ).rejects.toMatchObject(
    new DocumentContentKeyBundleError(
      "Document KEK targets are stale",
      409,
      DOCUMENT_SYNC_ERROR_CODES.stateStale,
    ),
  );
});

test("storeDocumentContentKeyBundle allows additive target growth on the same content key epoch", async () => {
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
  const expandedManifest = await createVerifiedDocumentLinkSetManifest({
    containerManifestHashes: [
      setup.firstContainer.manifestHash,
      setup.secondContainer.manifestHash,
    ],
    documentId: setup.documentId,
    epoch: 2,
    linkedContainerIds: [setup.firstContainerId, setup.secondContainerId],
    organizationId: setup.organizationId,
    previousManifestHash: setup.documentManifest.manifestHash,
  });
  await storeVerifiedAccessManifest({ verifiedManifest: expandedManifest }, db);
  const expandedTargets = await resolveCurrentDocumentKekTargets(
    setup.documentId,
    db,
  );
  const expandedEnvelopes = expandedTargets.targets.map((target) => {
    const existing = initialEnvelopes.find(
      (envelope) => envelope.containerId === target.containerId,
    );
    return (
      existing ?? {
        ...target,
        ...contentKeyEnvelopeFixture(
          "Document",
          `${target.containerId}:expanded`,
        ),
      }
    );
  });

  const stored = await storeDocumentContentKeyBundle(
    {
      documentId: setup.documentId,
      contentKeyEpoch: 1,
      linkSetManifestHash: expandedTargets.linkSetManifestHash,
      targetHash: expandedTargets.documentKeyTargetHash,
      targets: expandedEnvelopes,
    },
    db,
  );

  expect(stored.contentKeyEpoch).toBe(1);
  expect(stored.targets).toEqual(expandedEnvelopes);
});

test("storeDocumentContentKeyBundle refreshes same-epoch container manifest targets", async () => {
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
  const advancedContainer = await createVerifiedContainerManifest({
    containerId: setup.firstContainerId,
    containerKeyEpochId: `${setup.firstContainerId}:key-epoch-1`,
    epoch: 2,
    organizationId: setup.organizationId,
    previousManifestHash: setup.firstContainer.manifestHash,
    salt: "first-additive-share",
  });
  await storeVerifiedAccessManifest(
    { verifiedManifest: advancedContainer },
    db,
  );
  const refreshedTargets = await resolveCurrentDocumentKekTargets(
    setup.documentId,
    db,
  );
  const refreshedEnvelopes = refreshedTargets.targets.map((target) => {
    const existing = initialEnvelopes.find(
      (envelope) => envelope.containerId === target.containerId,
    );
    if (!existing) {
      throw new Error("Expected existing target envelope");
    }
    return {
      ...target,
      wrappedKey: existing.wrappedKey,
      wrappingMetadata: existing.wrappingMetadata,
    };
  });

  expect(refreshedTargets.targets[0]?.containerManifestHash).toBe(
    advancedContainer.manifestHash,
  );
  await expect(
    getLatestCurrentDocumentContentKeyBundle(
      {
        currentTargets: refreshedTargets,
        documentId: setup.documentId,
      },
      db,
    ),
  ).resolves.toMatchObject({
    linkSetManifestHash: refreshedTargets.linkSetManifestHash,
    targetHash: refreshedTargets.documentKeyTargetHash,
    targets: refreshedEnvelopes,
  });

  const refreshedBundle =
    await requireAndRefreshCurrentDocumentContentKeyBundle({
      documentId: setup.documentId,
      contentKeyEpoch: 1,
      expectedLinkSetManifestHash: refreshedTargets.linkSetManifestHash,
      expectedTargetHash: refreshedTargets.documentKeyTargetHash,
      executor: db,
    });

  expect(refreshedBundle.contentKeyEpoch).toBe(1);
  expect(refreshedBundle.targets).toEqual(refreshedEnvelopes);

  const stored = await storeDocumentContentKeyBundle(
    {
      documentId: setup.documentId,
      contentKeyEpoch: 1,
      linkSetManifestHash: refreshedTargets.linkSetManifestHash,
      targetHash: refreshedTargets.documentKeyTargetHash,
      targets: refreshedEnvelopes,
    },
    db,
  );

  expect(stored.contentKeyEpoch).toBe(1);
  expect(stored.targets).toEqual(refreshedEnvelopes);
});
