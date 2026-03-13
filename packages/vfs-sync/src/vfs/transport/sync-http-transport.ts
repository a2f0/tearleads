import type { VfsSyncBloomFilter } from '@tearleads/shared';
import {
  isPlainRecord,
  parseConnectJsonEnvelopeBody,
  VFS_V2_CONNECT_BASE_PATH
} from '@tearleads/shared';
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
  ACCESS_LEVEL_MAP,
  encodeBytesToBase64,
  OP_TYPE_MAP,
  PRINCIPAL_TYPE_MAP,
  packUuidToBytes
} from '../protocol/syncProtobufNormalization.js';
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
const ORGANIZATION_HEADER_NAME = 'X-Organization-Id';
const MAX_ORG_ID_LENGTH = 100;
const ORG_ID_PATTERN = /^[a-zA-Z0-9-]+$/u;

function toPackedIdBase64(value: string): string {
  return encodeBytesToBase64(packUuidToBytes(value));
}

function toCompactOperation(
  operation: VfsCrdtOperation
): Record<string, unknown> {
  const occurredAtMs = Date.parse(operation.occurredAt);
  if (!Number.isFinite(occurredAtMs)) {
    throw new Error('operation occurredAt must be a valid ISO timestamp');
  }

  const compact: Record<string, unknown> = {
    ...operation,
    opIdBytes: toPackedIdBase64(operation.opId),
    opTypeEnum: OP_TYPE_MAP[operation.opType] ?? 0,
    itemIdBytes: toPackedIdBase64(operation.itemId),
    replicaIdBytes: toPackedIdBase64(operation.replicaId),
    writeIdU64: operation.writeId,
    occurredAtMs
  };

  if (operation.principalType) {
    compact['principalTypeEnum'] =
      PRINCIPAL_TYPE_MAP[operation.principalType] ?? 0;
  }
  if (operation.principalId) {
    compact['principalIdBytes'] = toPackedIdBase64(operation.principalId);
  }
  if (operation.accessLevel) {
    compact['accessLevelEnum'] = ACCESS_LEVEL_MAP[operation.accessLevel] ?? 0;
  }
  if (operation.parentId) {
    compact['parentIdBytes'] = toPackedIdBase64(operation.parentId);
  }
  if (operation.childId) {
    compact['childIdBytes'] = toPackedIdBase64(operation.childId);
  }

  return compact;
}

export interface VfsHttpCrdtSyncTransportOptions {
  baseUrl?: string;
  apiPrefix?: string;
  fetchImpl?: FetchImpl;
  getAuthToken?: (() => string | Promise<string | null> | null) | null;
  getOrganizationId?: (() => string | null) | null;
  organizationId?: string | null;
  headers?: Record<string, string>;
}

export class VfsHttpCrdtSyncTransport implements VfsCrdtSyncTransport {
  private readonly baseUrl: string;
  private readonly apiPrefix: string;
  private readonly fetchImpl: FetchImpl;
  private readonly getAuthToken:
    | (() => string | Promise<string | null> | null)
    | null;
  private readonly getOrganizationId: (() => string | null) | null;
  private readonly organizationId: string | null;
  private readonly headers: Record<string, string>;

  constructor(options: VfsHttpCrdtSyncTransportOptions = {}) {
    this.baseUrl = normalizeBaseUrl(options.baseUrl ?? '');
    this.apiPrefix = normalizeApiPrefix(options.apiPrefix ?? '');
    this.fetchImpl = options.fetchImpl ?? fetch;
    this.getAuthToken = options.getAuthToken ?? null;
    this.getOrganizationId = options.getOrganizationId ?? null;
    this.headers = options.headers ?? {};
    const explicitOrganizationId = normalizeOrganizationId(
      options.organizationId ?? null
    );
    this.organizationId =
      explicitOrganizationId ?? resolveOrganizationIdFromHeaders(this.headers);
  }

  async pushOperations(input: {
    userId: string;
    clientId: string;
    operations: VfsCrdtOperation[];
  }): Promise<VfsCrdtSyncPushResponse> {
    const organizationId = this.resolveOrganizationId();
    const parsed = parseApiPushResponse(
      await this.requestConnectJson(
        'PushCrdtOps',
        {
          organizationId: organizationId ?? '',
          clientId: input.clientId,
          ...(organizationId
            ? { organizationIdBytes: toPackedIdBase64(organizationId) }
            : {}),
          clientIdBytes: toPackedIdBase64(input.clientId),
          operations: input.operations.map((operation) =>
            toCompactOperation(operation)
          ),
          version: 2
        },
        {
          organizationId
        }
      )
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
    bloomFilter?: VfsSyncBloomFilter | null;
  }): Promise<VfsCrdtSyncPullResponse> {
    const organizationId = this.resolveOrganizationId();
    const requestBody: Record<string, unknown> = {
      limit: input.limit,
      version: 2
    };
    if (input.cursor) {
      requestBody['cursor'] = encodeVfsSyncCursor(input.cursor);
    }
    if (input.bloomFilter) {
      requestBody['bloomFilter'] = input.bloomFilter;
    }

    const parsed = parseApiPullResponse(
      await this.requestConnectJson('GetCrdtSync', requestBody, {
        organizationId
      })
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
      lastReconciledWriteIds: parsed.lastReconciledWriteIds,
      bloomFilter: parsed.bloomFilter ?? null
    };
  }

