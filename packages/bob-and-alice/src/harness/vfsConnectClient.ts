import type {
  VfsCrdtPushOperation,
  VfsCrdtPushRequest,
  VfsCrdtPushResponse,
  VfsCrdtSyncResponse,
  VfsSyncResponse
} from '@tearleads/shared';
import {
  createConnectJsonPostInit,
  isPlainRecord,
  normalizeVfsCrdtSyncConnectPayload,
  normalizeVfsSyncConnectPayload,
  parseConnectJsonEnvelopeBody,
  VFS_V2_CONNECT_BASE_PATH
} from '@tearleads/shared';
import {
  encodeConnectJsonAccessLevel,
  encodeConnectJsonOpType,
  encodeConnectJsonPrincipalType,
  parsePushStatus
} from '@tearleads/vfs-sync/vfs';

interface ConnectJsonApiActor {
  fetchJson<T = unknown>(path: string, init?: RequestInit): Promise<T>;
}

function hasActorOrganizationId(
  value: unknown
): value is { user: { organizationId: string } } {
  return (
    isPlainRecord(value) &&
    isPlainRecord(value['user']) &&
    typeof value['user']['organizationId'] === 'string'
  );
}

function resolveActorOrganizationId(
  actor: ConnectJsonApiActor
): string | undefined {
  if (!hasActorOrganizationId(actor)) {
    return undefined;
  }

  const organizationId = actor.user.organizationId.trim();
  return organizationId.length > 0 ? organizationId : undefined;
}

function packIdentifierToBytes(value: string): Uint8Array {
  const hex = value.replace(/-/gu, '');
  if (hex.length === 32 && /^[0-9a-fA-F]{32}$/u.test(hex)) {
    const bytes = new Uint8Array(16);
    for (let index = 0; index < 16; index += 1) {
      bytes[index] = Number.parseInt(hex.slice(index * 2, index * 2 + 2), 16);
    }
    return bytes;
  }

  return new TextEncoder().encode(value);
}

function encodeIdentifierToBase64(value: string): string {
  return Buffer.from(packIdentifierToBytes(value)).toString('base64');
}

function decodeBase64Strict(value: string): Uint8Array | null {
  const normalized = value.replace(/\s+/gu, '');
  if (normalized.length === 0) {
    return null;
  }

  const decoded = Buffer.from(normalized, 'base64');
  if (
    decoded.length === 0 ||
    decoded.toString('base64').replace(/=+$/u, '') !==
      normalized.replace(/=+$/u, '')
  ) {
    return null;
  }

  return decoded;
}

function bytesToUuid(bytes: Uint8Array): string {
  let hex = '';
  for (const byte of bytes) {
    hex += byte.toString(16).padStart(2, '0');
  }

  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(
    12,
    16
  )}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}

function decodeConnectIdentifier(value: unknown, fieldName: string): string {
  if (typeof value !== 'string') {
    throw new Error(`transport returned invalid ${fieldName}`);
  }

  const trimmed = value.trim();
  if (!trimmed) {
    throw new Error(`transport returned invalid ${fieldName}`);
  }

  const decoded = decodeBase64Strict(trimmed);
  if (!decoded) {
    throw new Error(`transport returned invalid ${fieldName}`);
  }

  if (decoded.length === 16) {
    return bytesToUuid(decoded);
  }

  const text = new TextDecoder('utf-8', { fatal: true }).decode(decoded);
  if (!/^[\u0020-\u007E]+$/u.test(text)) {
    throw new Error(`transport returned invalid ${fieldName}`);
  }
  return text;
}

function isVfsCrdtPushRequest(value: unknown): value is VfsCrdtPushRequest {
  return (
    isPlainRecord(value) &&
    typeof value['clientId'] === 'string' &&
    Array.isArray(value['operations'])
  );
}

function encodePushOperation(
  operation: VfsCrdtPushOperation
): Record<string, unknown> {
  const occurredAtMs = Date.parse(operation.occurredAt);
  if (!Number.isFinite(occurredAtMs)) {
    throw new Error('operation occurredAt must be a valid ISO timestamp');
  }

  const payload: Record<string, unknown> = {
    opId: encodeIdentifierToBase64(operation.opId),
    opType: encodeConnectJsonOpType(operation.opType),
    itemId: encodeIdentifierToBase64(operation.itemId),
    replicaId: encodeIdentifierToBase64(operation.replicaId),
    writeId: String(operation.writeId),
    occurredAtMs: String(occurredAtMs)
  };

  if (operation.principalType) {
    payload['principalType'] = encodeConnectJsonPrincipalType(
      operation.principalType
    );
  }
  if (operation.principalId) {
    payload['principalId'] = encodeIdentifierToBase64(operation.principalId);
  }
  if (operation.accessLevel) {
    payload['accessLevel'] = encodeConnectJsonAccessLevel(
      operation.accessLevel
    );
  }
  if (operation.parentId) {
    payload['parentId'] = encodeIdentifierToBase64(operation.parentId);
  }
  if (operation.childId) {
    payload['childId'] = encodeIdentifierToBase64(operation.childId);
  }
  if (typeof operation.encryptedPayload === 'string') {
    payload['encryptedPayload'] = operation.encryptedPayload;
  }
  if (typeof operation.keyEpoch === 'number') {
    payload['keyEpoch'] = operation.keyEpoch;
  }
  if (typeof operation.encryptionNonce === 'string') {
    payload['encryptionNonce'] = operation.encryptionNonce;
  }
  if (typeof operation.encryptionAad === 'string') {
    payload['encryptionAad'] = operation.encryptionAad;
  }
  if (typeof operation.encryptionSignature === 'string') {
    payload['encryptionSignature'] = operation.encryptionSignature;
  }
  if (typeof operation.operationSignature === 'string') {
    payload['operationSignature'] = operation.operationSignature;
  }

  return payload;
}

