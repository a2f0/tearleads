import type {
  VfsAclAccessLevel,
  VfsAclPrincipalType,
  VfsCrdtOpType,
  VfsCrdtPushResponse,
  VfsCrdtPushStatus,
  VfsCrdtSyncItem,
  VfsCrdtSyncResponse
} from '@tearleads/shared';
import {
  decodeVfsSyncCursor,
  encodeVfsSyncCursor,
  type VfsSyncCursor
} from './sync-cursor.js';
import type { VfsCrdtOperation } from './sync-crdt.js';
import { parseVfsCrdtLastReconciledWriteIds } from './sync-crdt-reconcile.js';
import type {
  VfsCrdtSyncPullResponse,
  VfsCrdtSyncPushResponse,
  VfsCrdtSyncTransport
} from './sync-client.js';

const VALID_OP_TYPES: VfsCrdtOpType[] = [
  'acl_add',
  'acl_remove',
  'link_add',
  'link_remove'
];
const VALID_PRINCIPAL_TYPES: VfsAclPrincipalType[] = [
  'user',
  'group',
  'organization'
];
const VALID_ACCESS_LEVELS: VfsAclAccessLevel[] = ['read', 'write', 'admin'];
const VALID_PUSH_STATUSES: VfsCrdtPushStatus[] = [
  'applied',
  'alreadyApplied',
  'staleWriteId',
  'outdatedOp',
  'invalidOp'
];

type FetchImpl = typeof fetch;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function parseRequiredString(value: unknown, fieldName: string): string {
  if (typeof value !== 'string') {
    throw new Error(`transport returned invalid ${fieldName}`);
  }

  const trimmed = value.trim();
  if (trimmed.length === 0) {
    throw new Error(`transport returned invalid ${fieldName}`);
  }

  return trimmed;
}

function parseNullableString(
  value: unknown,
  fieldName: string
): string | null {
  if (value === null) {
    return null;
  }

  return parseRequiredString(value, fieldName);
}

function parseIsoString(value: unknown, fieldName: string): string {
  const normalized = parseRequiredString(value, fieldName);
  const parsedMs = Date.parse(normalized);
  if (!Number.isFinite(parsedMs)) {
    throw new Error(`transport returned invalid ${fieldName}`);
  }

  return new Date(parsedMs).toISOString();
}

function isOpType(value: unknown): value is VfsCrdtOpType {
  return (
    typeof value === 'string' &&
    VALID_OP_TYPES.some((candidate) => candidate === value)
  );
}

function parseOpType(value: unknown, fieldName: string): VfsCrdtOpType {
  if (!isOpType(value)) {
    throw new Error(`transport returned invalid ${fieldName}`);
  }

  return value;
}

function isPrincipalType(value: unknown): value is VfsAclPrincipalType {
  return (
    typeof value === 'string' &&
    VALID_PRINCIPAL_TYPES.some((candidate) => candidate === value)
  );
}

function parseNullablePrincipalType(
  value: unknown,
  fieldName: string
): VfsAclPrincipalType | null {
  if (value === null) {
    return null;
  }

  if (!isPrincipalType(value)) {
    throw new Error(`transport returned invalid ${fieldName}`);
  }

  return value;
}

function isAccessLevel(value: unknown): value is VfsAclAccessLevel {
  return (
    typeof value === 'string' &&
    VALID_ACCESS_LEVELS.some((candidate) => candidate === value)
  );
}

function parseNullableAccessLevel(
  value: unknown,
  fieldName: string
): VfsAclAccessLevel | null {
  if (value === null) {
    return null;
  }

  if (!isAccessLevel(value)) {
    throw new Error(`transport returned invalid ${fieldName}`);
  }

  return value;
}

function isPushStatus(value: unknown): value is VfsCrdtPushStatus {
  return (
    typeof value === 'string' &&
    VALID_PUSH_STATUSES.some((candidate) => candidate === value)
  );
}

