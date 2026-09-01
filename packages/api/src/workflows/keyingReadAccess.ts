import type { DatabaseSession } from "@tearleads/api-shared/postgres";
import { attachmentBindings } from "@tearleads/api-shared/schema";
import type {
  DocumentLinkSetManifestState,
  ReferencedPrincipalHead,
  VerifiedPrincipalPolicy,
} from "@tearleads/crypto";
import type { ReferencedPrincipalStateResponse } from "@tearleads/validators/response";
import { and, eq, isNull } from "drizzle-orm";
import {
  getAccessManifestBundle,
  getCurrentAccessManifestHead,
} from "../access/read/accessManifestStore";
import { uniqueSortedStrings } from "../utils/array";
import {
  type ContainerAccessProjection,
  type ContainerAccessProjectionResult,
  type ContainerWriterProjectionContext,
  ContainerWriterProjectionError,
  createContainerWriterProjectionContext,
  resolveContainerAccessProjection,
  resolveContainerAccessProjectionBatch,
} from "./containers/writerProjection";
import { toManifestBundleResponse } from "./containers/writerProjection/records";
import {
  StoredDocumentManifestError,
  verifyStoredDocumentManifest,
} from "./documents/storedDocumentManifestVerification";

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

type ReadableContainerAccessResult =
  | {
      readonly status: "fulfilled";
      readonly value: ContainerAccessProjection;
    }
  | {
      readonly reason: KeyingReadAccessError;
      readonly status: "rejected";
    };

function toKeyingReadAccessError(
  error: ContainerWriterProjectionError,
): KeyingReadAccessError {
  return new KeyingReadAccessError(error.message, error.status);
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
    reference.keyFingerprint,
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
    keyFingerprint: reference.keyFingerprint,
  };
}

function principalPolicyToReferencedPrincipalStateResponse(
  policy: VerifiedPrincipalPolicy,
): ReferencedPrincipalStateResponse {
  return {
    principalType: policy.principalType,
    principalId: policy.principalId,
    version: policy.version,
    keyEpoch: policy.keyEpoch,
    stateHash: policy.stateHash,
    keyFingerprint: policy.state.keyFingerprint,
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
    for (const policy of accessPath.principalPolicies) {
      const principal =
        principalPolicyToReferencedPrincipalStateResponse(policy);
      referencedPrincipalsByKey.set(
        referencedPrincipalKey(principal),
        principal,
      );
    }

    if (accessPath.principalPolicies.length > 0) {
      continue;
    }

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

async function loadCurrentDocumentLinkSet(input: {
  readonly context: ContainerWriterProjectionContext;
  readonly documentId: string;
  readonly executor: DatabaseSession;
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

  try {
    const verified = await verifyStoredDocumentManifest({
      bundle: toManifestBundleResponse(bundle),
      containerContext: input.context,
    });
    return { manifestHash: verified.manifestHash, state: verified.state };
  } catch (error) {
    if (error instanceof StoredDocumentManifestError) {
      throw new KeyingReadAccessError(error.message, 409);
    }
    throw error;
  }
}

export async function resolveReadableContainerAccess(input: {
  readonly context?: ContainerWriterProjectionContext;
  readonly containerId: string;
  readonly executor: DatabaseSession;
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
      throw toKeyingReadAccessError(error);
    }
    throw error;
  }
}

function toReadableContainerAccessResult(
  result: ContainerAccessProjectionResult,
): ReadableContainerAccessResult {
  if (result.status === "fulfilled") {
    return result;
  }

  return {
    reason: toKeyingReadAccessError(result.reason),
    status: "rejected",
  };
}

export async function resolveReadableContainerAccessBatch(input: {
  readonly context?: ContainerWriterProjectionContext;
  readonly containerIds: readonly string[];
  readonly executor: DatabaseSession;
  readonly userId: string;
}): Promise<Map<string, ReadableContainerAccessResult>> {
  const results = await resolveContainerAccessProjectionBatch({
    containerIds: input.containerIds,
    executor: input.executor,
    minimumAccessLevel: "read",
    userId: input.userId,
    ...(input.context ? { context: input.context } : {}),
  });

  return new Map(
    Array.from(results, ([containerId, result]) => [
      containerId,
      toReadableContainerAccessResult(result),
    ]),
  );
}

export async function resolveReadableDocumentAccess(input: {
  readonly context?: ContainerWriterProjectionContext;
  readonly documentId: string;
  readonly executor: DatabaseSession;
  readonly userId: string;
}): Promise<DocumentReadAccess> {
  const context =
    input.context ?? createContainerWriterProjectionContext(input.executor);
  const linkSet = await loadCurrentDocumentLinkSet({ ...input, context });
  if (linkSet.state.documentId !== input.documentId) {
    throw new KeyingReadAccessError("Document manifest mismatch", 409);
  }

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
  readonly executor: DatabaseSession;
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

  return uniqueSortedStrings(rows.map((row) => row.documentId));
}

export async function resolveReadableBlobAccess(input: {
  readonly blobId: string;
  readonly executor: DatabaseSession;
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
