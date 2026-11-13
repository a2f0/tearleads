import type {
  ApiDatabase,
  DatabaseSession,
  DatabaseTransaction,
} from "@tearleads/api-shared/postgres";
import { documentContentKeyEpochs } from "@tearleads/api-shared/schema";
import {
  carryForwardContentKeyTargets,
  createContentKeyStore,
  projectLatestContentKeyBundle,
  currentTargetsCanCarryPreviousBundle as sharedCurrentTargetsCanCarryPreviousBundle,
} from "./contentKeyStore";
import {
  loadDocumentContentKeyBundle,
  loadDocumentContentKeyEpochRow,
  loadLatestDocumentContentKeyEpochRow,
  toStoredBundle,
} from "./documentContentKeyBundleReads";
import {
  addDocumentContentKeyTargetsToExistingBundle,
  insertDocumentContentKeyTargets,
  refreshExistingBundleMetadata,
  type StoreDocumentContentKeyBundleInput,
  staleBundle,
} from "./documentContentKeyBundleWrites";
import {
  type DocumentContentKeyEpochPlan,
  planDocumentContentKeyEpoch,
} from "./documentContentKeyEpochPlan";
import {
  assertStoredTargetsMatchCurrent,
  assertSubmittedTargetsMatchCurrent,
  assertTargetHashMatches,
  type CurrentDocumentKekTargets,
  DocumentContentKeyBundleError,
  type DocumentContentKeyTargetEnvelope,
  ensurePositiveContentKeyEpoch,
  type StoredDocumentContentKeyBundle,
  type StoredDocumentContentKeyBundleWithTargets,
  sortTargetEnvelopes,
  targetEnvelopeEqual,
  targetKeyMaterialEqual,
} from "./documentContentKeyTargets";
import {
  assertDocumentKekTargetsCurrent,
  DocumentKekTargetError,
  type DocumentKekTargetsRead,
} from "./documentKekTargets";

export async function getDocumentContentKeyBundle(
  documentId: string,
  contentKeyEpoch: number,
  executor: DatabaseSession,
): Promise<StoredDocumentContentKeyBundle | null> {
  return loadDocumentContentKeyBundle(documentId, contentKeyEpoch, executor);
}

async function getLatestDocumentContentKeyBundle(
  documentId: string,
  executor: DatabaseSession,
): Promise<StoredDocumentContentKeyBundle | null> {
  return documentContentKeyStore.getLatestBundle(documentId, executor);
}

export async function getLatestDocumentContentKeyEpoch(
  documentId: string,
  executor: DatabaseSession,
): Promise<number | null> {
  return documentContentKeyStore.getLatestContentKeyEpoch(documentId, executor);
}

function refreshedBundleForCurrentTargets(input: {
  readonly bundle: StoredDocumentContentKeyBundle;
  readonly currentTargets: CurrentDocumentKekTargets;
}): StoredDocumentContentKeyBundle | null {
  const targets = carryForwardContentKeyTargets({
    currentTargets: input.currentTargets.targets,
    previousTargets: input.bundle.targets,
    requireSameTargetCount: true,
    sortTargetEnvelopes,
    targetKey: (target) => target.containerId,
    targetKeyMaterialEqual,
    toEnvelope: (currentTarget, previousEnvelope) => ({
      ...currentTarget,
      wrappedKey: previousEnvelope.wrappedKey,
      wrappingMetadata: previousEnvelope.wrappingMetadata,
    }),
  });
  if (!targets) {
    return null;
  }

  return {
    ...input.bundle,
    linkSetManifestHash: input.currentTargets.linkSetManifestHash,
    targetHash: input.currentTargets.documentKeyTargetHash,
    targets: sortTargetEnvelopes(targets),
  };
}

function currentTargetsCanCarryPreviousBundle(input: {
  readonly bundle: StoredDocumentContentKeyBundle;
  readonly currentTargets: CurrentDocumentKekTargets;
}): boolean {
  return sharedCurrentTargetsCanCarryPreviousBundle({
    currentTargets: input.currentTargets.targets,
    previousTargets: input.bundle.targets,
    targetKey: (target) => target.containerId,
    targetKeyMaterialEqual,
  });
}

