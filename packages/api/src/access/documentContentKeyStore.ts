import {
  computeDocumentContentKeyTargetHash,
  type DocumentContentKeyTarget,
  type KeyingCanonicalJson,
  KeyingVerificationError,
  serializeKeyingCanonicalJson,
  type WriteHeader,
} from "@tearleads/crypto";
import { and, desc, eq, inArray } from "drizzle-orm";
import { type DatabaseExecutor, db } from "../adapters/postgres";
import {
  documentContentKeyEpochs,
  documentContentKeyTargets,
  documentContentWriteHeaders,
} from "../schema";
import {
  assertDocumentKekTargetsCurrent,
  DocumentKekTargetError,
  type resolveCurrentDocumentKekTargets,
} from "./documentKekTargets";

type DocumentContentKeyExecutor = DatabaseExecutor;
type CurrentDocumentKekTargets = Awaited<
  ReturnType<typeof resolveCurrentDocumentKekTargets>
>;

export interface DocumentContentKeyTargetEnvelope
  extends DocumentContentKeyTarget {
  readonly wrappedKey: string;
  readonly wrappingMetadata: KeyingCanonicalJson;
}

interface StoredDocumentContentKeyBundle {
  readonly documentId: string;
  readonly contentKeyEpoch: number;
  readonly linkSetManifestHash: string;
  readonly targetHash: string;
  readonly targets: readonly DocumentContentKeyTargetEnvelope[];
}

export interface StoredDocumentContentKeyBundleWithTargets
  extends StoredDocumentContentKeyBundle {
  readonly currentTargets: CurrentDocumentKekTargets;
}

interface StoreDocumentContentKeyBundleInput {
  readonly documentId: string;
  readonly contentKeyEpoch: number;
  readonly linkSetManifestHash: string;
  readonly targetHash: string;
  readonly targets: readonly DocumentContentKeyTargetEnvelope[];
}

export class DocumentContentKeyBundleError extends Error {
  constructor(
    message: string,
    readonly status: 400 | 404 | 409,
  ) {
    super(message);
    this.name = "DocumentContentKeyBundleError";
  }
}

function canonicalJsonEquals(
  left: KeyingCanonicalJson,
  right: KeyingCanonicalJson,
): boolean {
  return (
    serializeKeyingCanonicalJson(left) === serializeKeyingCanonicalJson(right)
  );
}

function targetKey(target: Pick<DocumentContentKeyTarget, "containerId">) {
  return target.containerId;
}

function toTargetFields(
  envelope: DocumentContentKeyTargetEnvelope,
): DocumentContentKeyTarget {
  return {
    containerId: envelope.containerId,
    containerManifestHash: envelope.containerManifestHash,
    containerKeyEpochId: envelope.containerKeyEpochId,
    containerKeyEpoch: envelope.containerKeyEpoch,
  };
}

function sortTargetEnvelopes(
  targets: readonly DocumentContentKeyTargetEnvelope[],
): DocumentContentKeyTargetEnvelope[] {
  return [...targets].sort((left, right) =>
    left.containerId.localeCompare(right.containerId),
  );
}

function targetFieldsEqual(
  left: DocumentContentKeyTarget,
  right: DocumentContentKeyTarget,
): boolean {
  return (
    left.containerId === right.containerId &&
    left.containerManifestHash === right.containerManifestHash &&
    left.containerKeyEpochId === right.containerKeyEpochId &&
    left.containerKeyEpoch === right.containerKeyEpoch
  );
}

function targetEnvelopeEqual(
  left: DocumentContentKeyTargetEnvelope,
  right: DocumentContentKeyTargetEnvelope,
): boolean {
  return (
    targetFieldsEqual(left, right) &&
    left.wrappedKey === right.wrappedKey &&
    canonicalJsonEquals(left.wrappingMetadata, right.wrappingMetadata)
  );
}

function targetEnvelopeBundlesEqual(
  left: readonly DocumentContentKeyTargetEnvelope[],
  right: readonly DocumentContentKeyTargetEnvelope[],
): boolean {
  const sortedLeft = sortTargetEnvelopes(left);
  const sortedRight = sortTargetEnvelopes(right);

  return (
    sortedLeft.length === sortedRight.length &&
    sortedLeft.every((leftTarget, index) => {
      const rightTarget = sortedRight[index];
      return (
        rightTarget !== undefined &&
        targetEnvelopeEqual(leftTarget, rightTarget)
      );
    })
  );
}

