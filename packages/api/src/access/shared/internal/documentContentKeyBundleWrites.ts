import type { DatabaseSession } from "@tearleads/api-shared/postgres";
import {
  documentContentKeyEpochs,
  documentContentKeyTargets,
} from "@tearleads/api-shared/schema";
import { DOCUMENT_SYNC_ERROR_CODES } from "@tearleads/validators/response";
import { and, eq } from "drizzle-orm";
import { toStoredBundle } from "./documentContentKeyBundleReads";
import {
  DocumentContentKeyBundleError,
  type DocumentContentKeyTargetEnvelope,
  type StoredDocumentContentKeyBundle,
  targetEnvelopeEqual,
  targetEnvelopeMaterialEqual,
} from "./documentContentKeyTargets";
import type { DocumentKekTargetsRead } from "./documentKekTargets";

export interface StoreDocumentContentKeyBundleInput {
  /** Genuine immediate-create result, with no intervening bundle writes. */
  readonly createdBundle?: StoredDocumentContentKeyBundle | undefined;
  readonly documentId: string;
  readonly contentKeyEpoch: number;
  readonly linkSetManifestHash: string;
  /** Targets this transaction resolved under its locks; see `assertDocumentKekTargetsCurrent`. */
  readonly resolvedTargets?: DocumentKekTargetsRead;
  readonly targetHash: string;
  readonly targets: readonly DocumentContentKeyTargetEnvelope[];
}

export function staleBundle(text: string) {
  return new DocumentContentKeyBundleError(
    text,
    409,
    DOCUMENT_SYNC_ERROR_CODES.stateStale,
  );
}

export async function insertDocumentContentKeyTargets(input: {
  readonly documentContentKeyEpochId: string;
  readonly executor: DatabaseSession;
  readonly targets: readonly DocumentContentKeyTargetEnvelope[];
}) {
  if (input.targets.length === 0) {
    return;
  }

  await input.executor
    .insert(documentContentKeyTargets)
    .values(
      input.targets.map((target) => ({
        documentContentKeyEpochId: input.documentContentKeyEpochId,
        containerId: target.containerId,
        containerManifestHash: target.containerManifestHash,
        containerKeyEpochId: target.containerKeyEpochId,
        containerKeyEpoch: target.containerKeyEpoch,
        wrappedKey: target.wrappedKey,
        wrappingMetadata: target.wrappingMetadata,
      })),
    )
    .onConflictDoNothing({
      target: [
        documentContentKeyTargets.documentContentKeyEpochId,
        documentContentKeyTargets.containerId,
      ],
    });
}

async function updateDocumentContentKeyTargets(input: {
  readonly documentContentKeyEpochId: string;
  readonly executor: DatabaseSession;
  readonly targets: readonly DocumentContentKeyTargetEnvelope[];
}): Promise<void> {
  for (const target of input.targets) {
    await input.executor
      .update(documentContentKeyTargets)
      .set({
        containerManifestHash: target.containerManifestHash,
        containerKeyEpochId: target.containerKeyEpochId,
        containerKeyEpoch: target.containerKeyEpoch,
        wrappedKey: target.wrappedKey,
        wrappingMetadata: target.wrappingMetadata,
      })
      .where(
        and(
          eq(
            documentContentKeyTargets.documentContentKeyEpochId,
            input.documentContentKeyEpochId,
          ),
          eq(documentContentKeyTargets.containerId, target.containerId),
        ),
      );
  }
}

export async function addDocumentContentKeyTargetsToExistingBundle(input: {
  readonly existingBundle: StoredDocumentContentKeyBundle;
  readonly nextBundle: StoreDocumentContentKeyBundleInput;
  readonly executor: DatabaseSession;
}): Promise<StoredDocumentContentKeyBundle> {
  const existingByContainerId = new Map(
    input.existingBundle.targets.map((target) => [target.containerId, target]),
  );
  const nextByContainerId = new Map(
    input.nextBundle.targets.map((target) => [target.containerId, target]),
  );

  for (const target of input.existingBundle.targets) {
    const nextTarget = nextByContainerId.get(target.containerId);
    if (!nextTarget || !targetEnvelopeMaterialEqual(target, nextTarget)) {
      // Coded stateStale: a concurrent writer's bundle already occupies this
      // epoch with different envelopes (e.g. two devices racing to heal a
      // stale bundle each submit their own fresh key). The loser refetches
      // the projection, sees the winner's committed state, and resubmits
      // against it — the client's stateStale retry path.
      throw staleBundle("Document content-key bundle conflict");
    }
  }

  const newTargets = input.nextBundle.targets.filter(
    (target) => !existingByContainerId.has(target.containerId),
  );
  const refreshedTargets = input.nextBundle.targets.filter((target) => {
    const existing = existingByContainerId.get(target.containerId);
    return existing !== undefined && !targetEnvelopeEqual(existing, target);
  });
  // The update returns the epoch row as stored; the target writes below do
  // not touch it, so it needs neither a load before nor a reload after.
  const [epochRow] = await input.executor
    .update(documentContentKeyEpochs)
    .set({
      linkSetManifestHash: input.nextBundle.linkSetManifestHash,
      targetHash: input.nextBundle.targetHash,
      updatedAt: new Date(),
    })
    .where(
      and(
        eq(documentContentKeyEpochs.documentId, input.nextBundle.documentId),
        eq(
          documentContentKeyEpochs.contentKeyEpoch,
          input.nextBundle.contentKeyEpoch,
        ),
      ),
    )
    .returning();
  if (!epochRow) {
    throw new DocumentContentKeyBundleError(
      "Failed to load document content-key epoch",
      409,
    );
  }
  await insertDocumentContentKeyTargets({
    documentContentKeyEpochId: epochRow.id,
    executor: input.executor,
    targets: newTargets,
  });
  await updateDocumentContentKeyTargets({
    documentContentKeyEpochId: epochRow.id,
    executor: input.executor,
    targets: refreshedTargets,
  });

  return toStoredBundle(epochRow, input.executor);
}

export async function refreshExistingBundleMetadata(input: {
  readonly existingBundle: StoredDocumentContentKeyBundle;
  readonly nextBundle: StoreDocumentContentKeyBundleInput;
  readonly executor: DatabaseSession;
}): Promise<StoredDocumentContentKeyBundle> {
  if (
    input.existingBundle.targetHash !== input.nextBundle.targetHash ||
    input.existingBundle.linkSetManifestHash !==
      input.nextBundle.linkSetManifestHash
  ) {
    await input.executor
      .update(documentContentKeyEpochs)
      .set({
        linkSetManifestHash: input.nextBundle.linkSetManifestHash,
        targetHash: input.nextBundle.targetHash,
        updatedAt: new Date(),
      })
      .where(
        and(
          eq(documentContentKeyEpochs.documentId, input.nextBundle.documentId),
          eq(
            documentContentKeyEpochs.contentKeyEpoch,
            input.nextBundle.contentKeyEpoch,
          ),
        ),
      );
  }

  return {
    ...input.existingBundle,
    linkSetManifestHash: input.nextBundle.linkSetManifestHash,
    targetHash: input.nextBundle.targetHash,
  };
}
