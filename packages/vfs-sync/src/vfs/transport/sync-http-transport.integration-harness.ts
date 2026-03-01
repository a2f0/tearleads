import type { VfsCrdtSyncItem } from '@tearleads/shared';
import {
  InMemoryVfsCrdtClientStateStore,
  type InMemoryVfsCrdtSyncServer
} from '../index.js';
import type { VfsCrdtOperation } from '../protocol/sync-crdt.js';
import {
  decodeVfsSyncCursor,
  encodeVfsSyncCursor
} from '../protocol/sync-cursor.js';
import {
  decodeVfsCrdtPushRequestProtobuf,
  decodeVfsCrdtReconcileRequestProtobuf,
  encodeVfsCrdtPushResponseProtobuf,
  encodeVfsCrdtReconcileResponseProtobuf,
  encodeVfsCrdtSyncResponseProtobuf
} from '../protocol/syncProtobuf.js';

function wait(ms: number): Promise<void> {
  return new Promise((resolve) => {
    setTimeout(resolve, ms);
  });
}

function toRequestUrl(input: RequestInfo | URL): URL {
  if (typeof input === 'string') {
    return new URL(input);
  }

  if (input instanceof URL) {
    return input;
  }

  return new URL(input.url);
}

function parsePullLimit(searchParams: URLSearchParams): number {
  const limitRaw = searchParams.get('limit');
  if (!limitRaw) {
    return 100;
  }

  const parsed = Number.parseInt(limitRaw, 10);
  return Number.isFinite(parsed) ? parsed : 100;
}

function toWriteIdRecord(value: unknown): Record<string, number> {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    return {};
  }

  const output: Record<string, number> = {};
  for (const [key, candidate] of Object.entries(value)) {
    if (
      typeof candidate === 'number' &&
      Number.isFinite(candidate) &&
      Number.isInteger(candidate)
    ) {
      output[key] = candidate;
    }
  }

  return output;
}

interface HttpHarnessDelayConfig {
  desktopPushDelayMs?: number;
  mobilePushDelayMs?: number;
  tabletPushDelayMs?: number;
  pullDelayMs?: number;
}

interface PullPayloadShape {
  items: VfsCrdtSyncItem[];
  hasMore: boolean;
  nextCursor: string | null;
  lastReconciledWriteIds: Record<string, number>;
}

interface ReconcilePayloadShape {
  clientId: string;
  cursor: string;
  lastReconciledWriteIds: Record<string, number>;
}

interface ReconcileMutationContext {
  body: {
    clientId: string;
    cursor: {
      changedAt: string;
      changeId: string;
    };
    lastReconciledWriteIds: Record<string, number>;
  };
}

const VALID_OP_TYPES: VfsCrdtOperation['opType'][] = [
  'acl_add',
  'acl_remove',
  'link_add',
  'link_remove',
  'item_upsert',
  'item_delete'
];
const VALID_PRINCIPAL_TYPES: Array<
  NonNullable<VfsCrdtOperation['principalType']>
> = ['user', 'group', 'organization'];
const VALID_ACCESS_LEVELS: Array<NonNullable<VfsCrdtOperation['accessLevel']>> =
  ['read', 'write', 'admin'];

function asRecord(value: unknown, fieldName: string): Record<string, unknown> {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    throw new Error(`Integration harness failed to parse ${fieldName}`);
  }

  return value;
}

function parseRequiredString(value: unknown, fieldName: string): string {
  if (typeof value !== 'string') {
    throw new Error(`Integration harness failed to parse ${fieldName}`);
  }

  return value;
}

function parseWriteId(value: unknown, fieldName: string): number {
  if (
    typeof value !== 'number' ||
    !Number.isFinite(value) ||
    !Number.isInteger(value) ||
    value < 1
  ) {
    throw new Error(`Integration harness failed to parse ${fieldName}`);
  }

  return value;
}

function parseOptionalString(value: unknown): string | undefined {
  return typeof value === 'string' ? value : undefined;
}

function parseOpType(value: unknown): VfsCrdtOperation['opType'] {
  if (
    typeof value === 'string' &&
    VALID_OP_TYPES.some((candidate) => candidate === value)
  ) {
    return value;
  }

  throw new Error('Integration harness failed to parse opType');
}

function parsePrincipalType(
  value: unknown
): VfsCrdtOperation['principalType'] | undefined {
  if (
    typeof value === 'string' &&
    VALID_PRINCIPAL_TYPES.some((candidate) => candidate === value)
  ) {
    return value;
  }

  return undefined;
}

function parseAccessLevel(
  value: unknown
): VfsCrdtOperation['accessLevel'] | undefined {
  if (
    typeof value === 'string' &&
    VALID_ACCESS_LEVELS.some((candidate) => candidate === value)
  ) {
    return value;
  }

  return undefined;
}

