import { encodeVfsSyncCursor } from '@tearleads/vfs-sync/vfs';
import {
  fetchWithAuthRefresh,
  isBlobRelationKind,
  normalizeAttachConsistency,
  normalizeApiPrefix,
  normalizeBaseUrl,
  normalizeIsoTimestamp,
  normalizeRequiredString,
  normalizeStageEncryptionMetadata,
  parseErrorMessage
} from './vfsBlobNetworkFlusherHelpers';
import type { VfsBlobNetworkOperation } from './vfsBlobNetworkFlusherTypes';

export interface ExecuteBlobOperationContext {
  apiPrefix: string;
  baseUrl: string;
  fetchImpl: typeof fetch;
  headers: Record<string, string>;
}

export async function executeBlobNetworkOperation(
  context: ExecuteBlobOperationContext,
  operation: VfsBlobNetworkOperation
): Promise<void> {
  if (operation.kind === 'stage') {
    await requestJson(context, '/vfs/blobs/stage', {
      stagingId: operation.payload.stagingId,
      blobId: operation.payload.blobId,
      expiresAt: operation.payload.expiresAt,
      encryption: operation.payload.encryption
    });
    return;
  }

  if (operation.kind === 'attach') {
    const body: Record<string, unknown> = {
      itemId: operation.payload.itemId,
      relationKind: operation.payload.relationKind
    };
    if (operation.payload.consistency) {
      body['clientId'] = operation.payload.consistency.clientId;
      body['requiredCursor'] = encodeVfsSyncCursor(
        operation.payload.consistency.requiredCursor
      );
      body['requiredLastReconciledWriteIds'] = {
        ...operation.payload.consistency.requiredLastReconciledWriteIds
      };
    }

    await requestJson(
      context,
      `/vfs/blobs/stage/${encodeURIComponent(operation.payload.stagingId)}/attach`,
      body
    );
    return;
  }

  if (operation.kind === 'chunk') {
    await requestJson(
      context,
      `/vfs/blobs/stage/${encodeURIComponent(operation.payload.stagingId)}/chunks`,
      {
        uploadId: operation.payload.uploadId,
        chunkIndex: operation.payload.chunkIndex,
        isFinal: operation.payload.isFinal,
        nonce: operation.payload.nonce,
        aadHash: operation.payload.aadHash,
        ciphertextBase64: operation.payload.ciphertextBase64,
        plaintextLength: operation.payload.plaintextLength,
        ciphertextLength: operation.payload.ciphertextLength
      }
    );
    return;
  }

  if (operation.kind === 'commit') {
    await requestJson(
      context,
      `/vfs/blobs/stage/${encodeURIComponent(operation.payload.stagingId)}/commit`,
      {
        uploadId: operation.payload.uploadId,
        keyEpoch: operation.payload.keyEpoch,
        manifestHash: operation.payload.manifestHash,
        manifestSignature: operation.payload.manifestSignature,
        chunkCount: operation.payload.chunkCount,
        totalPlaintextBytes: operation.payload.totalPlaintextBytes,
        totalCiphertextBytes: operation.payload.totalCiphertextBytes
      }
    );
    return;
  }

  await requestJson(
    context,
    `/vfs/blobs/stage/${encodeURIComponent(operation.payload.stagingId)}/abandon`,
    {}
  );
}