function ensurePositiveContentKeyEpoch(contentKeyEpoch: number): void {
  if (!Number.isInteger(contentKeyEpoch) || contentKeyEpoch <= 0) {
    throw new DocumentContentKeyBundleError(
      "Document content key epoch must be a positive integer",
      400,
    );
  }
}

function assertNoDuplicateTargetContainers(
  targets: readonly DocumentContentKeyTargetEnvelope[],
): void {
  const targetContainerIds = targets.map((target) => target.containerId);
  if (new Set(targetContainerIds).size !== targetContainerIds.length) {
    throw new DocumentContentKeyBundleError(
      "Document content-key targets contain duplicate containers",
      409,
    );
  }
}

function assertWrappedMaterialPresent(
  targets: readonly DocumentContentKeyTargetEnvelope[],
): void {
  for (const target of targets) {
    if (target.wrappedKey.length === 0) {
      throw new DocumentContentKeyBundleError(
        "Document content-key target is missing wrapped key material",
        400,
      );
    }
  }
}

function expectedTargetMap(
  targets: readonly DocumentContentKeyTarget[],
): Map<string, DocumentContentKeyTarget> {
  return new Map(targets.map((target) => [targetKey(target), target]));
}

function currentTargetsContainPreviousBundle(input: {
  readonly currentTargets: readonly DocumentContentKeyTarget[];
  readonly previousTargets: readonly DocumentContentKeyTargetEnvelope[];
}): boolean {
  const currentTargetByContainerId = expectedTargetMap(input.currentTargets);

  return input.previousTargets.every((previousTarget) => {
    const currentTarget = currentTargetByContainerId.get(
      previousTarget.containerId,
    );
    return (
      currentTarget !== undefined &&
      targetFieldsEqual(previousTarget, currentTarget)
    );
  });
}

function assertTargetsMatchCurrent(input: {
  readonly currentTargets: CurrentDocumentKekTargets;
  readonly targets: readonly DocumentContentKeyTargetEnvelope[];
}): void {
  assertNoDuplicateTargetContainers(input.targets);
  assertWrappedMaterialPresent(input.targets);

  const currentTargetByContainerId = expectedTargetMap(
    input.currentTargets.targets,
  );

  if (input.targets.length !== currentTargetByContainerId.size) {
    throw new DocumentContentKeyBundleError(
      "Document content-key targets do not match current KEK targets",
      409,
    );
  }

  for (const target of input.targets) {
    const currentTarget = currentTargetByContainerId.get(target.containerId);
    if (!currentTarget || !targetFieldsEqual(target, currentTarget)) {
      throw new DocumentContentKeyBundleError(
        "Document content-key targets do not match current KEK targets",
        409,
      );
    }
  }
}

async function assertTargetHashMatches(input: {
  readonly targetHash: string;
  readonly targets: readonly DocumentContentKeyTargetEnvelope[];
}): Promise<void> {
  try {
    const targetHash = await computeDocumentContentKeyTargetHash(
      input.targets.map(toTargetFields),
    );

    if (targetHash !== input.targetHash) {
      throw new DocumentContentKeyBundleError(
        "Document content-key target hash mismatch",
        409,
      );
    }
  } catch (error) {
    if (error instanceof DocumentContentKeyBundleError) {
      throw error;
    }
    if (error instanceof KeyingVerificationError) {
      throw new DocumentContentKeyBundleError(error.message, 409);
    }
    throw error;
  }
}

async function loadDocumentContentKeyEpochRow(
  documentId: string,
  contentKeyEpoch: number,
  executor: DocumentContentKeyExecutor,
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
  executor: DocumentContentKeyExecutor,
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
  executor: DocumentContentKeyExecutor,
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
  executor: DocumentContentKeyExecutor,
): Promise<StoredDocumentContentKeyBundle> {
  return {
    documentId: row.documentId,
    contentKeyEpoch: row.contentKeyEpoch,
    linkSetManifestHash: row.linkSetManifestHash,
    targetHash: row.targetHash,
    targets: await listDocumentContentKeyTargetRows(row.id, executor),
  };
}

async function getDocumentContentKeyBundle(
  documentId: string,
  contentKeyEpoch: number,
  executor: DocumentContentKeyExecutor = db,
): Promise<StoredDocumentContentKeyBundle | null> {
  const row = await loadDocumentContentKeyEpochRow(
    documentId,
    contentKeyEpoch,
    executor,
  );
  return row ? toStoredBundle(row, executor) : null;
}

