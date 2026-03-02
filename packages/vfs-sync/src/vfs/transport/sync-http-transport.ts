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
  parseApiPullResponse,
  parseApiPushResponse,
  parseApiReconcileResponse
} from './sync-http-transport-parser.js';

type FetchImpl = typeof fetch;
const CRDT_REMATERIALIZATION_REQUIRED_CODE = 'crdt_rematerialization_required';
const CONNECT_ALREADY_EXISTS_CODE = 'already_exists';
const JSON_CONTENT_TYPE = 'application/json';
const VFS_CONNECT_BASE_PATH = '/connect/tearleads.v1.VfsService';

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
    this.apiPrefix = normalizeApiPrefix(options.apiPrefix ?? '');
    this.fetchImpl = options.fetchImpl ?? fetch;
    this.getAuthToken = options.getAuthToken ?? null;
    this.headers = options.headers ?? {};
  }

  async pushOperations(input: {
    userId: string;
    clientId: string;
    operations: VfsCrdtOperation[];
  }): Promise<VfsCrdtSyncPushResponse> {
    const parsed = parseApiPushResponse(
      await this.requestConnectJson('PushCrdtOps', {
        json: JSON.stringify({
          clientId: input.clientId,
          operations: input.operations
        })
      })
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
    const requestBody: Record<string, unknown> = {
      limit: input.limit
    };
    if (input.cursor) {
      requestBody['cursor'] = encodeVfsSyncCursor(input.cursor);
    }

    const parsed = parseApiPullResponse(
      await this.requestConnectJson('GetCrdtSync', requestBody)
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
    const parsed = parseApiReconcileResponse(
      await this.requestConnectJson('ReconcileCrdt', {
        json: JSON.stringify({
          clientId: input.clientId,
          cursor: encodeVfsSyncCursor(input.cursor),
          lastReconciledWriteIds: input.lastReconciledWriteIds
        })
      })
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
    const parsedSession = await this.requestConnectJson('RunCrdtSession', {
      json: JSON.stringify({
        clientId: input.clientId,
        cursor: encodeVfsSyncCursor(input.cursor),
        limit: input.limit,
        operations: input.operations,
        lastReconciledWriteIds: input.lastReconciledWriteIds,
        rootId: input.rootId ?? null
      })
    });

    if (
      !isRecord(parsedSession) ||
      !('push' in parsedSession) ||
      !('pull' in parsedSession) ||
      !('reconcile' in parsedSession)
    ) {
      throw new Error('transport returned invalid sync session payload');
    }

    const parsedPush = parseApiPushResponse(parsedSession['push']);
    const parsedPull = parseApiPullResponse(parsedSession['pull']);
    const parsedReconcile = parseApiReconcileResponse(
      parsedSession['reconcile']
    );

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

  private async requestConnectJson(
    methodName: string,
    body: Record<string, unknown>
  ): Promise<unknown> {
    const requestUrl = this.buildUrl(methodName);
    const headers = await this.buildHeaders();

    const response = await this.fetchImpl(requestUrl, {
      method: 'POST',
      headers,
      body: JSON.stringify(body)
    });

    const parsedBody = await this.parseJsonBody(response);

    if (!response.ok) {
      const parsedError = parseApiErrorResponse(response.status, parsedBody);
      const normalizedMessage = parsedError.message.toLowerCase();
      const isRematerializationError =
        response.status === 409 &&
        (parsedError.code === CRDT_REMATERIALIZATION_REQUIRED_CODE ||
          (parsedError.code === CONNECT_ALREADY_EXISTS_CODE &&
            normalizedMessage.includes('rematerialization')));

      if (isRematerializationError) {
        throw new VfsCrdtRematerializationRequiredError({
          message: parsedError.message,
          requestedCursor: parsedError.requestedCursor,
          oldestAvailableCursor: parsedError.oldestAvailableCursor
        });
      }

      throw new Error(parsedError.message);
    }

    return parseConnectJsonEnvelopeBody(parsedBody);
  }

  private async parseJsonBody(response: Response): Promise<unknown> {
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

  private buildUrl(methodName: string): string {
    const pathname = `${this.apiPrefix}${VFS_CONNECT_BASE_PATH}/${methodName}`;
    return this.baseUrl.length > 0 ? `${this.baseUrl}${pathname}` : pathname;
  }

  private async buildHeaders(): Promise<Headers> {
    const headers = new Headers();
    headers.set('Accept', JSON_CONTENT_TYPE);
    headers.set('Content-Type', JSON_CONTENT_TYPE);

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

function parseConnectJsonEnvelopeBody(body: unknown): unknown {
  if (!isRecord(body) || typeof body['json'] !== 'string') {
    return body;
  }

  const rawJson = body['json'].trim();
  if (rawJson.length === 0) {
    return {};
  }

  try {
    return JSON.parse(rawJson);
  } catch {
    throw new Error('transport returned invalid connect json envelope');
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}
