import type { DatabaseTransaction } from "@tearleads/api-shared/postgres";
import {
  computeBlobContentKeyTargetHash,
  type DocumentLinkAccessEventBody,
} from "@tearleads/crypto";
import {
  getLatestBlobContentKeyBundle,
  replaceBlobContentKeyTargetsForExistingBundle,
} from "./blobContentKeyStore";
import {
  assertSubmittedEnvelopes,
  assertTargetsMatchCurrent,
  BlobContentKeyBundleError,
  targetEnvelopeMaterialEqual,
} from "./blobContentKeyTargets";
import { resolveCurrentBlobKekTargets } from "./blobKekTargets";

/** Caller holds the changed document head and every affected blob row. */
export async function rewrapDocumentBlobContentKeyInTransaction(
  input: {
    documentId: string;
    rewrap: DocumentLinkAccessEventBody["blobRewraps"][number];
  },
  executor: DatabaseTransaction,
): Promise<void> {
  const { documentId, rewrap } = input;
  const existingBundle = await getLatestBlobContentKeyBundle(
    rewrap.blobId,
    executor,
  );
  if (
    !existingBundle ||
    existingBundle.contentKeyEpoch !== rewrap.contentKeyEpoch
  ) {
    throw new BlobContentKeyBundleError("Blob content key epoch changed", 409);
  }
  const currentTargets = await resolveCurrentBlobKekTargets(
    rewrap.blobId,
    executor,
  );
  const documentTargets = currentTargets.targets.filter(
    (target) => target.documentId === documentId,
  );
  if (
    documentTargets.length === 0 ||
    rewrap.targets.some((target) => target.documentId !== documentId)
  ) {
    throw new BlobContentKeyBundleError(
      "Blob rewrap must cover the changed document",
      409,
    );
  }
  // A relink resubmits a retained wrap verbatim, so this set mixes stored and
  // freshly wrapped material. Judging the stored half by the submission shape
  // would make a row carrying an unrecognized metadata key permanently
  // un-linkable, with no client-side heal; only new material is gated.
  //
  // "Stored" is the current bundle, not every row at the epoch. A retired
  // target is absent from the bundle the client reads, so it re-wraps rather
  // than resubmitting, and material for a target that is not currently stored
  // is new by definition.
  assertTargetsMatchCurrent({
    currentTargets: { ...currentTargets, targets: documentTargets },
    origin: "stored",
    targets: rewrap.targets,
  });
  assertSubmittedEnvelopes(
    rewrap.targets.filter(
      (target) =>
        !existingBundle.targets.some((stored) =>
          targetEnvelopeMaterialEqual(stored, target),
        ),
    ),
  );
  // Another document's retained wraps are independent. Its own link mutation
  // replaces only its scope under the same blob lock, so concurrent writers
  // cannot overwrite each other's keys or require access to each other's KEKs.
  const targets = [
    ...existingBundle.targets.filter(
      (target) => target.documentId !== documentId,
    ),
    ...rewrap.targets,
  ];
  const targetHash = await computeBlobContentKeyTargetHash(
    targets.map(
      ({
        wrappedKey: _wrappedKey,
        wrappingMetadata: _wrappingMetadata,
        ...target
      }) => target,
    ),
  );
  await replaceBlobContentKeyTargetsForExistingBundle({
    existingBundle,
    executor,
    nextBundle: {
      blobId: rewrap.blobId,
      contentKeyEpoch: rewrap.contentKeyEpoch,
      targetHash,
      targets,
    },
  });
}