async function getLatestDocumentContentKeyBundle(
  documentId: string,
  executor: DocumentContentKeyExecutor = db,
): Promise<StoredDocumentContentKeyBundle | null> {
  const row = await loadLatestDocumentContentKeyEpochRow(documentId, executor);
  return row ? toStoredBundle(row, executor) : null;
}

export async function getLatestCurrentDocumentContentKeyBundle(
  input: {
    readonly currentTargets: CurrentDocumentKekTargets;
    readonly documentId: string;
  },
  executor: DocumentContentKeyExecutor = db,
): Promise<StoredDocumentContentKeyBundle | null> {
  const bundle = await getLatestDocumentContentKeyBundle(
    input.documentId,
    executor,
  );
  if (!bundle) {
    return null;
  }

  if (
    bundle.linkSetManifestHash !== input.currentTargets.linkSetManifestHash ||
    bundle.targetHash !== input.currentTargets.documentKeyTargetHash
  ) {
    throw new DocumentContentKeyBundleError(
      "Document content-key bundle is stale",
      409,
    );
  }
  assertTargetsMatchCurrent({
    currentTargets: input.currentTargets,
    targets: bundle.targets,
  });

  return bundle;
}

async function insertDocumentContentKeyTargets(input: {
  readonly documentContentKeyEpochId: string;
  readonly executor: DocumentContentKeyExecutor;
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

async function createDocumentContentKeyBundle(
  input: StoreDocumentContentKeyBundleInput,
  executor: DocumentContentKeyExecutor,
): Promise<StoredDocumentContentKeyBundle> {
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

  const epochRow =
    row ??
    (await loadDocumentContentKeyEpochRow(
      input.documentId,
      input.contentKeyEpoch,
      executor,
    ));

  if (!epochRow) {
    throw new DocumentContentKeyBundleError(
      "Failed to load document content-key epoch",
      409,
    );
  }

  await insertDocumentContentKeyTargets({
    documentContentKeyEpochId: epochRow.id,
    executor,
    targets: input.targets,
  });

  const storedBundle = await toStoredBundle(epochRow, executor);
  if (!targetEnvelopeBundlesEqual(storedBundle.targets, input.targets)) {
    throw new DocumentContentKeyBundleError(
      "Document content-key bundle conflict",
      409,
    );
  }

  return storedBundle;
}

async function addDocumentContentKeyTargetsToExistingBundle(input: {
  readonly existingBundle: StoredDocumentContentKeyBundle;
  readonly nextBundle: StoreDocumentContentKeyBundleInput;
  readonly executor: DocumentContentKeyExecutor;
}): Promise<StoredDocumentContentKeyBundle> {
  const existingByContainerId = new Map(
    input.existingBundle.targets.map((target) => [target.containerId, target]),
  );
  const nextByContainerId = new Map(
    input.nextBundle.targets.map((target) => [target.containerId, target]),
  );

  for (const target of input.existingBundle.targets) {
    const nextTarget = nextByContainerId.get(target.containerId);
    if (!nextTarget || !targetEnvelopeEqual(target, nextTarget)) {
      throw new DocumentContentKeyBundleError(
        "Document content-key bundle conflict",
        409,
      );
    }
  }

  const newTargets = input.nextBundle.targets.filter(
    (target) => !existingByContainerId.has(target.containerId),
  );
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
  executor: DocumentContentKeyExecutor,
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
      throw new DocumentContentKeyBundleError(error.message, error.status);
    }
    throw error;
  }
  if (currentTargets.linkSetManifestHash !== input.linkSetManifestHash) {
    throw new DocumentContentKeyBundleError(
      "Document link-set manifest hash is stale",
      409,
    );
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
      "Document content key epoch must rotate after target shrink",
      409,
    );
  }
}

