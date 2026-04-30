import type {
  DocumentLinkSetManifestStateV2,
  ReferencedPrincipalHeadV2,
} from "@tearleads/crypto";
import type { ReferencedPrincipalStateResponse } from "@tearleads/validators/response";
import { and, eq, isNull } from "drizzle-orm";
import {
  getAccessManifestBundle,
  getCurrentAccessManifestHead,
} from "../access/accessManifestStore";
import type { DatabaseExecutor } from "../adapters/postgres";
import { attachmentBindings } from "../schema";
import {
  type ContainerV2AccessProjection,
  type ContainerV2WriterProjectionContext,
  ContainerV2WriterProjectionError,
  createContainerV2WriterProjectionContext,
  resolveContainerV2AccessProjection,
} from "./containers/v2WriterProjection";
import {
  readProjectionNullableString,
  readProjectionPlainRecord,
  readProjectionPositiveInteger,
  readProjectionString,
  readProjectionStringArray,
  readProjectionValue,
  readProjectionVersion2,
} from "./keyingV2ProjectionRecords";

export class KeyingV2ReadAccessError extends Error {
  constructor(
    message: string,
    readonly status: 403 | 404 | 409,
  ) {
    super(message);
    this.name = "KeyingV2ReadAccessError";
  }
}

interface DocumentV2ReadAccess {
  readonly currentAccessEpoch: number;
  readonly currentAccessStateHash: string;
  readonly documentId: string;
  readonly linkedContainerIds: string[];
  readonly referencedPrincipals: ReferencedPrincipalStateResponse[];
}

function readAccessError(message: string): KeyingV2ReadAccessError {
  return new KeyingV2ReadAccessError(message, 409);
}

function referencedPrincipalKey(
  reference: ReferencedPrincipalStateResponse,
): string {
  return [
    reference.principalType,
    reference.principalId,
    reference.version,
    reference.keyEpoch,
    reference.stateHash,
  ].join(":");
}

function toReferencedPrincipalStateResponse(
  reference: ReferencedPrincipalHeadV2,
): ReferencedPrincipalStateResponse {
  return {
    principalType: reference.principalType,
    principalId: reference.principalId,
    version: reference.version,
    keyEpoch: reference.keyEpoch,
    stateHash: reference.stateHash,
  };
}

export function collectReferencedPrincipalsFromContainerV2Access(
  accessPaths: readonly ContainerV2AccessProjection[],
): ReferencedPrincipalStateResponse[] {
  const referencedPrincipalsByKey = new Map<
    string,
    ReferencedPrincipalStateResponse
  >();

  for (const accessPath of accessPaths) {
    for (const manifest of accessPath.verifiedPath) {
      for (const reference of manifest.state.referencedPrincipalHeads) {
        const principal = toReferencedPrincipalStateResponse(reference);
        referencedPrincipalsByKey.set(
          referencedPrincipalKey(principal),
          principal,
        );
      }
    }
  }

  return Array.from(referencedPrincipalsByKey.values()).sort((left, right) =>
    referencedPrincipalKey(left).localeCompare(referencedPrincipalKey(right)),
  );
}

function readDocumentLinkSetState(
  state: unknown,
): DocumentLinkSetManifestStateV2 {
  const record = readProjectionPlainRecord(
    state,
    "Document V2 manifest state",
    readAccessError,
  );
  readProjectionVersion2(record, "Document V2 manifest state", readAccessError);

  return {
    version: 2,
    documentId: readProjectionString(
      record,
      "documentId",
      "Document V2 manifest state",
      readAccessError,
    ),
    organizationId: readProjectionString(
      record,
      "organizationId",
      "Document V2 manifest state",
      readAccessError,
    ),
    epoch: readProjectionPositiveInteger(
      record,
      "epoch",
      "Document V2 manifest state",
      readAccessError,
    ),
    previousManifestHash: readProjectionNullableString(
      record,
      "previousManifestHash",
      "Document V2 manifest state",
      readAccessError,
    ),
    eventHash: readProjectionString(
      record,
      "eventHash",
      "Document V2 manifest state",
      readAccessError,
    ),
    linkedContainerIds: readProjectionStringArray(
      readProjectionValue(record, "linkedContainerIds"),
      "Document V2 manifest state.linkedContainerIds",
      readAccessError,
    ),
  };
}