function encodePushRequest(
  request: VfsCrdtPushRequest
): Record<string, unknown> {
  const payload: Record<string, unknown> = {
    clientId: encodeIdentifierToBase64(request.clientId),
    operations: request.operations.map((operation) =>
      encodePushOperation(operation)
    )
  };

  if (typeof request.organizationId === 'string' && request.organizationId) {
    payload['organizationId'] = encodeIdentifierToBase64(
      request.organizationId
    );
  }

  return payload;
}

function normalizePushPayload(payload: unknown): VfsCrdtPushResponse {
  if (!isPlainRecord(payload)) {
    throw new Error('transport returned invalid push response payload');
  }

  const rawResults = payload['results'];
  if (!Array.isArray(rawResults)) {
    throw new Error('transport returned invalid push response results');
  }

  return {
    clientId: decodeConnectIdentifier(payload['clientId'], 'clientId'),
    results: rawResults.map((result, index) => {
      if (!isPlainRecord(result)) {
        throw new Error(
          `transport returned invalid push result at index ${index}`
        );
      }

      return {
        opId: decodeConnectIdentifier(result['opId'], `results[${index}].opId`),
        status: parsePushStatus(
          result['status'],
          `results[${index}].status`
        )
      };
    })
  };
}

function unwrapConnectPayload(payload: unknown): unknown {
  let current = parseConnectJsonEnvelopeBody(payload);
  const maxResultUnwrapDepth = 8;
  let resultUnwrapDepth = 0;

  while (
    isPlainRecord(current) &&
    'result' in current &&
    current['result'] !== undefined
  ) {
    if (resultUnwrapDepth >= maxResultUnwrapDepth) {
      throw new Error('transport returned cyclic connect result wrapper');
    }
    current = parseConnectJsonEnvelopeBody(current['result']);
    resultUnwrapDepth += 1;
  }

  if (
    isPlainRecord(current) &&
    Object.keys(current).length === 1 &&
    (('response' in current && current['response'] !== undefined) ||
      ('message' in current && current['message'] !== undefined) ||
      ('value' in current && current['value'] !== undefined) ||
      ('json' in current && current['json'] !== undefined))
  ) {
    throw new Error('transport returned unsupported connect wrapper payload');
  }

  return current;
}

export async function fetchVfsConnectJson(input: {
  actor: ConnectJsonApiActor;
  methodName: 'GetSync';
  requestBody?: Record<string, unknown>;
}): Promise<VfsSyncResponse>;
export async function fetchVfsConnectJson(input: {
  actor: ConnectJsonApiActor;
  methodName: 'GetCrdtSync';
  requestBody?: Record<string, unknown>;
}): Promise<VfsCrdtSyncResponse>;
export async function fetchVfsConnectJson(input: {
  actor: ConnectJsonApiActor;
  methodName: 'PushCrdtOps';
  requestBody: VfsCrdtPushRequest;
}): Promise<VfsCrdtPushResponse>;
export async function fetchVfsConnectJson<TResponse>(input: {
  actor: ConnectJsonApiActor;
  methodName: string;
  requestBody?: Record<string, unknown>;
}): Promise<TResponse>;
export async function fetchVfsConnectJson(input: {
  actor: ConnectJsonApiActor;
  methodName: string;
  requestBody?: Record<string, unknown> | VfsCrdtPushRequest;
}): Promise<
  | VfsSyncResponse
  | VfsCrdtSyncResponse
  | VfsCrdtPushResponse
  | Record<string, unknown>
> {
  let requestBody: Record<string, unknown>;
  if (input.methodName === 'PushCrdtOps') {
    if (!isVfsCrdtPushRequest(input.requestBody)) {
      throw new Error('transport received invalid push request payload');
    }
    const organizationId =
      input.requestBody.organizationId ??
      resolveActorOrganizationId(input.actor);
    requestBody = encodePushRequest({
      ...input.requestBody,
      ...(organizationId !== undefined ? { organizationId } : {})
    });
  } else {
    requestBody = isPlainRecord(input.requestBody) ? input.requestBody : {};
  }

  const envelope = await input.actor.fetchJson<unknown>(
    `${VFS_V2_CONNECT_BASE_PATH}/${input.methodName}`,
    createConnectJsonPostInit(requestBody)
  );
  const parsedPayload = unwrapConnectPayload(envelope);
  if (input.methodName === 'GetSync') {
    return normalizeVfsSyncConnectPayload(parsedPayload);
  }
  if (input.methodName === 'GetCrdtSync') {
    return normalizeVfsCrdtSyncConnectPayload(parsedPayload);
  }
  if (input.methodName === 'PushCrdtOps') {
    return normalizePushPayload(parsedPayload);
  }
  if (isPlainRecord(parsedPayload)) {
    return parsedPayload;
  }
  throw new Error('transport returned non-object connect payload');
}