function parsePushOperation(value: unknown): VfsCrdtOperation {
  const operation = asRecord(value, 'push operation');
  const parsed: VfsCrdtOperation = {
    opId: parseRequiredString(operation['opId'], 'opId'),
    opType: parseOpType(operation['opType']),
    itemId: parseRequiredString(operation['itemId'], 'itemId'),
    replicaId: parseRequiredString(operation['replicaId'], 'replicaId'),
    writeId: parseWriteId(operation['writeId'], 'writeId'),
    occurredAt: parseRequiredString(operation['occurredAt'], 'occurredAt')
  };

  const principalType = parsePrincipalType(operation['principalType']);
  if (principalType) {
    parsed.principalType = principalType;
  }
  const principalId = parseOptionalString(operation['principalId']);
  if (principalId) {
    parsed.principalId = principalId;
  }
  const accessLevel = parseAccessLevel(operation['accessLevel']);
  if (accessLevel) {
    parsed.accessLevel = accessLevel;
  }
  const parentId = parseOptionalString(operation['parentId']);
  if (parentId) {
    parsed.parentId = parentId;
  }
  const childId = parseOptionalString(operation['childId']);
  if (childId) {
    parsed.childId = childId;
  }
  const encryptedPayload = parseOptionalString(operation['encryptedPayload']);
  if (encryptedPayload) {
    parsed.encryptedPayload = encryptedPayload;
  }
  if (
    typeof operation['keyEpoch'] === 'number' &&
    Number.isFinite(operation['keyEpoch']) &&
    Number.isInteger(operation['keyEpoch']) &&
    operation['keyEpoch'] >= 1
  ) {
    parsed.keyEpoch = operation['keyEpoch'];
  }
  const encryptionNonce = parseOptionalString(operation['encryptionNonce']);
  if (encryptionNonce) {
    parsed.encryptionNonce = encryptionNonce;
  }
  const encryptionAad = parseOptionalString(operation['encryptionAad']);
  if (encryptionAad) {
    parsed.encryptionAad = encryptionAad;
  }
  const encryptionSignature = parseOptionalString(
    operation['encryptionSignature']
  );
  if (encryptionSignature) {
    parsed.encryptionSignature = encryptionSignature;
  }

  return parsed;
}

function parsePushOperations(value: unknown): VfsCrdtOperation[] {
  if (!Array.isArray(value)) {
    return [];
  }

  return value.map((entry) => parsePushOperation(entry));
}

async function readBlobBytes(blob: Blob): Promise<Uint8Array> {
  if (typeof blob.arrayBuffer === 'function') {
    const bodyBuffer = await blob.arrayBuffer();
    return new Uint8Array(bodyBuffer);
  }

  if (typeof FileReader !== 'undefined') {
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => {
        if (reader.result instanceof ArrayBuffer) {
          resolve(new Uint8Array(reader.result));
          return;
        }
        reject(new Error('expected blob reader result to be array buffer'));
      };
      reader.onerror = () => {
        reject(
          reader.error ??
            new Error('failed to read integration harness request blob')
        );
      };
      reader.readAsArrayBuffer(blob);
    });
  }

  throw new Error('Integration harness expected blob request body bytes');
}

async function readRequestBytes(
  init: RequestInit | undefined
): Promise<Uint8Array> {
  if (!init || init.body === undefined || init.body === null) {
    return new Uint8Array();
  }

  if (init.body instanceof Uint8Array) {
    return init.body;
  }

  if (init.body instanceof ArrayBuffer) {
    return new Uint8Array(init.body);
  }

  if (init.body instanceof Blob) {
    return readBlobBytes(init.body);
  }

  if (ArrayBuffer.isView(init.body)) {
    return new Uint8Array(
      init.body.buffer,
      init.body.byteOffset,
      init.body.byteLength
    );
  }

  const bodyBuffer = await new Response(init.body).arrayBuffer();
  if (bodyBuffer.byteLength > 0) {
    return new Uint8Array(bodyBuffer);
  }

  throw new Error('Integration harness expected protobuf request body bytes');
}

