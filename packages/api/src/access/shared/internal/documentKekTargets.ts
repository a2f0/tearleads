import type { DatabaseSession } from "@tearleads/api-shared/postgres";
import {
  computeDocumentContentKeyTargetHash,
  type DocumentContentKeyTarget,
} from "@tearleads/crypto";
import {
  DOCUMENT_SYNC_ERROR_CODES,
  type DocumentSyncErrorCode,
} from "@tearleads/validators/response";
import {
  getCurrentAccessManifestHead,
  listAccessManifestDocumentLinkProjection,
} from "./accessManifestStore";
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

interface AssertDocumentKekTargetsCurrentInput {
  readonly documentId: string;
  readonly expectedTargets?: readonly DocumentContentKeyTarget[];
  readonly expectedTargetHash?: string;
}

async function loadDocumentLinkSetHead(
  documentId: string,
  executor: DatabaseSession,
) {
  const head = await getCurrentAccessManifestHead(
    "document",
    documentId,
    executor,
  );

  if (!head) {
    throw new DocumentKekTargetError(
      "Document link-set manifest head missing",
      404,
    );
  }

  return head;
}

export async function resolveCurrentDocumentKekTargets(
  documentId: string,
  executor: DatabaseSession,
): Promise<ResolvedDocumentKekTargets> {
  const linkSetHead = await loadDocumentLinkSetHead(documentId, executor);
  const linkRows = await listAccessManifestDocumentLinkProjection(
    linkSetHead.manifestHash,
    executor,
  );
  const linkedContainerIds = linkRows.map((row) => row.containerId);

  if (linkedContainerIds.length === 0) {
    throw new DocumentKekTargetError(
      "Document link-set manifest has no linked containers",
      409,
    );
  }

  const containerTargetById = await resolveCurrentContainerKekTargetsMapped(
    linkedContainerIds,
    executor,
    (message, status) => new DocumentKekTargetError(message, status),
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

export async function assertDocumentKekTargetsCurrent(
  input: AssertDocumentKekTargetsCurrentInput,
  executor: DatabaseSession,
): Promise<ResolvedDocumentKekTargets> {
  const currentTargets = await resolveCurrentDocumentKekTargets(
    input.documentId,
    executor,
  );
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