function parseApiPushResponse(body: unknown): VfsCrdtPushResponse {
  if (!isRecord(body)) {
    throw new Error('transport returned invalid push response payload');
  }

  const clientId = parseRequiredString(body['clientId'], 'clientId');
  const rawResults = body['results'];
  if (!Array.isArray(rawResults)) {
    throw new Error('transport returned invalid push response results');
  }

  const results: VfsCrdtPushResponse['results'] = [];
  for (let index = 0; index < rawResults.length; index++) {
    const rawResult = rawResults[index];
    if (!isRecord(rawResult)) {
      throw new Error(`transport returned invalid push result at index ${index}`);
    }

    const opId = parseRequiredString(rawResult['opId'], `results[${index}].opId`);
    const statusValue = rawResult['status'];
    if (!isPushStatus(statusValue)) {
      throw new Error(`transport returned invalid results[${index}].status`);
    }

    results.push({
      opId,
      status: statusValue
    });
  }

  return {
    clientId,
    results
  };
}

function parseSyncItem(value: unknown, index: number): VfsCrdtSyncItem {
  if (!isRecord(value)) {
    throw new Error(`transport returned invalid items[${index}]`);
  }

  return {
    opId: parseRequiredString(value['opId'], `items[${index}].opId`),
    itemId: parseRequiredString(value['itemId'], `items[${index}].itemId`),
    opType: parseOpType(value['opType'], `items[${index}].opType`),
    principalType: parseNullablePrincipalType(
      value['principalType'],
      `items[${index}].principalType`
    ),
    principalId: parseNullableString(
      value['principalId'],
      `items[${index}].principalId`
    ),
    accessLevel: parseNullableAccessLevel(
      value['accessLevel'],
      `items[${index}].accessLevel`
    ),
    parentId: parseNullableString(value['parentId'], `items[${index}].parentId`),
    childId: parseNullableString(value['childId'], `items[${index}].childId`),
    actorId: parseNullableString(value['actorId'], `items[${index}].actorId`),
    sourceTable: parseRequiredString(
      value['sourceTable'],
      `items[${index}].sourceTable`
    ),
    sourceId: parseRequiredString(value['sourceId'], `items[${index}].sourceId`),
    occurredAt: parseIsoString(value['occurredAt'], `items[${index}].occurredAt`)
  };
}

function parseApiPullResponse(body: unknown): VfsCrdtSyncResponse {
  if (!isRecord(body)) {
    throw new Error('transport returned invalid pull response payload');
  }

  const rawItems = body['items'];
  if (!Array.isArray(rawItems)) {
    throw new Error('transport returned invalid pull response items');
  }

  const nextCursorValue = body['nextCursor'];
  if (nextCursorValue !== null && typeof nextCursorValue !== 'string') {
    throw new Error('transport returned invalid nextCursor');
  }

  const hasMoreValue = body['hasMore'];
  if (typeof hasMoreValue !== 'boolean') {
    throw new Error('transport returned invalid hasMore');
  }

  const parsedWriteIds = parseVfsCrdtLastReconciledWriteIds(
    body['lastReconciledWriteIds']
  );
  if (!parsedWriteIds.ok) {
    throw new Error(parsedWriteIds.error);
  }

  const items = rawItems.map((item, index) => parseSyncItem(item, index));
  return {
    items,
    nextCursor: nextCursorValue,
    hasMore: hasMoreValue,
    lastReconciledWriteIds: parsedWriteIds.value
  };
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

function parseErrorMessage(status: number, body: unknown): string {
  if (isRecord(body) && typeof body['error'] === 'string') {
    const normalized = body['error'].trim();
    if (normalized.length > 0) {
      return normalized;
    }
  }

  return `request failed with status ${status}`;
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

  private async requestJson(
    path: string,
    body: unknown,
    query: URLSearchParams | undefined
  ): Promise<unknown> {
    const requestUrl = this.buildUrl(path, query);
    const headers = await this.buildHeaders(body !== undefined);
    const response = await this.fetchImpl(requestUrl, {
      method: body === undefined ? 'GET' : 'POST',
      headers,
      body: body === undefined ? undefined : JSON.stringify(body)
    });

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
    const base = this.baseUrl.length > 0 ? `${this.baseUrl}${pathname}` : pathname;
    const queryString = query?.toString();
    if (!queryString) {
      return base;
    }

    return `${base}?${queryString}`;
  }

  private async buildHeaders(includeJsonContentType: boolean): Promise<Headers> {
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
