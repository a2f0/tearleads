import type { DatabaseTransaction } from "@tearleads/api-shared/postgres";
import {
  computeBlobContentKeyTargetHash,
  type DocumentLinkAccessEventBody,
} from "@tearleads/crypto";
import {
  getLatestBlobContentKeyBundle,
  getLatestBlobContentKeyBundles,
  replaceBlobContentKeyTargetsForExistingBundle,
} from "./blobContentKeyStore";
import {
  assertSubmittedTargetsMatchCurrent,
  BlobContentKeyBundleError,
  type StoredBlobContentKeyBundle,
} from "./blobContentKeyTargets";
import {
  type BlobKekTargetPrefetch,
  prefetchBlobKekTargets,
  resolveCurrentBlobKekTargets,
} from "./blobKekTargets";

type BlobRewrap = DocumentLinkAccessEventBody["blobRewraps"][number];

/**
 * A link's rewrap preconditions, read as sets after the blob rows are locked:
 * nothing a rewrap writes changes them, so later rewraps may still use them.
 */
export interface BlobRewrapPrefetch {
  readonly latestBundleByBlobId: ReadonlyMap<
    string,
    StoredBlobContentKeyBundle
  >;
  readonly targets: BlobKekTargetPrefetch;
}

export async function prefetchBlobRewraps(
  rewraps: readonly BlobRewrap[],
  executor: DatabaseTransaction,
): Promise<BlobRewrapPrefetch> {
  const blobIds = rewraps.map((rewrap) => rewrap.blobId);
  return {
    latestBundleByBlobId: await getLatestBlobContentKeyBundles(
      blobIds,
      executor,
    ),
    targets: await prefetchBlobKekTargets(blobIds, executor),
  };
}

/** Caller holds the changed document head and every affected blob row. */
export async function rewrapDocumentBlobContentKeyInTransaction(
  input: {
    documentId: string;
    prefetch?: BlobRewrapPrefetch | undefined;
    rewrap: BlobRewrap;
  },
  executor: DatabaseTransaction,
): Promise<void> {
  const { documentId, prefetch, rewrap } = input;
  const existingBundle = prefetch
    ? (prefetch.latestBundleByBlobId.get(rewrap.blobId) ?? null)
    : await getLatestBlobContentKeyBundle(rewrap.blobId, executor);
  if (
    !existingBundle ||
    existingBundle.contentKeyEpoch !== rewrap.contentKeyEpoch
  ) {
    throw new BlobContentKeyBundleError("Blob content key epoch changed", 409);
  }
  const currentTargets = await resolveCurrentBlobKekTargets(
    rewrap.blobId,
    executor,
    false,
    prefetch?.targets,
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
  assertSubmittedTargetsMatchCurrent({
    currentTargets: { ...currentTargets, targets: documentTargets },
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