  async reconcileState(input: {
    userId: string;
    clientId: string;
    cursor: VfsSyncCursor;
    lastReconciledWriteIds: VfsCrdtSyncReconcileResponse['lastReconciledWriteIds'];
  }): Promise<VfsCrdtSyncReconcileResponse> {
    const organizationId = this.resolveOrganizationId();
    if (!organizationId) {
      throw new Error(
        'VfsHttpCrdtSyncTransport: organizationId is required for reconcileState.'
      );
    }
    const parsed = parseApiReconcileResponse(
      await this.requestConnectJson(
        'ReconcileCrdt',
        {
          organizationId,
          clientId: input.clientId,
          ...(organizationId
            ? { organizationIdBytes: toPackedIdBase64(organizationId) }
            : {}),
          clientIdBytes: toPackedIdBase64(input.clientId),
          cursor: encodeVfsSyncCursor(input.cursor),
          lastReconciledWriteIds: input.lastReconciledWriteIds,
          version: 2
        },
        {
          organizationId
        }
      )
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
    bloomFilter?: VfsSyncBloomFilter | null;
  }): Promise<{
    push: VfsCrdtSyncPushResponse;
    pull: VfsCrdtSyncPullResponse;
    reconcile: VfsCrdtSyncReconcileResponse;
  }> {
    const organizationId = this.resolveOrganizationId();
    const parsedSession = await this.requestConnectJson(
      'RunCrdtSession',
      {
        organizationId: organizationId ?? '',
        clientId: input.clientId,
        ...(organizationId
          ? { organizationIdBytes: toPackedIdBase64(organizationId) }
          : {}),
        clientIdBytes: toPackedIdBase64(input.clientId),
        cursor: encodeVfsSyncCursor(input.cursor),
        limit: input.limit,
        operations: input.operations.map((operation) =>
          toCompactOperation(operation)
        ),
        lastReconciledWriteIds: input.lastReconciledWriteIds,
        rootId: input.rootId ?? null,
        ...(input.rootId
          ? { rootIdBytes: toPackedIdBase64(input.rootId) }
          : {}),
        bloomFilter: input.bloomFilter ?? null,
        version: 2
      },
      {
        organizationId
      }
    );

    if (
      !isPlainRecord(parsedSession) ||
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
        lastReconciledWriteIds: parsedPull.lastReconciledWriteIds,
        bloomFilter: parsedPull.bloomFilter ?? null
      },
      reconcile: {
        cursor: reconcileCursor,
        lastReconciledWriteIds: parsedReconcile.lastReconciledWriteIds
      }
    };
  }

  private async requestConnectJson(
    methodName: string,
    body: Record<string, unknown>,
    options?: {
      organizationId?: string | null;
    }
  ): Promise<unknown> {
    const requestUrl = this.buildUrl(methodName);
    const headers = await this.buildHeaders(options?.organizationId);

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

  private resolveOrganizationId(): string | null {
    const dynamicOrganizationId = this.getOrganizationId
      ? normalizeOrganizationId(this.getOrganizationId())
      : null;
    return dynamicOrganizationId ?? this.organizationId;
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
    const pathname = `${this.apiPrefix}${VFS_V2_CONNECT_BASE_PATH}/${methodName}`;
    return this.baseUrl.length > 0 ? `${this.baseUrl}${pathname}` : pathname;
  }

  private async buildHeaders(
    organizationIdOverride?: string | null
  ): Promise<Headers> {
    const headers = new Headers();
    headers.set('Accept', JSON_CONTENT_TYPE);
    headers.set('Content-Type', JSON_CONTENT_TYPE);
    headers.set('Accept-Encoding', 'gzip');

    for (const [header, value] of Object.entries(this.headers)) {
      headers.set(header, value);
    }

    if (this.getAuthToken) {
      const token = await this.getAuthToken();
      if (typeof token === 'string' && token.trim().length > 0) {
        headers.set('Authorization', `Bearer ${token}`);
      }
    }

    if (organizationIdOverride !== undefined) {
      const resolvedOrganizationId = normalizeOrganizationId(
        organizationIdOverride
      );
      if (resolvedOrganizationId && !headers.has(ORGANIZATION_HEADER_NAME)) {
        headers.set(ORGANIZATION_HEADER_NAME, resolvedOrganizationId);
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

function normalizeOrganizationId(value: string | null): string | null {
  if (typeof value !== 'string') {
    return null;
  }

  const trimmed = value.trim();
  if (
    trimmed.length === 0 ||
    trimmed.length > MAX_ORG_ID_LENGTH ||
    !ORG_ID_PATTERN.test(trimmed)
  ) {
    return null;
  }

  return trimmed;
}

function resolveOrganizationIdFromHeaders(
  headers: Record<string, string>
): string | null {
  for (const [key, value] of Object.entries(headers)) {
    if (key.toLowerCase() === 'x-organization-id') {
      return normalizeOrganizationId(value);
    }
  }

  return null;
}
