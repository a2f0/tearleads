import {
  computeDocumentContentKeyTargetHash,
  type DocumentContentKeyTarget,
} from "@tearleads/crypto";
import { type DatabaseExecutor, db } from "../adapters/postgres";
import {
  getCurrentAccessManifestHead,
  listAccessManifestDocumentLinkProjection,
} from "./accessManifestStore";
import {
  ContainerKekTargetError,
  resolveCurrentContainerKekTargets,
} from "./containerKekTargets";

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

async function resolveLinkedContainerKekTargets(
  linkedContainerIds: readonly string[],
  executor: DocumentKekTargetExecutor,
): Promise<ReadonlyMap<string, DocumentContentKeyTarget>> {
  try {
    return await resolveCurrentContainerKekTargets(
      linkedContainerIds,
      executor,
    );
  } catch (error) {
    if (error instanceof ContainerKekTargetError) {
      throw new DocumentKekTargetError(error.message, error.status);
    }
    throw error;
  }
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

  const containerTargetById = await resolveLinkedContainerKekTargets(
    linkedContainerIds,
    executor,
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
