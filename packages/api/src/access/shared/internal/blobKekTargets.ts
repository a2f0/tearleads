import type { DatabaseSession } from "@tearleads/api-shared/postgres";
import { attachmentBindings } from "@tearleads/api-shared/schema";
import {
  type BlobContentKeyTarget,
  computeBlobAccessManifestHash,
  computeBlobContentKeyTargetHash,
} from "@tearleads/crypto";
import { and, asc, eq, isNull } from "drizzle-orm";
import { compareStrings, uniqueSortedStrings } from "../../../utils/array";
import {
  getCurrentAccessManifestHeads,
  listAccessManifestDocumentLinkProjections,
} from "./accessManifestStore";
import {
  type resolveCurrentContainerKekTargets,
  resolveCurrentContainerKekTargetsMapped,
} from "./containerKekTargets";
import { assertExpectedTargetHashCurrent } from "./contentKeyTargetPolicy";

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
  readonly organizationId: string;
  readonly activeBindingIds: readonly string[];
  readonly documentManifestHashes: readonly string[];
  readonly linkedContainerManifestHashes: readonly string[];
  readonly linkedContainerKeyEpochIds: readonly string[];
  readonly targets: readonly BlobContentKeyTarget[];
  readonly blobKeyTargetHash: string;
  readonly blobAccessManifestHash: string;
}

interface AssertBlobKekTargetsCurrentInput {
  readonly blobId: string;
  readonly expectedTargets?: readonly BlobContentKeyTarget[];
  readonly expectedTargetHash?: string;
}

function blobTargetKey(target: BlobContentKeyTarget): string {
  return [
    target.bindingId,
    target.documentId,
    target.containerId,
    target.containerKeyEpochId,
  ].join(":");
}

function sortBlobTargets(
  targets: readonly BlobContentKeyTarget[],
): BlobContentKeyTarget[] {
  return [...targets].sort((left, right) =>
    compareStrings(blobTargetKey(left), blobTargetKey(right)),
  );
}

async function listActiveAttachmentBindings(
  blobId: string,
  executor: DatabaseSession,
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

type ActiveAttachmentBinding = Awaited<
  ReturnType<typeof listActiveAttachmentBindings>
>[number];
type AccessManifestHeadMap = Awaited<
  ReturnType<typeof getCurrentAccessManifestHeads>
>;
type ContainerKekTargetMap = Awaited<
  ReturnType<typeof resolveCurrentContainerKekTargets>
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

function assertBindingHasSignedEvent(binding: ActiveAttachmentBinding): void {
  if (!binding.attachmentEventHash || !binding.documentManifestHash) {
    throw new BlobKekTargetError(
      "Blob attachment binding is missing a signed attachment event",
      409,
    );
  }
}

function documentManifestHashesForBindings(input: {
  readonly activeBindings: readonly ActiveAttachmentBinding[];
  readonly documentHeadById: AccessManifestHeadMap;
}): {
  readonly documentManifestHashes: string[];
  readonly documentManifestHashesByDocumentId: ReadonlyMap<string, string>;
  readonly organizationId: string;
} {
  const documentManifestHashes: string[] = [];
  const documentManifestHashesByDocumentId = new Map<string, string>();
  const organizationIds = new Set<string>();

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
    organizationIds.add(documentHead.organizationId);
  }

  if (organizationIds.size !== 1) {
    throw new BlobKekTargetError(
      "Blob KEK targets must stay within one organization",
      409,
    );
  }

  const organizationId = [...organizationIds][0];
  if (!organizationId) {
    throw new BlobKekTargetError(
      "Blob KEK target is missing a linked document organization",
      409,
    );
  }

  return {
    documentManifestHashes,
    documentManifestHashesByDocumentId,
    organizationId,
  };
}

