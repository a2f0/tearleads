import type { VfsCrdtSyncItem } from '@tearleads/shared';
import {
  InMemoryVfsCrdtClientStateStore,
  type InMemoryVfsCrdtSyncServer
} from '../index.js';
import type { VfsCrdtOperation } from '../protocol/sync-crdt.js';
import { parseVfsCrdtLastReconciledWriteIds } from '../protocol/sync-crdt-reconcile.js';
import {
  decodeVfsSyncCursor,
  encodeVfsSyncCursor
} from '../protocol/sync-cursor.js';

function wait(ms: number): Promise<void> {
  return new Promise((resolve) => {
    setTimeout(resolve, ms);
  });
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
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

function parseJsonBody(body: unknown): unknown {
  if (typeof body !== 'string') {
    return null;
  }

  try {
    return JSON.parse(body);
  } catch {
    return null;
  }
}

function parseClientIdFromPushBody(body: unknown): string | null {
  if (!isRecord(body)) {
    return null;
  }

  const clientId = body['clientId'];
  return typeof clientId === 'string' ? clientId : null;
}

function parseOperationsFromPushBody(body: unknown) {
  if (!isRecord(body)) {
    return null;
  }

  const operationsValue = body['operations'];
  if (!Array.isArray(operationsValue)) {
    return null;
  }

  const operations: VfsCrdtOperation[] = [];
  for (const operationValue of operationsValue) {
    if (!isRecord(operationValue)) {
      return null;
    }

    const opId = operationValue['opId'];
    const opType = operationValue['opType'];
    const itemId = operationValue['itemId'];
    const replicaId = operationValue['replicaId'];
    const writeId = operationValue['writeId'];
    const occurredAt = operationValue['occurredAt'];
    if (
      typeof opId !== 'string' ||
      typeof opType !== 'string' ||
      typeof itemId !== 'string' ||
      typeof replicaId !== 'string' ||
      typeof writeId !== 'number' ||
      typeof occurredAt !== 'string'
    ) {
      return null;
    }

    if (
      opType !== 'acl_add' &&
      opType !== 'acl_remove' &&
      opType !== 'link_add' &&
      opType !== 'link_remove' &&
      opType !== 'item_upsert' &&
      opType !== 'item_delete'
    ) {
      return null;
    }

    const operation: VfsCrdtOperation = {
      opId,
      opType,
      itemId,
      replicaId,
      writeId,
      occurredAt
    };

    const principalType = operationValue['principalType'];
    if (
      principalType === 'user' ||
      principalType === 'group' ||
      principalType === 'organization'
    ) {
      operation.principalType = principalType;
    }

    const principalId = operationValue['principalId'];
    if (typeof principalId === 'string') {
      operation.principalId = principalId;
    }

    const accessLevel = operationValue['accessLevel'];
    if (
      accessLevel === 'read' ||
      accessLevel === 'write' ||
      accessLevel === 'admin'
    ) {
      operation.accessLevel = accessLevel;
    }

    const parentId = operationValue['parentId'];
    if (typeof parentId === 'string') {
      operation.parentId = parentId;
    }

    const childId = operationValue['childId'];
    if (typeof childId === 'string') {
      operation.childId = childId;
    }

    operations.push(operation);
  }

  return operations;
}

function parsePullLimit(searchParams: URLSearchParams): number {
  const limitRaw = searchParams.get('limit');
  if (!limitRaw) {
    return 100;
  }

  const parsed = Number.parseInt(limitRaw, 10);
  return Number.isFinite(parsed) ? parsed : 100;
}

interface ParsedReconcileBody {
  clientId: string;
  cursor: {
    changedAt: string;
    changeId: string;
  };
  lastReconciledWriteIds: Record<string, number>;
}

function parseReconcileBody(body: unknown): ParsedReconcileBody | null {
  if (!isRecord(body)) {
    return null;
  }

  const clientId = body['clientId'];
  const cursorRaw = body['cursor'];
  if (typeof clientId !== 'string' || typeof cursorRaw !== 'string') {
    return null;
  }

  const cursor = decodeVfsSyncCursor(cursorRaw);
  if (!cursor) {
    return null;
  }

  const parsedWriteIds = parseVfsCrdtLastReconciledWriteIds(
    body['lastReconciledWriteIds']
  );
  if (!parsedWriteIds.ok) {
    return null;
  }

  return {
    clientId,
    cursor,
    lastReconciledWriteIds: parsedWriteIds.value
  };
}

interface HttpHarnessDelayConfig {
  desktopPushDelayMs?: number;
  mobilePushDelayMs?: number;
  tabletPushDelayMs?: number;
  pullDelayMs?: number;
}

interface HttpHarnessPullPayload {
  items: VfsCrdtSyncItem[];
  hasMore: boolean;
  nextCursor: string | null;
  lastReconciledWriteIds: Record<string, number>;
}

interface HttpHarnessReconcilePayload {
  clientId: string;
  cursor: string;
  lastReconciledWriteIds: Record<string, number>;
}

interface HttpHarnessOptions {
  delays: HttpHarnessDelayConfig;
  mutatePullPayload?: (
    payload: HttpHarnessPullPayload,
    context: { url: URL }
  ) => HttpHarnessPullPayload;
  mutateReconcilePayload?: (
    payload: HttpHarnessReconcilePayload,
    context: {
      url: URL;
      body: ParsedReconcileBody;
    }
  ) => HttpHarnessReconcilePayload;
}

export function createServerBackedFetch(
  server: InMemoryVfsCrdtSyncServer,
  options: HttpHarnessOptions
): typeof fetch {
  const { delays, mutatePullPayload, mutateReconcilePayload } = options;
  const reconcileStateStore = new InMemoryVfsCrdtClientStateStore();

  return async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = toRequestUrl(input);

    if (url.pathname === '/v1/vfs/crdt/push' && init?.method === 'POST') {
      const body = parseJsonBody(init.body);
      const clientId = parseClientIdFromPushBody(body);
      const operations = parseOperationsFromPushBody(body);
      if (!clientId || !operations) {
        return new Response(JSON.stringify({ error: 'invalid push body' }), {
          status: 400
        });
      }

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
        JSON.stringify({
          clientId,
          results: pushResult.results
        }),
        { status: 200 }
      );
    }

    if (
      url.pathname === '/v1/vfs/crdt/vfs-sync' &&
      (init?.method ?? 'GET') === 'GET'
    ) {
      if (typeof delays.pullDelayMs === 'number') {
        await wait(delays.pullDelayMs);
      }

      const cursorRaw = url.searchParams.get('cursor');
      const decodedCursor = cursorRaw ? decodeVfsSyncCursor(cursorRaw) : null;
      if (cursorRaw && !decodedCursor) {
        return new Response(JSON.stringify({ error: 'Invalid cursor' }), {
          status: 400
        });
      }

      const pullResult = await server.pullOperations({
        cursor: decodedCursor,
        limit: parsePullLimit(url.searchParams)
      });
      const payload: HttpHarnessPullPayload = {
        items: pullResult.items,
        hasMore: pullResult.hasMore,
        nextCursor: pullResult.nextCursor
          ? encodeVfsSyncCursor(pullResult.nextCursor)
          : null,
        lastReconciledWriteIds: pullResult.lastReconciledWriteIds
      };
      const finalPayload = mutatePullPayload
        ? mutatePullPayload(payload, { url })
        : payload;

      return new Response(JSON.stringify(finalPayload), { status: 200 });
    }

    if (
      url.pathname === '/v1/vfs/crdt/reconcile' &&
      (init?.method ?? 'POST') === 'POST'
    ) {
      const body = parseJsonBody(init.body);
      const parsedBody = parseReconcileBody(body);
      if (!parsedBody) {
        return new Response(
          JSON.stringify({ error: 'invalid reconcile body' }),
          {
            status: 400
          }
        );
      }

      const reconcileResult = reconcileStateStore.reconcile(
        'user-1',
        parsedBody.clientId,
        parsedBody.cursor,
        parsedBody.lastReconciledWriteIds
      );
      const payload: HttpHarnessReconcilePayload = {
        clientId: parsedBody.clientId,
        cursor: encodeVfsSyncCursor(reconcileResult.state.cursor),
        lastReconciledWriteIds: reconcileResult.state.lastReconciledWriteIds
      };
      const finalPayload = mutateReconcilePayload
        ? mutateReconcilePayload(payload, {
            url,
            body: parsedBody
          })
        : payload;
      return new Response(JSON.stringify(finalPayload), { status: 200 });
    }

    return new Response(JSON.stringify({ error: 'not found' }), {
      status: 404
    });
  };
}