export function createServerBackedFetch(
  server: InMemoryVfsCrdtSyncServer,
  options: {
    delays: HttpHarnessDelayConfig;
    mutatePullPayload?: (payload: PullPayloadShape) => PullPayloadShape;
    mutateReconcilePayload?: (
      payload: ReconcilePayloadShape,
      context: ReconcileMutationContext
    ) => ReconcilePayloadShape;
    interceptPullResponse?: () => Response | null;
  }
): typeof fetch {
  const { delays } = options;
  const reconcileStateStore = new InMemoryVfsCrdtClientStateStore();

  return async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = toRequestUrl(input);

    if (url.pathname === '/v1/vfs/crdt/push' && init?.method === 'POST') {
      const pushBody = asRecord(
        decodeVfsCrdtPushRequestProtobuf(await readRequestBytes(init)),
        'push request'
      );
      const clientId = parseRequiredString(pushBody['clientId'], 'clientId');
      const operations = parsePushOperations(pushBody['operations']);

      if (
        clientId === 'desktop' &&
        typeof delays.desktopPushDelayMs === 'number'
      ) {
        await wait(delays.desktopPushDelayMs);
      }
      if (
        clientId === 'mobile' &&
        typeof delays.mobilePushDelayMs === 'number'
      ) {
        await wait(delays.mobilePushDelayMs);
      }
      if (
        clientId === 'tablet' &&
        typeof delays.tabletPushDelayMs === 'number'
      ) {
        await wait(delays.tabletPushDelayMs);
      }

      const pushResult = await server.pushOperations({
        operations
      });

      return new Response(
        encodeVfsCrdtPushResponseProtobuf({
          clientId,
          results: pushResult.results
        }),
        {
          status: 200,
          headers: { 'Content-Type': 'application/x-protobuf' }
        }
      );
    }

    if (
      url.pathname === '/v1/vfs/crdt/vfs-sync' &&
      (init?.method ?? 'GET') === 'GET'
    ) {
      const interceptedResponse = options.interceptPullResponse?.();
      if (interceptedResponse) {
        return interceptedResponse;
      }

      if (typeof delays.pullDelayMs === 'number') {
        await wait(delays.pullDelayMs);
      }

      const cursorRaw = url.searchParams.get('cursor');
      const decodedCursor = cursorRaw ? decodeVfsSyncCursor(cursorRaw) : null;
      const pullLimit = parsePullLimit(url.searchParams);

      const pullResult = await server.pullOperations({
        cursor: decodedCursor,
        limit: pullLimit
      });

      const pullPayload = options.mutatePullPayload
        ? options.mutatePullPayload({
            items: pullResult.items,
            hasMore: pullResult.hasMore,
            nextCursor: pullResult.nextCursor
              ? encodeVfsSyncCursor(pullResult.nextCursor)
              : null,
            lastReconciledWriteIds: pullResult.lastReconciledWriteIds
          })
        : {
            items: pullResult.items,
            hasMore: pullResult.hasMore,
            nextCursor: pullResult.nextCursor
              ? encodeVfsSyncCursor(pullResult.nextCursor)
              : null,
            lastReconciledWriteIds: pullResult.lastReconciledWriteIds
          };

      return new Response(encodeVfsCrdtSyncResponseProtobuf(pullPayload), {
        status: 200,
        headers: { 'Content-Type': 'application/x-protobuf' }
      });
    }

    if (
      url.pathname === '/v1/vfs/crdt/reconcile' &&
      (init?.method ?? 'POST') === 'POST'
    ) {
      const body = asRecord(
        decodeVfsCrdtReconcileRequestProtobuf(await readRequestBytes(init)),
        'reconcile request'
      );
      const cursorRaw = parseRequiredString(body['cursor'], 'cursor');
      const cursor = decodeVfsSyncCursor(cursorRaw);
      if (!cursor)
        throw new Error(
          'Integration harness failed to decode cursor in reconcile'
        );

      const clientId = parseRequiredString(body['clientId'], 'clientId');
      const lastReconciledWriteIds =
        typeof body === 'object' &&
        body !== null &&
        'lastReconciledWriteIds' in body &&
        typeof body.lastReconciledWriteIds === 'object' &&
        body.lastReconciledWriteIds !== null
          ? toWriteIdRecord(body.lastReconciledWriteIds)
          : {};

      const reconcileResult = reconcileStateStore.reconcile(
        'user-1',
        clientId,
        cursor,
        lastReconciledWriteIds
      );

      const reconcilePayload = options.mutateReconcilePayload
        ? options.mutateReconcilePayload(
            {
              clientId,
              cursor: encodeVfsSyncCursor(reconcileResult.state.cursor),
              lastReconciledWriteIds:
                reconcileResult.state.lastReconciledWriteIds
            },
            {
              body: {
                clientId,
                cursor,
                lastReconciledWriteIds
              }
            }
          )
        : {
            clientId,
            cursor: encodeVfsSyncCursor(reconcileResult.state.cursor),
            lastReconciledWriteIds: reconcileResult.state.lastReconciledWriteIds
          };

      return new Response(
        encodeVfsCrdtReconcileResponseProtobuf({
          clientId: reconcilePayload.clientId,
          cursor: reconcilePayload.cursor,
          lastReconciledWriteIds: reconcilePayload.lastReconciledWriteIds
        }),
        {
          status: 200,
          headers: { 'Content-Type': 'application/x-protobuf' }
        }
      );
    }

    return new Response(JSON.stringify({ error: 'not found' }), {
      status: 404
    });
  };
}
