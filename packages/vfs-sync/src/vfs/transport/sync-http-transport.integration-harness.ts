import { VFS_V2_CONNECT_BASE_PATH } from '@tearleads/shared';
import {
  InMemoryVfsCrdtClientStateStore,
  type InMemoryVfsCrdtSyncServer
} from '../index.js';
import {
  decodeVfsSyncCursor,
  encodeVfsSyncCursor
} from '../protocol/sync-cursor.js';
import { encodeConnectJsonPushStatus } from './syncHttpTransportEnumParsing.js';
import {
  decodeCompactClientId,
  encodeCompactIdentifier,
  encodePullItem,
  parseCompactPushOperations
} from './syncHttpTransportHarnessPayloads.js';

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

function parsePullLimit(value: unknown): number {
  if (typeof value === 'number' && Number.isFinite(value) && value > 0) {
    return Math.floor(value);
  }

  if (typeof value === 'string' && value.trim().length > 0) {
    const parsed = Number.parseInt(value, 10);
    if (Number.isFinite(parsed) && parsed > 0) {
      return parsed;
    }
  }

  return 100;
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
      Number.isInteger(candidate) &&
      Number.isSafeInteger(candidate) &&
      candidate >= 1
    ) {
      output[key] = candidate;
    }
  }

  return output;
}

function encodeWriteIdRecord(
  value: Record<string, number>
): Record<string, number> {
  return toWriteIdRecord(value);
}

interface HttpHarnessDelayConfig {
  desktopPushDelayMs?: number;
  mobilePushDelayMs?: number;
  tabletPushDelayMs?: number;
  pullDelayMs?: number;
}

interface PullPayloadShape {
  items: Array<Record<string, unknown>>;
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

function parseRequiredString(value: unknown, fieldName: string): string {
  if (typeof value !== 'string') {
    throw new Error(`Integration harness failed to parse ${fieldName}`);
  }

  return value;
}

function asRecord(value: unknown, fieldName: string): Record<string, unknown> {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    throw new Error(`Integration harness failed to parse ${fieldName}`);
  }

  const record: Record<string, unknown> = {};
  for (const [key, entry] of Object.entries(value)) {
    record[key] = entry;
  }
  return record;
}

function parseOptionalString(value: unknown): string | undefined {
  return typeof value === 'string' ? value : undefined;
}

async function readRequestJson(
  init: RequestInit | undefined
): Promise<Record<string, unknown>> {
  if (!init || init.body === undefined || init.body === null) {
    return {};
  }

  if (typeof init.body === 'string') {
    return asRecord(JSON.parse(init.body), 'request body');
  }

  const rawBody = await new Response(init.body).text();
  if (rawBody.trim().length === 0) {
    return {};
  }

  return asRecord(JSON.parse(rawBody), 'request body');
}

function connectJsonResponse(payload: unknown): Response {
  return new Response(JSON.stringify({ json: JSON.stringify(payload) }), {
    status: 200,
    headers: { 'Content-Type': 'application/json' }
  });
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

    if (
      url.pathname === `${VFS_V2_CONNECT_BASE_PATH}/PushCrdtOps` &&
      init?.method === 'POST'
    ) {
      const pushBody = await readRequestJson(init);

      const clientId = decodeCompactClientId(pushBody['clientId']);
      const operations = parseCompactPushOperations(pushBody['operations']);

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

      return connectJsonResponse({
        clientId: encodeCompactIdentifier(clientId),
        results: pushResult.results.map((result) => ({
          opId: encodeCompactIdentifier(result.opId),
          status: encodeConnectJsonPushStatus(result.status)
        }))
      });
    }

    if (
      url.pathname === `${VFS_V2_CONNECT_BASE_PATH}/GetCrdtSync` &&
      (init?.method ?? 'POST') === 'POST'
    ) {
      const interceptedResponse = options.interceptPullResponse?.();
      if (interceptedResponse) {
        return interceptedResponse;
      }

      if (typeof delays.pullDelayMs === 'number') {
        await wait(delays.pullDelayMs);
      }

      const requestBody = await readRequestJson(init);
      const cursorRaw = parseOptionalString(requestBody['cursor']);
      const decodedCursor = cursorRaw ? decodeVfsSyncCursor(cursorRaw) : null;
      const pullLimit = parsePullLimit(requestBody['limit']);

      const pullResult = await server.pullOperations({
        cursor: decodedCursor,
        limit: pullLimit
      });

      const pullPayload = options.mutatePullPayload
        ? options.mutatePullPayload({
            items: pullResult.items.map((item) => encodePullItem(item)),
            hasMore: pullResult.hasMore,
            nextCursor: pullResult.nextCursor
              ? encodeVfsSyncCursor(pullResult.nextCursor)
              : null,
            lastReconciledWriteIds: encodeWriteIdRecord(
              pullResult.lastReconciledWriteIds
            )
          })
        : {
            items: pullResult.items.map((item) => encodePullItem(item)),
            hasMore: pullResult.hasMore,
            nextCursor: pullResult.nextCursor
              ? encodeVfsSyncCursor(pullResult.nextCursor)
              : null,
            lastReconciledWriteIds: encodeWriteIdRecord(
              pullResult.lastReconciledWriteIds
            )
          };

      return connectJsonResponse(pullPayload);
    }

    if (
      url.pathname === `${VFS_V2_CONNECT_BASE_PATH}/ReconcileCrdt` &&
      (init?.method ?? 'POST') === 'POST'
    ) {
      const body = await readRequestJson(init);

      const cursorRaw = parseRequiredString(body['cursor'], 'cursor');
      const cursor = decodeVfsSyncCursor(cursorRaw);
      if (!cursor)
        throw new Error(
          'Integration harness failed to decode cursor in reconcile'
        );

      const decodedClientId = decodeCompactClientId(body['clientId']);
      const lastReconciledWriteIds =
        typeof body === 'object' &&
        body !== null &&
        'lastReconciledWriteIds' in body &&
        typeof body['lastReconciledWriteIds'] === 'object' &&
        body['lastReconciledWriteIds'] !== null
          ? toWriteIdRecord(body['lastReconciledWriteIds'])
          : {};

      const reconcileResult = reconcileStateStore.reconcile(
        'user-1',
        decodedClientId,
        cursor,
        lastReconciledWriteIds
      );

      const reconcilePayload = options.mutateReconcilePayload
        ? options.mutateReconcilePayload(
            {
              clientId: encodeCompactIdentifier(decodedClientId),
              cursor: encodeVfsSyncCursor(reconcileResult.state.cursor),
              lastReconciledWriteIds: encodeWriteIdRecord(
                reconcileResult.state.lastReconciledWriteIds
              )
            },
            {
              body: {
                clientId: decodedClientId,
                cursor,
                lastReconciledWriteIds
              }
            }
          )
        : {
            clientId: encodeCompactIdentifier(decodedClientId),
            cursor: encodeVfsSyncCursor(reconcileResult.state.cursor),
            lastReconciledWriteIds: encodeWriteIdRecord(
              reconcileResult.state.lastReconciledWriteIds
            )
          };

      return connectJsonResponse(reconcilePayload);
    }

    return new Response(JSON.stringify({ error: 'not found' }), {
      status: 404
    });
  };
}
