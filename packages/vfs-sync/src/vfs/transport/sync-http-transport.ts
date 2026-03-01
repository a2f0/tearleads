import type {
  VfsCrdtSyncPullResponse,
  VfsCrdtSyncPushResponse,
  VfsCrdtSyncReconcileResponse,
  VfsCrdtSyncTransport
} from '../client/sync-client.js';
import { VfsCrdtRematerializationRequiredError } from '../client/sync-client-utils.js';
import type { VfsCrdtOperation } from '../protocol/sync-crdt.js';
import {
  decodeVfsSyncCursor,
  encodeVfsSyncCursor,
  type VfsSyncCursor
} from '../protocol/sync-cursor.js';
import {
  parseApiErrorResponse,
  parseErrorMessage
} from './sync-http-transport-parser.js';

type FetchImpl = typeof fetch;
const CRDT_REMATERIALIZATION_REQUIRED_CODE = 'crdt_rematerialization_required';

/**
 * VFS Compacted Protocol
 * 
 * To reduce payload size by ~60% without binary dependencies, we use
 * positional arrays for operations instead of keyed objects.
 */

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
    // Map nulls back to nulls for consistency with VFS logic
    op[OP_FIELD_MAP[i]!] = val === undefined ? null : val;
  }
  return op as VfsCrdtOperation;
}

export interface VfsHttpCrdtSyncTransportOptions {
  baseUrl?: string;
  apiPrefix?: string;
  fetchImpl?: FetchImpl;
  getAuthToken?: (() => string | Promise<string | null> | null) | null;
  headers?: Record<string, string>;
}

export class VfsHttpCrdtSyncTransport implements VfsCrdtSyncTransport {
  private readonly baseUrl: string;
  private readonly apiPrefix: string;
  private readonly fetchImpl: FetchImpl;
  private readonly getAuthToken:
    | (() => string | Promise<string | null> | null)
    | null;
  private readonly headers: Record<string, string>;

  constructor(options: VfsHttpCrdtSyncTransportOptions = {}) {
    this.baseUrl = normalizeBaseUrl(options.baseUrl ?? '');
    this.apiPrefix = normalizeApiPrefix(options.apiPrefix ?? '/v1');
    this.fetchImpl = options.fetchImpl ?? fetch;
    this.getAuthToken = options.getAuthToken ?? null;
    this.headers = options.headers ?? {};
  }

  async pushOperations(input: {
    userId: string;
    clientId: string;
    operations: VfsCrdtOperation[];
  }): Promise<VfsCrdtSyncPushResponse> {
    const payload = {
      c: input.clientId,
      o: input.operations.map(compactOp)
    };
    
    const body = await this.request(
      '/vfs/crdt/push',
      payload,
      undefined
    );

    const parsed = body as any;
    if (!parsed || !Array.isArray(parsed.r)) {
      throw new Error('transport returned invalid push response results');
    }

    return {
      results: parsed.r
    };
  }

  async pullOperations(input: {
    userId: string;
    clientId: string;
    cursor: VfsSyncCursor | null;
    limit: number;
  }): Promise<VfsCrdtSyncPullResponse> {
    const query = new URLSearchParams();
    query.set('limit', String(input.limit));
    if (input.cursor) {
      query.set('cursor', encodeVfsSyncCursor(input.cursor));
    }

    const body = await this.request(
      '/vfs/crdt/vfs-sync',
      undefined,
      query
    );
    const parsed = body as any;

    let nextCursor: VfsSyncCursor | null = null;
    if (parsed.n) {
      const decoded = decodeVfsSyncCursor(parsed.n);
      if (!decoded) {
        throw new Error('transport returned invalid nextCursor');
      }
      nextCursor = decoded;
    }

    // Validate and cast writeIds to positive integers
    const lastReconciledWriteIds: Record<string, number> = {};
    if (parsed.w) {
      for (const [key, value] of Object.entries(parsed.w)) {
        const num = Number(value);
        if (!Number.isInteger(num) || num < 0) {
          throw new Error(`transport returned invalid writeId for replica ${key}: ${value}`);
        }
        lastReconciledWriteIds[key] = num;
      }
    }

    return {
      items: (parsed.i ?? []).map(inflateOp),
      hasMore: !!parsed.m,
      nextCursor,
      lastReconciledWriteIds
    };
  }

