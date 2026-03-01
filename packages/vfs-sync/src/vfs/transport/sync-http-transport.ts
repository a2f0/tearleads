import type {
  VfsCrdtSyncPullResponse,
  VfsCrdtSyncPushResponse,
  VfsCrdtSyncReconcileResponse,
  VfsCrdtSyncTransport
} from '../client/sync-client.js';
import { VfsCrdtRematerializationRequiredError } from '../client/sync-client-utils.js';
import {
  decodeVfsCrdtPushResponseProtobuf,
  decodeVfsCrdtReconcileResponseProtobuf,
  decodeVfsCrdtSyncSessionResponseProtobuf,
  decodeVfsCrdtSyncResponseProtobuf,
  encodeVfsCrdtPushRequestProtobuf,
  encodeVfsCrdtReconcileRequestProtobuf,
  encodeVfsCrdtSyncSessionRequestProtobuf
} from '../protocol/sync-protobuf.js';
import type { VfsCrdtOperation } from '../protocol/sync-crdt.js';
import {
  decodeVfsSyncCursor,
  encodeVfsSyncCursor,
  type VfsSyncCursor
} from '../protocol/sync-cursor.js';
import {
  parseApiErrorResponse,
  parseApiPullResponse,
  parseApiPushResponse,
  parseApiReconcileResponse,
  parseErrorMessage
} from './sync-http-transport-parser.js';

type FetchImpl = typeof fetch;
const CRDT_REMATERIALIZATION_REQUIRED_CODE = 'crdt_rematerialization_required';
const PROTOBUF_CONTENT_TYPE = 'application/x-protobuf';

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
    const responseBytes = await this.requestBinary(
      '/vfs/crdt/push',
      encodeVfsCrdtPushRequestProtobuf({
        clientId: input.clientId,
        operations: input.operations
      }),
      undefined
    );
    const parsed = parseApiPushResponse(
      decodeVfsCrdtPushResponseProtobuf(responseBytes)
    );
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

    const responseBytes = await this.requestBinary(
      '/vfs/crdt/vfs-sync',
      undefined,
      query
    );
    const parsed = parseApiPullResponse(
      decodeVfsCrdtSyncResponseProtobuf(responseBytes)
    );

    const nextCursor = parsed.nextCursor
      ? decodeVfsSyncCursor(parsed.nextCursor)
      : null;
    if (parsed.nextCursor && !nextCursor) {
      throw new Error('transport returned invalid nextCursor');
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
    const responseBytes = await this.requestBinary(
      '/vfs/crdt/reconcile',
      encodeVfsCrdtReconcileRequestProtobuf({
        clientId: input.clientId,
        cursor: encodeVfsSyncCursor(input.cursor),
        lastReconciledWriteIds: input.lastReconciledWriteIds
      }),
      undefined
    );
    const parsed = parseApiReconcileResponse(
      decodeVfsCrdtReconcileResponseProtobuf(responseBytes)
    );

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

  async syncSession(input: {
    userId: string;
    clientId: string;
    cursor: VfsSyncCursor;
    limit: number;
    operations: VfsCrdtOperation[];
    lastReconciledWriteIds: VfsCrdtSyncReconcileResponse['lastReconciledWriteIds'];
    rootId?: string | null;
  }): Promise<{
    push: VfsCrdtSyncPushResponse;
    pull: VfsCrdtSyncPullResponse;
    reconcile: VfsCrdtSyncReconcileResponse;
  }> {
    const responseBytes = await this.requestBinary(
      '/vfs/crdt/session',
      encodeVfsCrdtSyncSessionRequestProtobuf({
        clientId: input.clientId,
        cursor: encodeVfsSyncCursor(input.cursor),
        limit: input.limit,
        operations: input.operations,
        lastReconciledWriteIds: input.lastReconciledWriteIds,
        rootId: input.rootId ?? null
      }),
      undefined
    );
    const parsedSession = decodeVfsCrdtSyncSessionResponseProtobuf(responseBytes);
    if (
      typeof parsedSession !== 'object' ||
      parsedSession === null ||
      !('push' in parsedSession) ||
      !('pull' in parsedSession) ||
      !('reconcile' in parsedSession)
    ) {
      throw new Error('transport returned invalid sync session payload');
    }

    const parsedPush = parseApiPushResponse(parsedSession.push);
    const parsedPull = parseApiPullResponse(parsedSession.pull);
    const parsedReconcile = parseApiReconcileResponse(parsedSession.reconcile);
    const nextCursor = parsedPull.nextCursor
      ? decodeVfsSyncCursor(parsedPull.nextCursor)
      : null;
    if (parsedPull.nextCursor && !nextCursor) {
      throw new Error('transport returned invalid nextCursor');
    }
    const reconcileCursor = decodeVfsSyncCursor(parsedReconcile.cursor);
    if (!reconcileCursor) {
      throw new Error('transport returned invalid reconcile cursor');
    }

    return {
      push: {
        results: parsedPush.results
      },
      pull: {
        items: parsedPull.items,
        hasMore: parsedPull.hasMore,
        nextCursor,
        lastReconciledWriteIds: parsedPull.lastReconciledWriteIds
      },
      reconcile: {
        cursor: reconcileCursor,
        lastReconciledWriteIds: parsedReconcile.lastReconciledWriteIds
      }
    };
  }

  private async requestBinary(
    path: string,
    body: Uint8Array | undefined,
    query: URLSearchParams | undefined
  ): Promise<Uint8Array> {
    const requestUrl = this.buildUrl(path, query);
    const headers = await this.buildHeaders(body !== undefined);
    const requestInit: RequestInit = {
      method: body === undefined ? 'GET' : 'POST',
      headers
    };
    if (body !== undefined) {
      requestInit.body = body;
    }

    const response = await this.fetchImpl(requestUrl, requestInit);

    if (!response.ok) {
      const parsedBody = await this.parseErrorBody(response);
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

    const buffer = await response.arrayBuffer();
    return new Uint8Array(buffer);
  }

  private async parseErrorBody(response: Response): Promise<unknown> {
    const rawBody = await response.text();
    if (rawBody.trim().length === 0) {
      return null;
    }

    try {
      return JSON.parse(rawBody);
    } catch {
      return { error: rawBody };
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
    hasBody: boolean
  ): Promise<Headers> {
    const headers = new Headers();
    headers.set('Accept', PROTOBUF_CONTENT_TYPE);
    if (hasBody) {
      headers.set('Content-Type', PROTOBUF_CONTENT_TYPE);
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
