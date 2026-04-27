import {
  type BlobContentKeyTargetV2,
  computeBlobContentKeyTargetHash,
} from "@tearleads/crypto";
import { and, asc, eq, isNull } from "drizzle-orm";
import { type DatabaseExecutor, db } from "../adapters/postgres";
import { attachmentBindings } from "../schema";
import {
  getCurrentAccessManifestHeads,
  listAccessManifestDocumentLinkProjections,
} from "./accessManifestStore";
import { getCurrentContainerKeyEpochs } from "./containerKekStore";

type BlobKekTargetExecutor = DatabaseExecutor;

export class BlobKekTargetError extends Error {
  constructor(
    message: string,
    readonly status: 404 | 409,
  ) {
    super(message);
    this.name = "BlobKekTargetError";
  }
}

interface ResolvedBlobKekTargets {
  readonly blobId: string;
  readonly activeBindingIds: readonly string[];
  readonly documentManifestHashes: readonly string[];
  readonly linkedContainerManifestHashes: readonly string[];
  readonly linkedContainerKeyEpochIds: readonly string[];
  readonly targets: readonly BlobContentKeyTargetV2[];
  readonly blobKeyTargetHash: string;
}

interface AssertBlobKekTargetsCurrentInput {
  readonly blobId: string;
  readonly expectedTargets?: readonly BlobContentKeyTargetV2[];
  readonly expectedTargetHash?: string;
}

function compareStrings(left: string, right: string): number {
  return left < right ? -1 : left > right ? 1 : 0;
}

function uniqueSortedStrings(values: readonly string[]): string[] {
  return [...new Set(values)].sort(compareStrings);
}

function blobTargetKey(target: BlobContentKeyTargetV2): string {
  return [
    target.bindingId,
    target.documentId,
    target.containerId,
    target.containerKeyEpochId,
  ].join(":");
}

function sortBlobTargets(
  targets: readonly BlobContentKeyTargetV2[],
): BlobContentKeyTargetV2[] {
  return [...targets].sort((left, right) =>
    compareStrings(blobTargetKey(left), blobTargetKey(right)),
  );
}

async function listActiveV2AttachmentBindings(
  blobId: string,
  executor: BlobKekTargetExecutor,
) {
  return executor
    .select({
      bindingId: attachmentBindings.id,
      documentId: attachmentBindings.documentId,
      blobId: attachmentBindings.blobId,
      attachmentEventHash: attachmentBindings.attachmentEventHash,
      documentManifestHash: attachmentBindings.documentManifestHash,
    })
    .from(attachmentBindings)
    .where(
      and(
        eq(attachmentBindings.blobId, blobId),
        isNull(attachmentBindings.detachedAt),
      ),
    )
    .orderBy(asc(attachmentBindings.id));
}

type ActiveV2AttachmentBinding = Awaited<
  ReturnType<typeof listActiveV2AttachmentBindings>
>[number];
type AccessManifestHeadMap = Awaited<
  ReturnType<typeof getCurrentAccessManifestHeads>
>;
type ContainerKeyEpochMap = Awaited<
  ReturnType<typeof getCurrentContainerKeyEpochs>
>;
type DocumentLinkRows = Awaited<
  ReturnType<typeof listAccessManifestDocumentLinkProjections>
>;

function groupDocumentLinksByManifestHash(
  linkRows: DocumentLinkRows,
): Map<string, DocumentLinkRows> {
  const linkRowsByManifestHash = new Map<string, DocumentLinkRows>();

  for (const linkRow of linkRows) {
    const rows = linkRowsByManifestHash.get(linkRow.manifestHash);
    if (rows) {
      rows.push(linkRow);
    } else {
      linkRowsByManifestHash.set(linkRow.manifestHash, [linkRow]);
    }
  }

  return linkRowsByManifestHash;
}

function assertBindingHasSignedV2Event(
  binding: ActiveV2AttachmentBinding,
): void {
  if (!binding.attachmentEventHash || !binding.documentManifestHash) {
    throw new BlobKekTargetError(
      "Blob attachment binding is missing a signed V2 attachment event",
      409,
    );
  }
}

function documentManifestHashesForBindings(input: {
  readonly activeBindings: readonly ActiveV2AttachmentBinding[];
  readonly documentHeadById: AccessManifestHeadMap;
}): {
  readonly documentManifestHashes: string[];
  readonly documentManifestHashesByDocumentId: ReadonlyMap<string, string>;
} {
  const documentManifestHashes: string[] = [];
  const documentManifestHashesByDocumentId = new Map<string, string>();

  for (const binding of input.activeBindings) {
    const documentHead = input.documentHeadById.get(binding.documentId);
    if (!documentHead) {
      throw new BlobKekTargetError(
        "Blob KEK target is missing a linked document head",
        409,
      );
    }
    documentManifestHashesByDocumentId.set(
      binding.documentId,
      documentHead.manifestHash,
    );
    documentManifestHashes.push(documentHead.manifestHash);
  }

  return { documentManifestHashes, documentManifestHashesByDocumentId };
}

