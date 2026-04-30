import type {
  DocumentLinkSetManifestState,
  ReferencedPrincipalHead,
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
  type ContainerAccessProjection,
  type ContainerWriterProjectionContext,
  ContainerWriterProjectionError,
  createContainerWriterProjectionContext,
  resolveContainerAccessProjection,
} from "./containers/writerProjection";
import {
  readProjectionNullableString,
  readProjectionPlainRecord,
  readProjectionPositiveInteger,
  readProjectionString,
  readProjectionStringArray,
  readProjectionValue,
  readProjectionVersion,
} from "./keyingProjectionRecords";

export class KeyingReadAccessError extends Error {
  constructor(
    message: string,
    readonly status: 403 | 404 | 409,
  ) {
    super(message);
    this.name = "KeyingReadAccessError";
  }
}

interface DocumentReadAccess {
  readonly currentAccessEpoch: number;
  readonly currentAccessStateHash: string;
  readonly documentId: string;
  readonly linkedContainerIds: string[];
  readonly referencedPrincipals: ReferencedPrincipalStateResponse[];
}

function readAccessError(message: string): KeyingReadAccessError {
  return new KeyingReadAccessError(message, 409);
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
  reference: ReferencedPrincipalHead,
): ReferencedPrincipalStateResponse {
  return {
    principalType: reference.principalType,
    principalId: reference.principalId,
    version: reference.version,
    keyEpoch: reference.keyEpoch,
    stateHash: reference.stateHash,
  };
}

export function collectReferencedPrincipalsFromContainerAccess(
  accessPaths: readonly ContainerAccessProjection[],
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
): DocumentLinkSetManifestState {
  const record = readProjectionPlainRecord(
    state,
    "Document manifest state",
    readAccessError,
  );
  readProjectionVersion(record, "Document manifest state", readAccessError);

  return {
    version: 1,
    documentId: readProjectionString(
      record,
      "documentId",
      "Document manifest state",
      readAccessError,
    ),
    organizationId: readProjectionString(
      record,
      "organizationId",
      "Document manifest state",
      readAccessError,
    ),
    epoch: readProjectionPositiveInteger(
      record,
      "epoch",
      "Document manifest state",
      readAccessError,
    ),
    previousManifestHash: readProjectionNullableString(
      record,
      "previousManifestHash",
      "Document manifest state",
      readAccessError,
    ),
    eventHash: readProjectionString(
      record,
      "eventHash",
      "Document manifest state",
      readAccessError,
    ),
    linkedContainerIds: readProjectionStringArray(
      readProjectionValue(record, "linkedContainerIds"),
      "Document manifest state.linkedContainerIds",
      readAccessError,
    ),
  };
}

async function loadCurrentDocumentLinkSet(input: {
  readonly documentId: string;
  readonly executor: DatabaseExecutor;
}): Promise<{
  readonly manifestHash: string;
  readonly state: DocumentLinkSetManifestState;
}> {
  const head = await getCurrentAccessManifestHead(
    "document",
    input.documentId,
    input.executor,
  );
  if (!head) {
    throw new KeyingReadAccessError("Document not found", 404);
  }

  const bundle = await getAccessManifestBundle(
    head.manifestHash,
    input.executor,
  );
  if (!bundle || bundle.manifest.objectKind !== "document") {
    throw new KeyingReadAccessError("Document manifest bundle missing", 409);
  }

  return {
    manifestHash: head.manifestHash,
    state: readDocumentLinkSetState(bundle.state),
  };
}

export async function resolveReadableContainerAccess(input: {
  readonly context?: ContainerWriterProjectionContext;
  readonly containerId: string;
  readonly executor: DatabaseExecutor;
  readonly userId: string;
}): Promise<ContainerAccessProjection> {
  try {
    return await resolveContainerAccessProjection({
      containerId: input.containerId,
      executor: input.executor,
      minimumAccessLevel: "read",
      userId: input.userId,
      ...(input.context ? { context: input.context } : {}),
    });
  } catch (error) {
    if (error instanceof ContainerWriterProjectionError) {
      throw new KeyingReadAccessError(error.message, error.status);
    }
    throw error;
  }
}

export async function resolveReadableDocumentAccess(input: {
  readonly context?: ContainerWriterProjectionContext;
  readonly documentId: string;
  readonly executor: DatabaseExecutor;
  readonly userId: string;
}): Promise<DocumentReadAccess> {
  const linkSet = await loadCurrentDocumentLinkSet(input);
  if (linkSet.state.documentId !== input.documentId) {
    throw new KeyingReadAccessError("Document manifest mismatch", 409);
  }

  const context =
    input.context ?? createContainerWriterProjectionContext(input.executor);
  const accessPaths: ContainerAccessProjection[] = [];

  for (const containerId of linkSet.state.linkedContainerIds) {
    try {
      accessPaths.push(
        await resolveReadableContainerAccess({
          containerId,
          context,
          executor: input.executor,
          userId: input.userId,
        }),
      );
    } catch (error) {
      if (error instanceof KeyingReadAccessError && error.status === 403) {
        continue;
      }
      throw error;
    }
  }

  if (accessPaths.length === 0) {
    throw new KeyingReadAccessError("Forbidden", 403);
  }

  return {
    currentAccessEpoch: linkSet.state.epoch,
    currentAccessStateHash: linkSet.manifestHash,
    documentId: input.documentId,
    linkedContainerIds: [...linkSet.state.linkedContainerIds],
    referencedPrincipals:
      collectReferencedPrincipalsFromContainerAccess(accessPaths),
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

export async function resolveReadableBlobAccess(input: {
  readonly blobId: string;
  readonly executor: DatabaseExecutor;
  readonly userId: string;
}): Promise<void> {
  const documentIds = await listActiveBlobDocumentIds(input);
  if (documentIds.length === 0) {
    throw new KeyingReadAccessError("Blob not found", 404);
  }

  const context = createContainerWriterProjectionContext(input.executor);
  let hasForbiddenDocument = false;

  for (const documentId of documentIds) {
    try {
      await resolveReadableDocumentAccess({
        context,
        documentId,
        executor: input.executor,
        userId: input.userId,
      });
      return;
    } catch (error) {
      if (error instanceof KeyingReadAccessError) {
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

  throw new KeyingReadAccessError(
    hasForbiddenDocument ? "Forbidden" : "Blob not found",
    hasForbiddenDocument ? 403 : 404,
  );
}
