import type { DatabaseSession } from "@tearleads/api-shared/postgres";
import {
  computeDocumentContentKeyTargetHash,
  type DocumentContentKeyTarget,
} from "@tearleads/crypto";
import {
  DOCUMENT_SYNC_ERROR_CODES,
  type DocumentSyncErrorCode,
} from "@tearleads/validators/response";
import { getCurrentDocumentHeadWithLinks } from "./accessManifestStore";
import { resolveCurrentContainerKekTargetsMapped } from "./containerKekTargets";
import { assertExpectedTargetHashCurrent } from "./contentKeyTargetPolicy";

export class DocumentKekTargetError extends Error {
  constructor(
    message: string,
    readonly status: 404 | 409,
    readonly code?: DocumentSyncErrorCode | undefined,
  ) {
    super(message);
    this.name = "DocumentKekTargetError";
  }
}

interface ResolvedDocumentKekTargets {
  readonly documentId: string;
  readonly organizationId: string;
  readonly linkSetEpoch: number;
  readonly linkSetManifestHash: string;
  readonly linkedContainerManifestHashes: readonly string[];
  readonly linkedContainerKeyEpochIds: readonly string[];
  readonly targets: readonly DocumentContentKeyTarget[];
  readonly documentKeyTargetHash: string;
}

/**
 * Targets a transaction already resolved under its locks, with the parent-edge
 * strictness it resolved them with. A later check in the same transaction
 * reuses them only when it asks for the same strictness.
 */
export interface DocumentKekTargetsRead {
  readonly allowHistoricalParentEpochs: boolean;
  readonly targets: ResolvedDocumentKekTargets;
}

interface AssertDocumentKekTargetsCurrentInput {
  readonly documentId: string;
  readonly expectedTargets?: readonly DocumentContentKeyTarget[];
  readonly expectedTargetHash?: string;
  readonly allowHistoricalParentEpochs?: boolean;
}

/** A document's current link-set head and its linked container ids. */
export interface DocumentLinkSetFrontier {
  readonly documentId: string;
  readonly linkSetManifestHash: string;
  readonly linkedContainerIds: readonly string[];
}

async function readDocumentLinkSetHead(
  documentId: string,
  executor: DatabaseSession,
) {
  const current = await getCurrentDocumentHeadWithLinks(documentId, executor);
  if (!current) {
    throw new DocumentKekTargetError(
      "Document link-set manifest head missing",
      404,
    );
  }
  const linkedContainerIds = current.links.map((row) => row.containerId);
  if (linkedContainerIds.length === 0) {
    throw new DocumentKekTargetError(
      "Document link-set manifest has no linked containers",
      409,
    );
  }
  return { head: current.head, linkedContainerIds };
}

/**
 * The head and link ids alone, in one read: enough to authorize and to plan
 * locks. The KEK targets are resolved once the heads are locked.
 */
export async function readDocumentLinkSetFrontier(
  documentId: string,
  executor: DatabaseSession,
): Promise<DocumentLinkSetFrontier> {
  const { head, linkedContainerIds } = await readDocumentLinkSetHead(
    documentId,
    executor,
  );
  return {
    documentId,
    linkSetManifestHash: head.manifestHash,
    linkedContainerIds,
  };
}

export async function resolveCurrentDocumentKekTargets(
  documentId: string,
  executor: DatabaseSession,
  allowHistoricalParentEpochs = false,
): Promise<ResolvedDocumentKekTargets> {
  const { head: linkSetHead, linkedContainerIds } =
    await readDocumentLinkSetHead(documentId, executor);

  const containerTargetById = await resolveCurrentContainerKekTargetsMapped(
    linkedContainerIds,
    executor,
    // A stale epoch or parent edge clears once the writer refetches its
    // projection and repairs the chain inline, so it must reach the client as
    // the coded stale state; an uncoded 409 reads as terminal (#2648).
    (message, status, stale) =>
      new DocumentKekTargetError(
        message,
        status,
        stale ? DOCUMENT_SYNC_ERROR_CODES.stateStale : undefined,
      ),
    allowHistoricalParentEpochs,
  );
  const targets: DocumentContentKeyTarget[] = [];

  for (const containerId of linkedContainerIds) {
    const target = containerTargetById.get(containerId);

    if (!target) {
      throw new DocumentKekTargetError(
        "Document KEK target is missing a linked container target",
        409,
      );
    }

    targets.push(target);
  }

  const documentKeyTargetHash =
    await computeDocumentContentKeyTargetHash(targets);

  return {
    documentId,
    organizationId: linkSetHead.organizationId,
    linkSetEpoch: linkSetHead.epoch,
    linkSetManifestHash: linkSetHead.manifestHash,
    linkedContainerManifestHashes: targets.map(
      (target) => target.containerManifestHash,
    ),
    linkedContainerKeyEpochIds: targets.map(
      (target) => target.containerKeyEpochId,
    ),
    targets,
    documentKeyTargetHash,
  };
}

function reusableTargets(
  input: AssertDocumentKekTargetsCurrentInput,
  resolved: DocumentKekTargetsRead | undefined,
): ResolvedDocumentKekTargets | undefined {
  return resolved !== undefined &&
    resolved.targets.documentId === input.documentId &&
    resolved.allowHistoricalParentEpochs ===
      (input.allowHistoricalParentEpochs ?? false)
    ? resolved.targets
    : undefined;
}

/**
 * Check the expected targets against the current ones. `resolved` lets a
 * caller that already resolved them in this transaction, under the locks that
 * keep them current, skip the second resolution.
 */
export async function assertDocumentKekTargetsCurrent(
  input: AssertDocumentKekTargetsCurrentInput,
  executor: DatabaseSession,
  resolved?: DocumentKekTargetsRead,
): Promise<ResolvedDocumentKekTargets> {
  const currentTargets =
    reusableTargets(input, resolved) ??
    (await resolveCurrentDocumentKekTargets(
      input.documentId,
      executor,
      input.allowHistoricalParentEpochs,
    ));
  await assertExpectedTargetHashCurrent({
    currentTargetHash: currentTargets.documentKeyTargetHash,
    expectedTargetHash: input.expectedTargetHash,
    expectedTargets: input.expectedTargets,
    computeTargetHash: computeDocumentContentKeyTargetHash,
    createRequiredError: () =>
      new DocumentKekTargetError(
        "Expected document KEK targets are required",
        409,
      ),
    createStaleError: () =>
      new DocumentKekTargetError(
        "Document KEK targets are stale",
        409,
        DOCUMENT_SYNC_ERROR_CODES.stateStale,
      ),
  });

  return currentTargets;
}