async function loadBatchedBlobKekTargetState(input: {
  readonly activeBindings: readonly ActiveV2AttachmentBinding[];
  readonly executor: BlobKekTargetExecutor;
}): Promise<{
  readonly containerHeadById: AccessManifestHeadMap;
  readonly containerKeyEpochById: ContainerKeyEpochMap;
  readonly documentManifestHashes: readonly string[];
  readonly documentManifestHashesByDocumentId: ReadonlyMap<string, string>;
  readonly linkRowsByManifestHash: ReadonlyMap<string, DocumentLinkRows>;
}> {
  const documentIds = input.activeBindings.map((binding) => {
    assertBindingHasSignedV2Event(binding);
    return binding.documentId;
  });
  const documentHeadById = await getCurrentAccessManifestHeads(
    "document",
    documentIds,
    input.executor,
  );
  const { documentManifestHashes, documentManifestHashesByDocumentId } =
    documentManifestHashesForBindings({
      activeBindings: input.activeBindings,
      documentHeadById,
    });
  const linkRows = await listAccessManifestDocumentLinkProjections(
    documentManifestHashes,
    input.executor,
  );
  const linkedContainerIds = linkRows.map((row) => row.containerId);
  const [containerHeadById, containerKeyEpochById] = await Promise.all([
    getCurrentAccessManifestHeads(
      "container",
      linkedContainerIds,
      input.executor,
    ),
    getCurrentContainerKeyEpochs(linkedContainerIds, input.executor),
  ]);

  return {
    containerHeadById,
    containerKeyEpochById,
    documentManifestHashes,
    documentManifestHashesByDocumentId,
    linkRowsByManifestHash: groupDocumentLinksByManifestHash(linkRows),
  };
}

function deriveTargetsForBinding(input: {
  readonly binding: ActiveV2AttachmentBinding;
  readonly containerHeadById: AccessManifestHeadMap;
  readonly containerKeyEpochById: ContainerKeyEpochMap;
  readonly documentLinkRows: DocumentLinkRows;
}): BlobContentKeyTargetV2[] {
  if (input.documentLinkRows.length === 0) {
    throw new BlobKekTargetError(
      "Document link-set manifest has no linked containers",
      409,
    );
  }

  return input.documentLinkRows.map((linkRow) => {
    const containerHead = input.containerHeadById.get(linkRow.containerId);
    const keyEpoch = input.containerKeyEpochById.get(linkRow.containerId);

    if (!containerHead || !keyEpoch) {
      throw new BlobKekTargetError(
        "Blob KEK target is missing a linked container head or key epoch",
        409,
      );
    }

    return {
      bindingId: input.binding.bindingId,
      documentId: input.binding.documentId,
      containerId: linkRow.containerId,
      containerManifestHash: containerHead.manifestHash,
      containerKeyEpochId: keyEpoch.id,
      containerKeyEpoch: keyEpoch.keyEpoch,
    };
  });
}

function deriveTargetsForBindings(input: {
  readonly activeBindings: readonly ActiveV2AttachmentBinding[];
  readonly containerHeadById: AccessManifestHeadMap;
  readonly containerKeyEpochById: ContainerKeyEpochMap;
  readonly documentManifestHashesByDocumentId: ReadonlyMap<string, string>;
  readonly linkRowsByManifestHash: ReadonlyMap<string, DocumentLinkRows>;
}): BlobContentKeyTargetV2[] {
  return input.activeBindings.flatMap((binding) => {
    const documentManifestHash = input.documentManifestHashesByDocumentId.get(
      binding.documentId,
    );
    if (!documentManifestHash) {
      throw new BlobKekTargetError(
        "Blob KEK target is missing a linked document head",
        409,
      );
    }

    return deriveTargetsForBinding({
      binding,
      containerHeadById: input.containerHeadById,
      containerKeyEpochById: input.containerKeyEpochById,
      documentLinkRows:
        input.linkRowsByManifestHash.get(documentManifestHash) ?? [],
    });
  });
}

export async function resolveCurrentBlobKekTargets(
  blobId: string,
  executor: BlobKekTargetExecutor = db,
): Promise<ResolvedBlobKekTargets> {
  const activeBindings = await listActiveV2AttachmentBindings(blobId, executor);
  if (activeBindings.length === 0) {
    throw new BlobKekTargetError("Blob has no active attachment bindings", 404);
  }

  const targetState = await loadBatchedBlobKekTargetState({
    activeBindings,
    executor,
  });
  const targets = deriveTargetsForBindings({
    activeBindings,
    ...targetState,
  });
  const sortedTargets = sortBlobTargets(targets);

  return {
    blobId,
    activeBindingIds: activeBindings.map((binding) => binding.bindingId),
    documentManifestHashes: uniqueSortedStrings(
      targetState.documentManifestHashes,
    ),
    linkedContainerManifestHashes: uniqueSortedStrings(
      sortedTargets.map((target) => target.containerManifestHash),
    ),
    linkedContainerKeyEpochIds: uniqueSortedStrings(
      sortedTargets.map((target) => target.containerKeyEpochId),
    ),
    targets: sortedTargets,
    blobKeyTargetHash: await computeBlobContentKeyTargetHash(sortedTargets),
  };
}

export async function assertBlobKekTargetsCurrent(
  input: AssertBlobKekTargetsCurrentInput,
  executor: BlobKekTargetExecutor = db,
): Promise<ResolvedBlobKekTargets> {
  const currentTargets = await resolveCurrentBlobKekTargets(
    input.blobId,
    executor,
  );
  const expectedTargetHash =
    input.expectedTargetHash ??
    (input.expectedTargets
      ? await computeBlobContentKeyTargetHash(input.expectedTargets)
      : null);

  if (!expectedTargetHash) {
    throw new BlobKekTargetError("Expected blob KEK targets are required", 409);
  }

  if (expectedTargetHash !== currentTargets.blobKeyTargetHash) {
    throw new BlobKekTargetError("Blob KEK targets are stale", 409);
  }

  return currentTargets;
}
