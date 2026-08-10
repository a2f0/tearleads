import type {
  ApiDatabase,
  DatabaseSession,
  DatabaseTransaction,
} from "@tearleads/api-shared/postgres";
import {
  documentContentKeyEpochs,
  documentContentKeyTargets,
  documentContentWriteHeaders,
} from "@tearleads/api-shared/schema";
import type { DocumentContentKeyTarget, WriteHeader } from "@tearleads/crypto";
import { DOCUMENT_SYNC_ERROR_CODES } from "@tearleads/validators/response";
import { and, desc, eq, inArray } from "drizzle-orm";
import {
  carryForwardContentKeyTargets,
  createContentKeyStore,
  createContentWriteHeaderStore,
  projectLatestContentKeyBundle,
  currentTargetsCanCarryPreviousBundle as sharedCurrentTargetsCanCarryPreviousBundle,
} from "./contentKeyStore";
import {
  assertTargetHashMatches,
  assertTargetsMatchCurrent,
  type CurrentDocumentKekTargets,
  DocumentContentKeyBundleError,
  type DocumentContentKeyTargetEnvelope,
  ensurePositiveContentKeyEpoch,
  type StoredDocumentContentKeyBundle,
  type StoredDocumentContentKeyBundleWithTargets,
  sortTargetEnvelopes,
  targetEnvelopeEqual,
  targetEnvelopeMaterialEqual,
  targetKeyMaterialEqual,
} from "./documentContentKeyTargets";
import {
  assertDocumentKekTargetsCurrent,
  DocumentKekTargetError,
} from "./documentKekTargets";

export type {
  DocumentContentKeyTargetEnvelope,
  StoredDocumentContentKeyBundle,
} from "./documentContentKeyTargets";
export { DocumentContentKeyBundleError } from "./documentContentKeyTargets";

interface StoreDocumentContentKeyBundleInput {
  readonly documentId: string;
  readonly contentKeyEpoch: number;
  readonly linkSetManifestHash: string;
  readonly targetHash: string;
  readonly targets: readonly DocumentContentKeyTargetEnvelope[];
}

function staleBundle(text: string) {
  return new DocumentContentKeyBundleError(
    text,
    409,
    DOCUMENT_SYNC_ERROR_CODES.stateStale,
  );
}

async function loadDocumentContentKeyEpochRow(
  documentId: string,
  contentKeyEpoch: number,
  executor: DatabaseSession,
) {
  const [row] = await executor
    .select()
    .from(documentContentKeyEpochs)
    .where(
      and(
        eq(documentContentKeyEpochs.documentId, documentId),
        eq(documentContentKeyEpochs.contentKeyEpoch, contentKeyEpoch),
      ),
    )
    .limit(1);

  return row ?? null;
}

async function loadLatestDocumentContentKeyEpochRow(
  documentId: string,
  executor: DatabaseSession,
) {
  const [row] = await executor
    .select()
    .from(documentContentKeyEpochs)
    .where(eq(documentContentKeyEpochs.documentId, documentId))
    .orderBy(desc(documentContentKeyEpochs.contentKeyEpoch))
    .limit(1);

  return row ?? null;
}

async function listDocumentContentKeyTargetRows(
  documentContentKeyEpochId: string,
  executor: DatabaseSession,
): Promise<DocumentContentKeyTargetEnvelope[]> {
  const rows = await executor
    .select({
      containerId: documentContentKeyTargets.containerId,
      containerManifestHash: documentContentKeyTargets.containerManifestHash,
      containerKeyEpochId: documentContentKeyTargets.containerKeyEpochId,
      containerKeyEpoch: documentContentKeyTargets.containerKeyEpoch,
      wrappedKey: documentContentKeyTargets.wrappedKey,
      wrappingMetadata: documentContentKeyTargets.wrappingMetadata,
    })
    .from(documentContentKeyTargets)
    .where(
      eq(
        documentContentKeyTargets.documentContentKeyEpochId,
        documentContentKeyEpochId,
      ),
    );

  return sortTargetEnvelopes(rows);
}

