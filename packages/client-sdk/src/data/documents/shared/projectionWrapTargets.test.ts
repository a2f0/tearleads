import { expect, test } from "bun:test";
import {
  computeDocumentContentKeyTargetHash,
  KeyingVerificationError,
} from "@tearleads/crypto";
import type { DocumentWriterProjectionResponse } from "@tearleads/validators/response";
import { createStaleBundleSyncFixture } from "../../../../test/helpers/staleBundleSyncFixture";
import { deriveBlobTargetsFromDocumentProjection } from "../blob/shared/projection";
import {
  assertDocumentWriterProjectionConsistent,
  buildRotatedDocumentContentKeyBundle,
  collectContainerKeksForDocumentSync,
} from "./projection";
import { targetEnvelopeReference, uniqueSortedStrings } from "./readers";

// A compromised API controls `documentKekTargets`. Listing a linked container
// a second time at a superseded epoch — one a revoked member still holds, and
// one the honest client still has through the sealed keyring — would make the
// stale-bundle heal and the blob upload wrap a fresh content key under it.
// Every wrap must land only on a verified authorizing-path leaf.

async function poisonedStaleProjection() {
  const fixture = await createStaleBundleSyncFixture();
  const stale = fixture.staleWriterProjection;
  const [staleEnvelope] = fixture.staleBundle.targets;
  if (!staleEnvelope) {
    throw new Error("Expected the stale bundle to carry an envelope");
  }
  const predecessorTarget = targetEnvelopeReference(staleEnvelope);
  const targets = [fixture.rotatedTarget, predecessorTarget];
  const poisoned: DocumentWriterProjectionResponse = {
    ...stale,
    documentKekTargets: {
      ...stale.documentKekTargets,
      documentKeyTargetHash: await computeDocumentContentKeyTargetHash(targets),
      linkedContainerKeyEpochIds: uniqueSortedStrings(
        targets.map((target) => target.containerKeyEpochId),
      ),
      linkedContainerManifestHashes: uniqueSortedStrings(
        targets.map((target) => target.containerManifestHash),
      ),
      targets: targets.map((target) => ({ ...target })),
    },
  };
  // The honest client holds both epochs: the rotated head from its current
  // path and the predecessor from history.
  const { keksByEpochId } = await collectContainerKeksForDocumentSync({
    secretKey: fixture.secretKey,
    trustedLocalProjection: true,
    writerProjection: {
      ...poisoned,
      authorizingContainerPaths: [
        ...stale.authorizingContainerPaths,
        fixture.projection,
      ],
    },
  });
  expect(keksByEpochId.has(predecessorTarget.containerKeyEpochId)).toBe(true);
  expect(keksByEpochId.has(fixture.rotatedTarget.containerKeyEpochId)).toBe(
    true,
  );
  return { fixture, keksByEpochId, poisoned, predecessorTarget, stale };
}

test("the stale-bundle heal refuses a linked container listed at two epochs", async () => {
  const { fixture, keksByEpochId, poisoned } = await poisonedStaleProjection();

  await expect(
    buildRotatedDocumentContentKeyBundle({
      containerKeksByEpochId: keksByEpochId,
      contentKey: crypto.getRandomValues(new Uint8Array(32)),
      writerProjection: poisoned,
    }),
  ).rejects.toMatchObject({ code: "duplicate_entry" });

  await expect(
    assertDocumentWriterProjectionConsistent(poisoned, {
      allowStaleContentKeyBundle: true,
      trustedLocalProjection: true,
    }),
  ).rejects.toThrow("more than once");

  const healed = await buildRotatedDocumentContentKeyBundle({
    containerKeksByEpochId: keksByEpochId,
    contentKey: crypto.getRandomValues(new Uint8Array(32)),
    writerProjection: fixture.staleWriterProjection,
  });
  expect(healed.targets.map((target) => target.containerKeyEpochId)).toEqual([
    fixture.rotatedTarget.containerKeyEpochId,
  ]);
});

test("the stale-bundle heal refuses a target that is not the verified head", async () => {
  const { keksByEpochId, poisoned, predecessorTarget, stale } =
    await poisonedStaleProjection();
  const predecessorOnly: DocumentWriterProjectionResponse = {
    ...poisoned,
    documentKekTargets: {
      ...stale.documentKekTargets,
      documentKeyTargetHash: await computeDocumentContentKeyTargetHash([
        predecessorTarget,
      ]),
      linkedContainerKeyEpochIds: [predecessorTarget.containerKeyEpochId],
      linkedContainerManifestHashes: [predecessorTarget.containerManifestHash],
      targets: [{ ...predecessorTarget }],
    },
  };

  await expect(
    buildRotatedDocumentContentKeyBundle({
      containerKeksByEpochId: keksByEpochId,
      contentKey: crypto.getRandomValues(new Uint8Array(32)),
      writerProjection: predecessorOnly,
    }),
  ).rejects.toBeInstanceOf(KeyingVerificationError);
});

test("blob upload targets come from verified leaves, not the server list", async () => {
  const { fixture, poisoned } = await poisonedStaleProjection();

  expect(() =>
    deriveBlobTargetsFromDocumentProjection({
      bindingId: "binding-1",
      documentId: poisoned.documentId,
      writerProjection: poisoned,
    }),
  ).toThrow(KeyingVerificationError);

  const targets = deriveBlobTargetsFromDocumentProjection({
    bindingId: "binding-1",
    documentId: fixture.staleWriterProjection.documentId,
    writerProjection: fixture.staleWriterProjection,
  });
  expect(targets.map((target) => target.containerKeyEpochId)).toEqual([
    fixture.rotatedTarget.containerKeyEpochId,
  ]);
});