interface LatestDocumentContentKeyBundleProjection {
  readonly bundle: StoredDocumentContentKeyBundle;
  /**
   * True when the stored bundle could not be carried forward to the current
   * KEK targets because a revoke, rekey, or move rotated a linked container's
   * key epoch. The server cannot heal this — only a writer can store a bundle
   * wrapped to the new targets — so the stale bundle is surfaced instead of
   * suppressed. Current readers recover its KEK through the predecessor chain.
   */
  readonly stale: boolean;
}

export async function getLatestDocumentContentKeyBundleProjection(
  input: {
    readonly currentTargets: CurrentDocumentKekTargets;
    readonly documentId: string;
  },
  executor: DatabaseSession,
): Promise<LatestDocumentContentKeyBundleProjection | null> {
  return projectLatestContentKeyBundle({
    assertTargetsCurrent: (bundle) =>
      assertStoredTargetsMatchCurrent({
        currentTargets: input.currentTargets,
        targets: bundle.targets,
      }),
    getLatestBundle: () =>
      getLatestDocumentContentKeyBundle(input.documentId, executor),
    metadataIsCurrent: (bundle) =>
      bundle.linkSetManifestHash === input.currentTargets.linkSetManifestHash &&
      bundle.targetHash === input.currentTargets.documentKeyTargetHash,
    refreshForCurrentTargets: (bundle) =>
      refreshedBundleForCurrentTargets({
        bundle,
        currentTargets: input.currentTargets,
      }),
  });
}

export async function getLatestCurrentDocumentContentKeyBundle(
  input: {
    readonly currentTargets: CurrentDocumentKekTargets;
    readonly documentId: string;
  },
  executor: DatabaseSession,
): Promise<StoredDocumentContentKeyBundle | null> {
  const projection = await getLatestDocumentContentKeyBundleProjection(
    input,
    executor,
  );
  if (projection?.stale) {
    throw staleBundle("Document content-key bundle is stale");
  }

  return projection?.bundle ?? null;
}

async function validateCurrentTargetsForBundle(
  input: StoreDocumentContentKeyBundleInput,
  executor: DatabaseSession,
): Promise<CurrentDocumentKekTargets> {
  ensurePositiveContentKeyEpoch(input.contentKeyEpoch);
  await assertTargetHashMatches(input);
  let currentTargets: CurrentDocumentKekTargets;
  try {
    currentTargets = await assertDocumentKekTargetsCurrent(
      {
        documentId: input.documentId,
        expectedTargetHash: input.targetHash,
      },
      executor,
      input.resolvedTargets,
    );
  } catch (error) {
    if (error instanceof DocumentKekTargetError) {
      const { code, message, status } = error;
      throw new DocumentContentKeyBundleError(message, status, code);
    }
    throw error;
  }
  if (currentTargets.linkSetManifestHash !== input.linkSetManifestHash) {
    throw staleBundle("Document link-set manifest hash is stale");
  }
  // Retained and newly wrapped targets share the same submission contract.
  assertSubmittedTargetsMatchCurrent({
    currentTargets,
    targets: input.targets,
  });
  return currentTargets;
}

const documentContentKeyStore = createContentKeyStore<
  DocumentContentKeyTargetEnvelope,
  StoreDocumentContentKeyBundleInput,
  typeof documentContentKeyEpochs.$inferSelect,
  StoredDocumentContentKeyBundle,
  CurrentDocumentKekTargets,
  DocumentContentKeyEpochPlan