async function toStoredBundle(
  row: typeof documentContentKeyEpochs.$inferSelect,
  executor: DatabaseSession,
): Promise<StoredDocumentContentKeyBundle> {
  return {
    documentId: row.documentId,
    contentKeyEpoch: row.contentKeyEpoch,
    linkSetManifestHash: row.linkSetManifestHash,
    targetHash: row.targetHash,
    targets: await listDocumentContentKeyTargetRows(row.id, executor),
  };
}

export async function getDocumentContentKeyBundle(
  documentId: string,
  contentKeyEpoch: number,
  executor: DatabaseSession,
): Promise<StoredDocumentContentKeyBundle | null> {
  return documentContentKeyStore.getBundle(
    documentId,
    contentKeyEpoch,
    executor,
  );
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
      assertTargetsMatchCurrent({
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

async function insertDocumentContentKeyTargets(input: {
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

async function addDocumentContentKeyTargetsToExistingBundle(input: {
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
  const epochRow = await loadDocumentContentKeyEpochRow(
    input.nextBundle.documentId,
    input.nextBundle.contentKeyEpoch,
    input.executor,
  );
  if (!epochRow) {
    throw new DocumentContentKeyBundleError(
      "Failed to load document content-key epoch",
      409,
    );
  }

  await input.executor
    .update(documentContentKeyEpochs)
    .set({
      linkSetManifestHash: input.nextBundle.linkSetManifestHash,
      targetHash: input.nextBundle.targetHash,
      updatedAt: new Date(),
    })
    .where(eq(documentContentKeyEpochs.id, epochRow.id));
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

  const updatedRow = await loadDocumentContentKeyEpochRow(
    input.nextBundle.documentId,
    input.nextBundle.contentKeyEpoch,
    input.executor,
  );
  if (!updatedRow) {
    throw new DocumentContentKeyBundleError(
      "Failed to load document content-key epoch",
      409,
    );
  }

  return toStoredBundle(updatedRow, input.executor);
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
  assertTargetsMatchCurrent({ currentTargets, targets: input.targets });
  return currentTargets;
}

function assertContentKeyEpochCanBeStored(input: {
  readonly contentKeyEpoch: number;
  readonly latestBundle: StoredDocumentContentKeyBundle | null;
  readonly latestTargetsStillCurrent: boolean;
}): void {
  if (
    input.latestBundle &&
    input.contentKeyEpoch < input.latestBundle.contentKeyEpoch
  ) {
    throw new DocumentContentKeyBundleError(
      "Document content key epoch is stale",
      409,
    );
  }

  if (
    input.latestBundle &&
    input.contentKeyEpoch === input.latestBundle.contentKeyEpoch &&
    !input.latestTargetsStillCurrent
  ) {
    throw new DocumentContentKeyBundleError(
      "Document content key epoch must rotate after target key material changes",
      409,
    );
  }
}

async function refreshExistingBundleMetadata(input: {
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

const documentContentKeyStore = createContentKeyStore<
  DocumentContentKeyTargetEnvelope,
  StoreDocumentContentKeyBundleInput,
  typeof documentContentKeyEpochs.$inferSelect,
  StoredDocumentContentKeyBundle,
  CurrentDocumentKekTargets,
  boolean
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
  prepareStore: ({ currentTargets, input, latestBundle }) => {
    const latestTargetsStillCurrent =
      !latestBundle ||
      currentTargetsCanCarryPreviousBundle({
        bundle: latestBundle,
        currentTargets,
      });
    assertContentKeyEpochCanBeStored({
      contentKeyEpoch: input.contentKeyEpoch,
      latestBundle,
      latestTargetsStillCurrent,
    });
    return latestTargetsStillCurrent;
  },
  reconcileExistingBundle: ({
    existingBundle,
    executor,
    input,
    latestBundle,
    preparation: latestTargetsStillCurrent,
  }) => {
    if (
      latestBundle &&
      input.contentKeyEpoch === latestBundle.contentKeyEpoch &&
      latestTargetsStillCurrent
    ) {
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
  readonly executor: DatabaseSession;
}): Promise<StoredDocumentContentKeyBundleWithTargets> {
  const { executor } = input;
  ensurePositiveContentKeyEpoch(input.contentKeyEpoch);
  const currentTargets = await assertDocumentKekTargetsCurrent(
    {
      documentId: input.documentId,
      expectedTargetHash: input.expectedTargetHash,
    },
    executor,
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
    assertTargetsMatchCurrent({
      currentTargets,
      targets: storedBundle.targets,
    });

    return {
      ...storedBundle,
      currentTargets,
    };
  }
  assertTargetsMatchCurrent({ currentTargets, targets: bundle.targets });

  return {
    ...bundle,
    currentTargets,
  };
}

interface StoreDocumentContentWriteHeaderInput {
  readonly authorizationTargets: readonly DocumentContentKeyTarget[];
  readonly documentId: string;
  readonly header: WriteHeader;
  readonly headerHash: string;
  readonly updateId: string;
}

interface DocumentContentWriteHeaderRow {
  readonly authorizationTargets: DocumentContentKeyTarget[] | null;
  readonly header: WriteHeader;
  readonly headerHash: string;
  readonly recordId: string;
}

const documentContentWriteHeaderStore = createContentWriteHeaderStore<
  StoreDocumentContentWriteHeaderInput,
  DocumentContentWriteHeaderRow
>({
  createConflictError: () =>
    new DocumentContentKeyBundleError("Document write header conflict", 409),
  createObjectMismatchError: () =>
    new DocumentContentKeyBundleError(
      "Document write header does not match document",
      409,
    ),
  expectedObjectKind: "document",
  getObjectId: (input) => input.documentId,
  getRecordId: (input) => input.updateId,
  insert: async (input, executor) => {
    const [inserted] = await executor
      .insert(documentContentWriteHeaders)
      .values({
        updateId: input.updateId,
        documentId: input.documentId,
        organizationId: input.header.organizationId,
        contentKeyEpoch: input.header.contentKeyEpoch,
        accessManifestHash: input.header.accessManifestHash,
        targetHash: input.header.targetHash,
        encryptionSuite: input.header.encryptionSuite,
        contentRecordId: input.header.contentRecordId,
        nonceDomainHash: input.header.nonceDomainHash,
        headerHash: input.headerHash,
        header: input.header,
        authorizationTargets: [...input.authorizationTargets],
      })
      .onConflictDoNothing()
      .returning({ headerHash: documentContentWriteHeaders.headerHash });
    return inserted !== undefined;
  },
  list: (updateIds, executor) =>
    executor
      .select({
        recordId: documentContentWriteHeaders.updateId,
        authorizationTargets: documentContentWriteHeaders.authorizationTargets,
        header: documentContentWriteHeaders.header,
        headerHash: documentContentWriteHeaders.headerHash,
      })
      .from(documentContentWriteHeaders)
      .where(inArray(documentContentWriteHeaders.updateId, updateIds)),
  loadHeaderHash: async (updateId, executor) => {
    const [existing] = await executor
      .select({ headerHash: documentContentWriteHeaders.headerHash })
      .from(documentContentWriteHeaders)
      .where(eq(documentContentWriteHeaders.updateId, updateId))
      .limit(1);
    return existing?.headerHash ?? null;
  },
});

export async function storeDocumentContentWriteHeader(
  input: StoreDocumentContentWriteHeaderInput,
  executor: DatabaseSession,
): Promise<void> {
  return documentContentWriteHeaderStore.store(input, executor);
}

export async function listDocumentContentWriteHeaders(
  updateIds: readonly string[],
  executor: DatabaseSession,
): Promise<
  Map<
    string,
    {
      authorizationTargets: DocumentContentKeyTarget[] | null;
      header: WriteHeader;
      headerHash: string;
    }
  >
> {
  return documentContentWriteHeaderStore.list(updateIds, executor);
}
