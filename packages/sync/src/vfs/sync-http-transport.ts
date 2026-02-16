import type {
  VfsCrdtSyncPullResponse,
  VfsCrdtSyncPushResponse,
  VfsCrdtSyncReconcileResponse,
  VfsCrdtSyncTransport
} from './sync-client.js';
import type { VfsCrdtOperation } from './sync-crdt.js';
import {
  decodeVfsSyncCursor,
  encodeVfsSyncCursor,
  type VfsSyncCursor
} from './sync-cursor.js';
import {
  parseApiPullResponse,
  parseApiPushResponse,
  parseApiReconcileResponse,
  parseErrorMessage
} from './sync-http-transport-parser.js';

type FetchImpl = typeof fetch;

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
    const body = await this.requestJson(
      '/vfs/crdt/push',
      {
        clientId: input.clientId,
        operations: input.operations
      },
      undefined
    );
    const parsed = parseApiPushResponse(body);
    return {
      results: parsed.results
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

    const body = await this.requestJson('/vfs/crdt/sync', undefined, query);
    const parsed = parseApiPullResponse(body);

    let nextCursor: VfsSyncCursor | null = null;
    if (parsed.nextCursor) {
      const decoded = decodeVfsSyncCursor(parsed.nextCursor);
      if (!decoded) {
        throw new Error('transport returned invalid nextCursor');
      }
      nextCursor = decoded;
    }

    return {
      items: parsed.items,
      hasMore: parsed.hasMore,
      nextCursor,
      lastReconciledWriteIds: parsed.lastReconciledWriteIds
    };
  }

  async reconcileState(input: {
    userId: string;
    clientId: string;
    cursor: VfsSyncCursor;
    lastReconciledWriteIds: VfsCrdtSyncReconcileResponse['lastReconciledWriteIds'];
  }): Promise<VfsCrdtSyncReconcileResponse> {
    const body = await this.requestJson(
      '/vfs/crdt/reconcile',
      {
        clientId: input.clientId,
        cursor: encodeVfsSyncCursor(input.cursor),
        lastReconciledWriteIds: input.lastReconciledWriteIds
      },
      undefined
    );
    const parsed = parseApiReconcileResponse(body);

    /**
     * Guardrail: response must describe the same client namespace we reconciled.
     * A mismatch here could merge another client replica's cursor/write clocks
     * into this local state, which would corrupt monotonic ordering.
     */
    if (parsed.clientId !== input.clientId) {
      throw new Error(
        'transport returned reconcile response for mismatched clientId'
      );
    }

    const decodedCursor = decodeVfsSyncCursor(parsed.cursor);
    if (!decodedCursor) {
      throw new Error('transport returned invalid reconcile cursor');
    }

    return {
      cursor: decodedCursor,
      lastReconciledWriteIds: parsed.lastReconciledWriteIds
    };
  }

  private async requestJson(
    path: string,
    body: unknown,
    query: URLSearchParams | undefined
  ): Promise<unknown> {
    /**
     * Guardrail: every endpoint in this transport is JSON-only. We intentionally
     * reject non-JSON bodies (including HTML/text error pages) to avoid quietly
     * accepting proxy or auth-layer failures as valid sync protocol payloads.
     */
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
    const parsedBody = this.parseBody(rawBody);
    if (!response.ok) {
      throw new Error(parseErrorMessage(response.status, parsedBody));
    }

    return parsedBody;
  }

  private parseBody(rawBody: string): unknown {
    if (rawBody.length === 0) {
      return null;
    }

    try {
      return JSON.parse(rawBody);
    } catch {
      throw new Error('transport returned non-JSON response');
    }
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
    includeJsonContentType: boolean
  ): Promise<Headers> {
    const headers = new Headers();
    headers.set('Accept', 'application/json');
    if (includeJsonContentType) {
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
