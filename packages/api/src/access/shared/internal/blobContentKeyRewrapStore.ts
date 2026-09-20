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
  assertTargetsMatchCurrent,
  BlobContentKeyBundleError,
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
  assertTargetsMatchCurrent({
    currentTargets: { ...currentTargets, targets: documentTargets },
    origin: "submission",
    targets: rewrap.targets,
  });
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