export function normalizeBlobNetworkOperation(
  operation: VfsBlobNetworkOperation
): VfsBlobNetworkOperation {
  if (!operation || typeof operation !== 'object') {
    throw new Error('operation is invalid');
  }

  const operationId = normalizeRequiredString(operation.operationId);
  if (!operationId) {
    throw new Error('operation.operationId is required');
  }

  if (operation.kind === 'stage') {
    const stagingId = normalizeRequiredString(operation.payload.stagingId);
    const blobId = normalizeRequiredString(operation.payload.blobId);
    const expiresAt = normalizeIsoTimestamp(operation.payload.expiresAt);
    if (!stagingId || !blobId || !expiresAt) {
      throw new Error('stage operation payload is invalid');
    }

    return {
      operationId,
      kind: 'stage',
      payload: {
        stagingId,
        blobId,
        expiresAt,
        encryption: normalizeStageEncryptionMetadata(
          operation.payload.encryption
        )
      }
    };
  }

  if (operation.kind === 'abandon') {
    const stagingId = normalizeRequiredString(operation.payload.stagingId);
    if (!stagingId) {
      throw new Error('abandon operation payload is invalid');
    }

    return {
      operationId,
      kind: 'abandon',
      payload: {
        stagingId
      }
    };
  }

  if (operation.kind === 'attach') {
    const stagingId = normalizeRequiredString(operation.payload.stagingId);
    const itemId = normalizeRequiredString(operation.payload.itemId);
    const relationKind = operation.payload.relationKind;
    if (!stagingId || !itemId || !isBlobRelationKind(relationKind)) {
      throw new Error('attach operation payload is invalid');
    }

    return {
      operationId,
      kind: 'attach',
      payload: {
        stagingId,
        itemId,
        relationKind,
        consistency: normalizeAttachConsistency(operation.payload.consistency)
      }
    };
  }

  if (operation.kind === 'chunk') {
    const stagingId = normalizeRequiredString(operation.payload.stagingId);
    const uploadId = normalizeRequiredString(operation.payload.uploadId);
    const nonce = normalizeRequiredString(operation.payload.nonce);
    const aadHash = normalizeRequiredString(operation.payload.aadHash);
    const ciphertextBase64 = normalizeRequiredString(
      operation.payload.ciphertextBase64
    );
    if (
      !stagingId ||
      !uploadId ||
      !nonce ||
      !aadHash ||
      !ciphertextBase64 ||
      !Number.isInteger(operation.payload.chunkIndex) ||
      operation.payload.chunkIndex < 0 ||
      !Number.isInteger(operation.payload.plaintextLength) ||
      operation.payload.plaintextLength < 0 ||
      !Number.isInteger(operation.payload.ciphertextLength) ||
      operation.payload.ciphertextLength < 0
    ) {
      throw new Error('chunk operation payload is invalid');
    }

    return {
      operationId,
      kind: 'chunk',
      payload: {
        stagingId,
        uploadId,
        chunkIndex: operation.payload.chunkIndex,
        isFinal: operation.payload.isFinal,
        nonce,
        aadHash,
        ciphertextBase64,
        plaintextLength: operation.payload.plaintextLength,
        ciphertextLength: operation.payload.ciphertextLength
      }
    };
  }

  if (operation.kind === 'commit') {
    const stagingId = normalizeRequiredString(operation.payload.stagingId);
    const uploadId = normalizeRequiredString(operation.payload.uploadId);
    const manifestHash = normalizeRequiredString(
      operation.payload.manifestHash
    );
    const manifestSignature = normalizeRequiredString(
      operation.payload.manifestSignature
    );
    if (
      !stagingId ||
      !uploadId ||
      !manifestHash ||
      !manifestSignature ||
      !Number.isInteger(operation.payload.keyEpoch) ||
      operation.payload.keyEpoch < 0 ||
      !Number.isInteger(operation.payload.chunkCount) ||
      operation.payload.chunkCount < 0 ||
      !Number.isInteger(operation.payload.totalPlaintextBytes) ||
      operation.payload.totalPlaintextBytes < 0 ||
      !Number.isInteger(operation.payload.totalCiphertextBytes) ||
      operation.payload.totalCiphertextBytes < 0 ||
      !isManifestCommitSizeShapeValid(
        operation.payload.chunkCount,
        operation.payload.totalPlaintextBytes,
        operation.payload.totalCiphertextBytes
      )
    ) {
      throw new Error('commit operation payload is invalid');
    }

    return {
      operationId,
      kind: 'commit',
      payload: {
        stagingId,
        uploadId,
        keyEpoch: operation.payload.keyEpoch,
        manifestHash,
        manifestSignature,
        chunkCount: operation.payload.chunkCount,
        totalPlaintextBytes: operation.payload.totalPlaintextBytes,
        totalCiphertextBytes: operation.payload.totalCiphertextBytes
      }
    };
  }

  throw new Error('operation.kind is invalid');
}

export function isManifestCommitSizeShapeValid(
  chunkCount: number,
  totalPlaintextBytes: number,
  totalCiphertextBytes: number
): boolean {
  if (chunkCount === 0) {
    return totalPlaintextBytes === 0 && totalCiphertextBytes === 0;
  }

  return totalCiphertextBytes > 0;
}

async function requestJson(
  context: ExecuteBlobOperationContext,
  path: string,
  body: unknown
): Promise<unknown> {
  const url = buildUrl(context.baseUrl, context.apiPrefix, path);
  const headers = new Headers();
  headers.set('Accept', 'application/json');
  headers.set('Content-Type', 'application/json');
  for (const [header, value] of Object.entries(context.headers)) {
    headers.set(header, value);
  }

  const response = await fetchWithAuthRefresh(context.fetchImpl, url, {
    method: 'POST',
    headers,
    body: JSON.stringify(body)
  });
  const rawBody = await response.text();
  const parsedBody = parseBody(rawBody);

  if (!response.ok) {
    throw new Error(
      parseErrorMessage(parsedBody, `API error: ${response.status}`)
    );
  }

  return parsedBody;
}

function parseBody(rawBody: string): unknown {
  if (rawBody.length === 0) {
    return null;
  }

  try {
    return JSON.parse(rawBody);
  } catch {
    throw new Error('transport returned non-JSON response');
  }
}

function buildUrl(baseUrl: string, apiPrefix: string, path: string): string {
  const normalizedBaseUrl = normalizeBaseUrl(baseUrl);
  const normalizedPrefix = normalizeApiPrefix(apiPrefix);
  const normalizedPath = path.startsWith('/') ? path : `/${path}`;
  const pathname = `${normalizedPrefix}${normalizedPath}`;
  return normalizedBaseUrl.length > 0
    ? `${normalizedBaseUrl}${pathname}`
    : pathname;
}