  async reconcileState(input: {
    userId: string;
    clientId: string;
    cursor: VfsSyncCursor;
    lastReconciledWriteIds: VfsCrdtSyncReconcileResponse['lastReconciledWriteIds'];
  }): Promise<VfsCrdtSyncReconcileResponse> {
    const payload = {
      c: input.clientId,
      cur: encodeVfsSyncCursor(input.cursor),
      w: input.lastReconciledWriteIds
    };

    const body = await this.request(
      '/vfs/crdt/reconcile',
      payload,
      undefined
    );
    const parsed = body as any;

    if (parsed.c !== input.clientId) {
      throw new Error(
        'transport returned reconcile response for mismatched clientId'
      );
    }

    const decodedCursor = decodeVfsSyncCursor(parsed.cur);
    if (!decodedCursor) {
      throw new Error('transport returned invalid reconcile cursor');
    }

    return {
      cursor: decodedCursor,
      lastReconciledWriteIds: parsed.w ?? {}
    };
  }

  private async request(
    path: string,
    body: unknown,
    query: URLSearchParams | undefined
  ): Promise<unknown> {
    const requestUrl = this.buildUrl(path, query);
    const headers = await this.buildHeaders(body !== undefined);
    const requestInit: RequestInit = {
      method: body === undefined ? 'GET' : 'POST',
      headers
    };
    if (body !== undefined) {
      requestInit.body = JSON.stringify(body);
    }

    const response = await this.fetchImpl(requestUrl, requestInit);

    const rawBody = await response.text();
    let parsedBody: any = null;
    if (rawBody.length > 0) {
      try { parsedBody = JSON.parse(rawBody); } catch { /* ignore */ }
    }

    if (!response.ok) {
      const parsedError = parseApiErrorResponse(response.status, parsedBody);
      if (
        response.status === 409 &&
        parsedError.code === CRDT_REMATERIALIZATION_REQUIRED_CODE
      ) {
        throw new VfsCrdtRematerializationRequiredError({
          message: parsedError.message,
          requestedCursor: parsedError.requestedCursor,
          oldestAvailableCursor: parsedError.oldestAvailableCursor
        });
      }

      throw new Error(parseErrorMessage(response.status, parsedBody));
    }

    return parsedBody;
  }

  private buildUrl(path: string, query: URLSearchParams | undefined): string {
    const normalizedPath = path.startsWith('/') ? path : `/${path}`;
    const pathname = `${this.apiPrefix}${normalizedPath}`;
    const base =
      this.baseUrl.length > 0 ? `${this.baseUrl}${pathname}` : pathname;
    const queryString = query?.toString();
    if (!queryString) {
      return base;
    }

    return `${base}?${queryString}`;
  }

  private async buildHeaders(
    hasBody: boolean
  ): Promise<Headers> {
    const headers = new Headers();
    headers.set('Accept', 'application/json');
    if (hasBody) {
      headers.set('Content-Type', 'application/json');
    }

    for (const [header, value] of Object.entries(this.headers)) {
      headers.set(header, value);
    }

    if (this.getAuthToken) {
      const token = await this.getAuthToken();
      if (typeof token === 'string' && token.trim().length > 0) {
        headers.set('Authorization', `Bearer ${token}`);
      }
    }

    return headers;
  }
}

function normalizeBaseUrl(baseUrl: string): string {
  const trimmed = baseUrl.trim();
  if (trimmed.length === 0) {
    return '';
  }

  return trimmed.endsWith('/') ? trimmed.slice(0, -1) : trimmed;
}

function normalizeApiPrefix(apiPrefix: string): string {
  const trimmed = apiPrefix.trim();
  if (trimmed.length === 0) {
    return '';
  }

  const withLeadingSlash = trimmed.startsWith('/') ? trimmed : `/${trimmed}`;
  return withLeadingSlash.endsWith('/')
    ? withLeadingSlash.slice(0, -1)
    : withLeadingSlash;
}
