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

const OP_FIELD_MAP = [
  'opId',           // 0
  'opType',         // 1
  'itemId',         // 2
  'replicaId',      // 3
  'writeId',        // 4
  'occurredAt',     // 5
  'principalId',    // 6
  'principalType',  // 7
  'accessLevel',    // 8
  'parentId',       // 9
  'childId',        // 10
  'actorId',        // 11
  'sourceTable',    // 12
  'sourceId',       // 13
  'encryptedPayload'// 14
];

function compactOp(op: VfsCrdtOperation): any[] {
  return [
    op.opId,
    op.opType,
    op.itemId,
    op.replicaId,
    op.writeId,
    op.occurredAt,
    op.principalId ?? null,
    op.principalType ?? null,
    op.accessLevel ?? null,
    op.parentId ?? null,
    op.childId ?? null,
    op.actorId ?? null,
    op.sourceTable ?? null,
    op.sourceId ?? null,
    op.encryptedPayload ?? null
  ];
}

function inflateOp(arr: any[]): VfsCrdtOperation {
  const op: any = {};
  for (let i = 0; i < OP_FIELD_MAP.length; i++) {
    const val = arr[i];
    if (val !== null && val !== undefined) {
      op[OP_FIELD_MAP[i]!] = val;
    }
  }
  return op as VfsCrdtOperation;
}

interface HttpHarnessDelayConfig {
  desktopPushDelayMs?: number;
  mobilePushDelayMs?: number;
  tabletPushDelayMs?: number;
  pullDelayMs?: number;
}

export function createServerBackedFetch(
  server: InMemoryVfsCrdtSyncServer,
  options: { delays: HttpHarnessDelayConfig }
): typeof fetch {
  const { delays } = options;
  const reconcileStateStore = new InMemoryVfsCrdtClientStateStore();

  return async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = toRequestUrl(input);

    if (url.pathname === '/v1/vfs/crdt/push' && init?.method === 'POST') {
      const body = typeof init.body === 'string' ? JSON.parse(init.body) : init.body;
      const clientId = body.c;
      const operations = (body.o ?? []).map(inflateOp);

      if (clientId === 'desktop' && typeof delays.desktopPushDelayMs === 'number') {
        await wait(delays.desktopPushDelayMs);
      }
      if (clientId === 'mobile' && typeof delays.mobilePushDelayMs === 'number') {
        await wait(delays.mobilePushDelayMs);
      }
      if (clientId === 'tablet' && typeof delays.tabletPushDelayMs === 'number') {
        await wait(delays.tabletPushDelayMs);
      }

      const pushResult = await server.pushOperations({ operations });
      
      return new Response(JSON.stringify({
        r: pushResult.results
      }), { status: 200 });
    }

    if (url.pathname === '/v1/vfs/crdt/vfs-sync' && (init?.method ?? 'GET') === 'GET') {
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

      return new Response(JSON.stringify({
        i: (pullResult.items as any[]).map(compactOp),
        m: pullResult.hasMore,
        n: pullResult.nextCursor ? encodeVfsSyncCursor(pullResult.nextCursor) : null,
        w: pullResult.lastReconciledWriteIds
      }), { status: 200 });
    }

    if (url.pathname === '/v1/vfs/crdt/reconcile' && (init?.method ?? 'POST') === 'POST') {
      const body = typeof init.body === 'string' ? JSON.parse(init.body) : init.body;
      const cursor = decodeVfsSyncCursor(body.cur);
      if (!cursor) throw new Error('Integration harness failed to decode cursor in reconcile');
      
      const reconcileResult = reconcileStateStore.reconcile(
        'user-1',
        body.c,
        cursor,
        body.w ?? {}
      );
      
      return new Response(JSON.stringify({
        c: body.c,
        cur: encodeVfsSyncCursor(reconcileResult.state.cursor),
        w: reconcileResult.state.lastReconciledWriteIds
      }), { status: 200 });
    }

    return new Response(JSON.stringify({ error: 'not found' }), { status: 404 });
  };
}