async function loadBatchedBlobKekTargetState(input: {
  readonly activeBindings: readonly ActiveAttachmentBinding[];
  readonly executor: DatabaseSession;
}): Promise<{
  readonly containerTargetById: ContainerKekTargetMap;
  readonly documentManifestHashes: readonly string[];
  readonly documentManifestHashesByDocumentId: ReadonlyMap<string, string>;
  readonly linkRowsByManifestHash: ReadonlyMap<string, DocumentLinkRows>;
  readonly organizationId: string;
}> {
  const documentIds = input.activeBindings.map((binding) => {
    assertBindingHasSignedEvent(binding);
    return binding.documentId;
  });
  const documentHeadById = await getCurrentAccessManifestHeads(
    "document",
    documentIds,
    input.executor,
  );
  const {
    documentManifestHashes,
    documentManifestHashesByDocumentId,
    organizationId,
  } = documentManifestHashesForBindings({
    activeBindings: input.activeBindings,
    documentHeadById,
  });
  const linkRows = await listAccessManifestDocumentLinkProjections(
    documentManifestHashes,
    input.executor,
  );
  const linkedContainerIds = linkRows.map((row) => row.containerId);
  const containerTargetById = await resolveCurrentContainerKekTargetsMapped(
    linkedContainerIds,
    input.executor,
    (message, status) => new BlobKekTargetError(message, status),
  );

  return {
    containerTargetById,
    documentManifestHashes,
    documentManifestHashesByDocumentId,
    linkRowsByManifestHash: groupDocumentLinksByManifestHash(linkRows),
    organizationId,
  };
}

function deriveTargetsForBinding(input: {
  readonly binding: ActiveAttachmentBinding;
  readonly containerTargetById: ContainerKekTargetMap;
  readonly documentLinkRows: DocumentLinkRows;
}): BlobContentKeyTarget[] {
  if (input.documentLinkRows.length === 0) {
    throw new BlobKekTargetError(
      "Document link-set manifest has no linked containers",
      409,
    );
  }

  return input.documentLinkRows.map((linkRow) => {
    const target = input.containerTargetById.get(linkRow.containerId);

    if (!target) {
      throw new BlobKekTargetError(
        "Blob KEK target is missing a linked container target",
        409,
      );
    }

    return {
      bindingId: input.binding.bindingId,
      documentId: input.binding.documentId,
      ...target,
    };
  });
}

function deriveTargetsForBindings(input: {
  readonly activeBindings: readonly ActiveAttachmentBinding[];
  readonly containerTargetById: ContainerKekTargetMap;
  readonly documentManifestHashesByDocumentId: ReadonlyMap<string, string>;
  readonly linkRowsByManifestHash: ReadonlyMap<string, DocumentLinkRows>;
}): BlobContentKeyTarget[] {
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
      containerTargetById: input.containerTargetById,
      documentLinkRows:
        input.linkRowsByManifestHash.get(documentManifestHash) ?? [],
    });
  });
}

export async function resolveCurrentBlobKekTargets(
  blobId: string,
  executor: DatabaseSession,
): Promise<ResolvedBlobKekTargets> {
  const activeBindings = await listActiveAttachmentBindings(blobId, executor);
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
  const blobKeyTargetHash =
    await computeBlobContentKeyTargetHash(sortedTargets);
  const documentManifestHashes = uniqueSortedStrings(
    targetState.documentManifestHashes,
  );
  const linkedContainerManifestHashes = uniqueSortedStrings(
    sortedTargets.map((target) => target.containerManifestHash),
  );
  const linkedContainerKeyEpochIds = uniqueSortedStrings(
    sortedTargets.map((target) => target.containerKeyEpochId),
  );
  const activeBindingIds = activeBindings.map((binding) => binding.bindingId);

  return {
    blobId,
    organizationId: targetState.organizationId,
    activeBindingIds,
    documentManifestHashes,
    linkedContainerManifestHashes,
    linkedContainerKeyEpochIds,
    targets: sortedTargets,
    blobKeyTargetHash,
    blobAccessManifestHash: await computeBlobAccessManifestHash({
      version: 1,
      blobId,
      organizationId: targetState.organizationId,
      activeBindingIds,
      documentManifestHashes,
      linkedContainerManifestHashes,
      linkedContainerKeyEpochIds,
      blobKeyTargetHash,
    }),
  };
}

export async function assertBlobKekTargetsCurrent(
  input: AssertBlobKekTargetsCurrentInput,
  executor: DatabaseSession,
): Promise<ResolvedBlobKekTargets> {
  const currentTargets = await resolveCurrentBlobKekTargets(
    input.blobId,
    executor,
  );
  await assertExpectedTargetHashCurrent({
    currentTargetHash: currentTargets.blobKeyTargetHash,
    expectedTargetHash: input.expectedTargetHash,
    expectedTargets: input.expectedTargets,
    computeTargetHash: computeBlobContentKeyTargetHash,
    createRequiredError: () =>
      new BlobKekTargetError("Expected blob KEK targets are required", 409),
    createStaleError: () =>
      new BlobKekTargetError("Blob KEK targets are stale", 409),
  });

  return currentTargets;
}
