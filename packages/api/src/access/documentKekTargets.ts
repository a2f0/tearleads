import {
  computeDocumentContentKeyTargetHash,
  type DocumentContentKeyTargetV2,
} from "@tearleads/crypto";
import { type DatabaseExecutor, db } from "../adapters/postgres";
import {
  getCurrentAccessManifestHead,
  getCurrentAccessManifestHeads,
  listAccessManifestDocumentLinkProjection,
} from "./accessManifestStore";
import { getCurrentContainerKeyEpochs } from "./containerKekStore";

type DocumentKekTargetExecutor = DatabaseExecutor;

export class DocumentKekTargetError extends Error {
  constructor(
    message: string,
    readonly status: 404 | 409,
  ) {
    super(message);
    this.name = "DocumentKekTargetError";
  }
}

interface ResolvedDocumentKekTargets {
  readonly documentId: string;
  readonly organizationId: string;
  readonly linkSetManifestHash: string;
  readonly linkedContainerManifestHashes: readonly string[];
  readonly linkedContainerKeyEpochIds: readonly string[];
  readonly targets: readonly DocumentContentKeyTargetV2[];
  readonly documentKeyTargetHash: string;
}

interface AssertDocumentKekTargetsCurrentInput {
  readonly documentId: string;
  readonly expectedTargets?: readonly DocumentContentKeyTargetV2[];
  readonly expectedTargetHash?: string;
}

async function loadDocumentLinkSetHead(
  documentId: string,
  executor: DocumentKekTargetExecutor,
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
  executor: DocumentKekTargetExecutor = db,
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

  const [containerHeadById, containerKeyEpochById] = await Promise.all([
    getCurrentAccessManifestHeads("container", linkedContainerIds, executor),
    getCurrentContainerKeyEpochs(linkedContainerIds, executor),
  ]);
  const targets: DocumentContentKeyTargetV2[] = [];

  for (const containerId of linkedContainerIds) {
    const containerHead = containerHeadById.get(containerId);
    const keyEpoch = containerKeyEpochById.get(containerId);

    if (!containerHead || !keyEpoch) {
      throw new DocumentKekTargetError(
        "Document KEK target is missing a linked container head or key epoch",
        409,
      );
    }

    targets.push({
      containerId,
      containerManifestHash: containerHead.manifestHash,
      containerKeyEpochId: keyEpoch.id,
      containerKeyEpoch: keyEpoch.keyEpoch,
    });
  }

  const documentKeyTargetHash =
    await computeDocumentContentKeyTargetHash(targets);

  return {
    documentId,
    organizationId: linkSetHead.organizationId,
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
  executor: DocumentKekTargetExecutor = db,
): Promise<ResolvedDocumentKekTargets> {
  const currentTargets = await resolveCurrentDocumentKekTargets(
    input.documentId,
    executor,
  );
  const expectedTargetHash =
    input.expectedTargetHash ??
    (input.expectedTargets
      ? await computeDocumentContentKeyTargetHash(input.expectedTargets)
      : null);

  if (!expectedTargetHash) {
    throw new DocumentKekTargetError(
      "Expected document KEK targets are required",
      409,
    );
  }

  if (expectedTargetHash !== currentTargets.documentKeyTargetHash) {
    throw new DocumentKekTargetError("Document KEK targets are stale", 409);
  }

  return currentTargets;
}