async function refreshExistingBundleMetadata(input: {
  readonly existingBundle: StoredDocumentContentKeyBundle;
  readonly nextBundle: StoreDocumentContentKeyBundleInput;
  readonly executor: DocumentContentKeyExecutor;
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

export async function storeDocumentContentKeyBundle(
  input: StoreDocumentContentKeyBundleInput,
  executor: DocumentContentKeyExecutor = db,
): Promise<StoredDocumentContentKeyBundleWithTargets> {
  if (executor === db) {
    return db.transaction((tx) => storeDocumentContentKeyBundle(input, tx));
  }

  const currentTargets = await validateCurrentTargetsForBundle(input, executor);
  const latestBundle = await getLatestDocumentContentKeyBundle(
    input.documentId,
    executor,
  );

  const latestTargetsStillCurrent =
    !latestBundle ||
    currentTargetsContainPreviousBundle({
      currentTargets: currentTargets.targets,
      previousTargets: latestBundle.targets,
    });

  assertContentKeyEpochCanBeStored({
    contentKeyEpoch: input.contentKeyEpoch,
    latestBundle,
    latestTargetsStillCurrent,
  });

  const existingBundle = await getDocumentContentKeyBundle(
    input.documentId,
    input.contentKeyEpoch,
    executor,
  );
  // Return the target snapshot that was validated immediately before the
  // content-key write. Callers can reuse it for response/write-header
  // assembly without performing a second full KEK-target walk, while the store
  // remains the only authority that decides whether the write targets are
  // current.
  const withCurrentTargets = (
    bundle: StoredDocumentContentKeyBundle,
  ): StoredDocumentContentKeyBundleWithTargets => ({
    ...bundle,
    currentTargets,
  });

  if (!existingBundle) {
    return withCurrentTargets(
      await createDocumentContentKeyBundle(input, executor),
    );
  }

  if (targetEnvelopeBundlesEqual(existingBundle.targets, input.targets)) {
    return withCurrentTargets(
      await refreshExistingBundleMetadata({
        existingBundle,
        nextBundle: input,
        executor,
      }),
    );
  }

  if (
    latestBundle &&
    input.contentKeyEpoch === latestBundle.contentKeyEpoch &&
    latestTargetsStillCurrent
  ) {
    return withCurrentTargets(
      await addDocumentContentKeyTargetsToExistingBundle({
        existingBundle,
        nextBundle: input,
        executor,
      }),
    );
  }

  throw new DocumentContentKeyBundleError(
    "Document content-key bundle conflict",
    409,
  );
}

export async function requireCurrentDocumentContentKeyBundle(input: {
  readonly documentId: string;
  readonly contentKeyEpoch: number;
  readonly expectedLinkSetManifestHash: string;
  readonly expectedTargetHash: string;
  readonly executor?: DocumentContentKeyExecutor;
}): Promise<StoredDocumentContentKeyBundleWithTargets> {
  const executor = input.executor ?? db;
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
    throw new DocumentContentKeyBundleError(
      "Document link-set manifest hash is stale",
      409,
    );
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
    throw new DocumentContentKeyBundleError(
      "Document content-key bundle is stale",
      409,
    );
  }
  assertTargetsMatchCurrent({ currentTargets, targets: bundle.targets });

  return {
    ...bundle,
    currentTargets,
  };
}

export async function storeDocumentContentWriteHeader(
  input: {
    readonly documentId: string;
    readonly header: WriteHeader;
    readonly headerHash: string;
    readonly updateId: string;
  },
  executor: DocumentContentKeyExecutor = db,
): Promise<void> {
  if (
    input.header.objectKind !== "document" ||
    input.header.objectId !== input.documentId
  ) {
    throw new DocumentContentKeyBundleError(
      "Document write header does not match document",
      409,
    );
  }

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
    })
    .onConflictDoNothing()
    .returning({ headerHash: documentContentWriteHeaders.headerHash });

  if (inserted) {
    return;
  }

  const [existing] = await executor
    .select({ headerHash: documentContentWriteHeaders.headerHash })
    .from(documentContentWriteHeaders)
    .where(eq(documentContentWriteHeaders.updateId, input.updateId))
    .limit(1);

  if (!existing || existing.headerHash !== input.headerHash) {
    throw new DocumentContentKeyBundleError(
      "Document write header conflict",
      409,
    );
  }
}

export async function listDocumentContentWriteHeaders(
  updateIds: readonly string[],
  executor: DocumentContentKeyExecutor = db,
): Promise<Map<string, { header: WriteHeader; headerHash: string }>> {
  const uniqueUpdateIds = [...new Set(updateIds)];
  if (uniqueUpdateIds.length === 0) {
    return new Map();
  }

  const rows = await executor
    .select({
      updateId: documentContentWriteHeaders.updateId,
      header: documentContentWriteHeaders.header,
      headerHash: documentContentWriteHeaders.headerHash,
    })
    .from(documentContentWriteHeaders)
    .where(inArray(documentContentWriteHeaders.updateId, uniqueUpdateIds));

  return new Map(
    rows.map((row) => [
      row.updateId,
      { header: row.header, headerHash: row.headerHash },
    ]),
  );
}