async function loadCurrentDocumentLinkSet(input: {
  readonly documentId: string;
  readonly executor: DatabaseExecutor;
}): Promise<{
  readonly manifestHash: string;
  readonly state: DocumentLinkSetManifestStateV2;
}> {
  const head = await getCurrentAccessManifestHead(
    "document",
    input.documentId,
    input.executor,
  );
  if (!head) {
    throw new KeyingV2ReadAccessError("Document not found", 404);
  }

  const bundle = await getAccessManifestBundle(
    head.manifestHash,
    input.executor,
  );
  if (!bundle || bundle.manifest.objectKind !== "document") {
    throw new KeyingV2ReadAccessError(
      "Document V2 manifest bundle missing",
      409,
    );
  }

  return {
    manifestHash: head.manifestHash,
    state: readDocumentLinkSetState(bundle.state),
  };
}

export async function resolveReadableContainerV2Access(input: {
  readonly context?: ContainerV2WriterProjectionContext;
  readonly containerId: string;
  readonly executor: DatabaseExecutor;
  readonly userId: string;
}): Promise<ContainerV2AccessProjection> {
  try {
    return await resolveContainerV2AccessProjection({
      containerId: input.containerId,
      executor: input.executor,
      minimumAccessLevel: "read",
      userId: input.userId,
      ...(input.context ? { context: input.context } : {}),
    });
  } catch (error) {
    if (error instanceof ContainerV2WriterProjectionError) {
      throw new KeyingV2ReadAccessError(error.message, error.status);
    }
    throw error;
  }
}

export async function resolveReadableDocumentV2Access(input: {
  readonly context?: ContainerV2WriterProjectionContext;
  readonly documentId: string;
  readonly executor: DatabaseExecutor;
  readonly userId: string;
}): Promise<DocumentV2ReadAccess> {
  const linkSet = await loadCurrentDocumentLinkSet(input);
  if (linkSet.state.documentId !== input.documentId) {
    throw new KeyingV2ReadAccessError("Document V2 manifest mismatch", 409);
  }

  const context =
    input.context ?? createContainerV2WriterProjectionContext(input.executor);
  const accessPaths: ContainerV2AccessProjection[] = [];

  for (const containerId of linkSet.state.linkedContainerIds) {
    try {
      accessPaths.push(
        await resolveReadableContainerV2Access({
          containerId,
          context,
          executor: input.executor,
          userId: input.userId,
        }),
      );
    } catch (error) {
      if (error instanceof KeyingV2ReadAccessError && error.status === 403) {
        continue;
      }
      throw error;
    }
  }

  if (accessPaths.length === 0) {
    throw new KeyingV2ReadAccessError("Forbidden", 403);
  }

  return {
    currentAccessEpoch: linkSet.state.epoch,
    currentAccessStateHash: linkSet.manifestHash,
    documentId: input.documentId,
    linkedContainerIds: [...linkSet.state.linkedContainerIds],
    referencedPrincipals:
      collectReferencedPrincipalsFromContainerV2Access(accessPaths),
  };
}

async function listActiveBlobDocumentIds(input: {
  readonly blobId: string;
  readonly executor: DatabaseExecutor;
}): Promise<string[]> {
  const rows = await input.executor
    .select({ documentId: attachmentBindings.documentId })
    .from(attachmentBindings)
    .where(
      and(
        eq(attachmentBindings.blobId, input.blobId),
        isNull(attachmentBindings.detachedAt),
      ),
    );

  return [...new Set(rows.map((row) => row.documentId))].sort();
}

export async function resolveReadableBlobV2Access(input: {
  readonly blobId: string;
  readonly executor: DatabaseExecutor;
  readonly userId: string;
}): Promise<void> {
  const documentIds = await listActiveBlobDocumentIds(input);
  if (documentIds.length === 0) {
    throw new KeyingV2ReadAccessError("Blob not found", 404);
  }

  const context = createContainerV2WriterProjectionContext(input.executor);
  let hasForbiddenDocument = false;

  for (const documentId of documentIds) {
    try {
      await resolveReadableDocumentV2Access({
        context,
        documentId,
        executor: input.executor,
        userId: input.userId,
      });
      return;
    } catch (error) {
      if (error instanceof KeyingV2ReadAccessError) {
        if (error.status === 403) {
          hasForbiddenDocument = true;
          continue;
        }
        if (error.status === 404) {
          continue;
        }
      }
      throw error;
    }
  }

  throw new KeyingV2ReadAccessError(
    hasForbiddenDocument ? "Forbidden" : "Blob not found",
    hasForbiddenDocument ? 403 : 404,
  );
}