>({
  // A concurrent writer can commit an epoch first. The loser must refetch and
  // rebuild through the client's coded stateStale retry path.
  createBundleConflictError: () =>
    staleBundle("Document content-key bundle conflict"),
  createMissingEpochError: () =>
    new DocumentContentKeyBundleError(
      "Failed to load document content-key epoch",
      409,
    ),
  getIdentifier: (input) => input.documentId,
  insertEpochRow: async (input, executor) => {
    const [row] = await executor
      .insert(documentContentKeyEpochs)
      .values({
        documentId: input.documentId,
        contentKeyEpoch: input.contentKeyEpoch,
        linkSetManifestHash: input.linkSetManifestHash,
        targetHash: input.targetHash,
      })
      .onConflictDoNothing({
        target: [
          documentContentKeyEpochs.documentId,
          documentContentKeyEpochs.contentKeyEpoch,
        ],
      })
      .returning();
    return row ?? null;
  },
  insertTargets: (epochId, targets, executor) =>
    insertDocumentContentKeyTargets({
      documentContentKeyEpochId: epochId,
      executor,
      targets,
    }),
  loadEpochRow: loadDocumentContentKeyEpochRow,
  loadLatestEpochRow: loadLatestDocumentContentKeyEpochRow,
  prepareStore: ({ currentTargets, input, latestBundle }) =>
    planDocumentContentKeyEpoch({
      contentKeyEpoch: input.contentKeyEpoch,
      latestContentKeyEpoch: latestBundle?.contentKeyEpoch ?? null,
      latestTargetsStillCurrent: () =>
        latestBundle === null ||
        currentTargetsCanCarryPreviousBundle({
          bundle: latestBundle,
          currentTargets,
        }),
    }),
  reconcileExistingBundle: ({
    existingBundle,
    executor,
    input,
    preparation,
  }) => {
    if (preparation.kind === "carry") {
      return addDocumentContentKeyTargetsToExistingBundle({
        existingBundle,
        nextBundle: input,
        executor,
      });
    }

    // The submitted epoch was superseded by a concurrent bundle write.
    throw staleBundle("Document content-key bundle conflict");
  },
  refreshExistingBundleMetadata,
  sortTargetEnvelopes,
  targetEnvelopeEqual,
  toStoredBundle,
  validateCurrentTargets: validateCurrentTargetsForBundle,
});

export async function storeDocumentContentKeyBundle(
  input: StoreDocumentContentKeyBundleInput,
  database: ApiDatabase,
): Promise<StoredDocumentContentKeyBundleWithTargets> {
  return documentContentKeyStore.store(input, database);
}

export async function storeDocumentContentKeyBundleInTransaction(
  input: StoreDocumentContentKeyBundleInput,
  executor: DatabaseTransaction,
): Promise<StoredDocumentContentKeyBundleWithTargets> {
  return documentContentKeyStore.storeInTransaction(input, executor);
}

/**
 * Mutation-path helper for document sync. It validates the request against the
 * current KEK targets and persists a same-epoch metadata refresh when an
 * existing bundle can be losslessly carried forward. Read-only projections use
 * getLatestCurrentDocumentContentKeyBundle instead.
 */
export async function requireAndRefreshCurrentDocumentContentKeyBundle(input: {
  readonly documentId: string;
  readonly contentKeyEpoch: number;
  readonly expectedLinkSetManifestHash: string;
  readonly expectedTargetHash: string;
  readonly allowHistoricalParentEpochs?: boolean;
  readonly executor: DatabaseSession;
  readonly resolvedTargets?: DocumentKekTargetsRead;
}): Promise<StoredDocumentContentKeyBundleWithTargets> {
  const { executor } = input;
  ensurePositiveContentKeyEpoch(input.contentKeyEpoch);
  const currentTargets = await assertDocumentKekTargetsCurrent(
    {
      documentId: input.documentId,
      expectedTargetHash: input.expectedTargetHash,
      ...(input.allowHistoricalParentEpochs
        ? { allowHistoricalParentEpochs: true }
        : {}),
    },
    executor,
    input.resolvedTargets,
  );
  if (
    currentTargets.linkSetManifestHash !== input.expectedLinkSetManifestHash
  ) {
    throw staleBundle("Document link-set manifest hash is stale");
  }

  const bundle = await getDocumentContentKeyBundle(
    input.documentId,
    input.contentKeyEpoch,
    executor,
  );
  if (!bundle) {
    throw new DocumentContentKeyBundleError(
      "Document content-key bundle missing",
      409,
    );
  }
  if (
    bundle.linkSetManifestHash !== input.expectedLinkSetManifestHash ||
    bundle.targetHash !== input.expectedTargetHash
  ) {
    const refreshedBundle = refreshedBundleForCurrentTargets({
      bundle,
      currentTargets,
    });
    if (!refreshedBundle) {
      throw staleBundle("Document content-key bundle is stale");
    }

    const storedBundle = await addDocumentContentKeyTargetsToExistingBundle({
      existingBundle: bundle,
      nextBundle: refreshedBundle,
      executor,
    });
    assertStoredTargetsMatchCurrent({
      currentTargets,
      targets: storedBundle.targets,
    });

    return {
      ...storedBundle,
      currentTargets,
    };
  }
  assertStoredTargetsMatchCurrent({
    currentTargets,
    targets: bundle.targets,
  });

  return {
    ...bundle,
    currentTargets,
  };
}
