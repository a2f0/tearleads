import { parseConnectJsonEnvelopeBody } from '@tearleads/shared';

export interface ConnectRouteMapping {
  path: string;
  body: Record<string, unknown>;
  unwrapJsonEnvelope: boolean;
  successStatus?: number;
  legacyDefaults?: Record<string, unknown>;
}

const AUTH_SERVICE_PATH = '/v1/connect/tearleads.v1.AuthService';
const AI_SERVICE_PATH = '/v1/connect/tearleads.v1.AiService';
const VFS_SERVICE_PATH = '/v1/connect/tearleads.v1.VfsService';
const VFS_SHARES_SERVICE_PATH = '/v1/connect/tearleads.v1.VfsSharesService';

function parseJson<T>(text: string): T {
  return JSON.parse(text);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function readBodyText(body: RequestInit['body']): string {
  if (typeof body === 'string') {
    return body;
  }
  if (body instanceof URLSearchParams) {
    return body.toString();
  }
  return '';
}

function readJsonBody(body: RequestInit['body']): Record<string, unknown> {
  const text = readBodyText(body).trim();
  if (text.length === 0) {
    return {};
  }
  const parsed = parseJson<unknown>(text);
  return isRecord(parsed) ? parsed : {};
}

function encodedSegment(value: string): string {
  return decodeURIComponent(value);
}

function requiredMatchGroup(match: RegExpMatchArray, index: number): string {
  const value = match[index];
  if (!value) {
    throw new Error('invalid route match: missing segment');
  }
  return value;
}

function parseOptionalInt(value: string | null): number | undefined {
  if (!value) return undefined;
  const parsed = Number.parseInt(value, 10);
  return Number.isFinite(parsed) ? parsed : undefined;
}

function buildGetUsageBody(searchParams: URLSearchParams): Record<string, unknown> {
  const body: Record<string, unknown> = {};
  const startDate = searchParams.get('startDate');
  const endDate = searchParams.get('endDate');
  const cursor = searchParams.get('cursor');
  const limit = parseOptionalInt(searchParams.get('limit'));
  if (startDate) body['startDate'] = startDate;
  if (endDate) body['endDate'] = endDate;
  if (cursor) body['cursor'] = cursor;
  if (limit !== undefined) body['limit'] = limit;
  return body;
}

function buildGetSyncBody(searchParams: URLSearchParams): Record<string, unknown> {
  const body: Record<string, unknown> = {};
  const cursor = searchParams.get('cursor');
  const limit = parseOptionalInt(searchParams.get('limit'));
  const rootId = searchParams.get('rootId');
  if (cursor) body['cursor'] = cursor;
  if (limit !== undefined) body['limit'] = limit;
  if (rootId) body['rootId'] = rootId;
  return body;
}

export function mapLegacyPathToConnect(
  path: string,
  init: RequestInit | undefined
): ConnectRouteMapping | null {
  const url = new URL(path, 'http://localhost');
  const method = (init?.method ?? 'GET').toUpperCase();
  const pathname = url.pathname;
  const jsonBody = readJsonBody(init?.body);
  const bodyText = readBodyText(init?.body);
  const jsonBodyText = bodyText.trim().length === 0 ? '{}' : bodyText;

  if (pathname === '/auth/register' && method === 'POST') {
    return {
      path: `${AUTH_SERVICE_PATH}/Register`,
      body: jsonBody,
      unwrapJsonEnvelope: false
    };
  }
  if (pathname === '/auth/login' && method === 'POST') {
    return {
      path: `${AUTH_SERVICE_PATH}/Login`,
      body: jsonBody,
      unwrapJsonEnvelope: false
    };
  }
  if (pathname === '/auth/refresh' && method === 'POST') {
    return {
      path: `${AUTH_SERVICE_PATH}/RefreshToken`,
      body: jsonBody,
      unwrapJsonEnvelope: false
    };
  }
  if (pathname === '/auth/sessions' && method === 'GET') {
    return {
      path: `${AUTH_SERVICE_PATH}/GetSessions`,
      body: {},
      unwrapJsonEnvelope: false
    };
  }
  if (pathname === '/auth/logout' && method === 'POST') {
    return {
      path: `${AUTH_SERVICE_PATH}/Logout`,
      body: {},
      unwrapJsonEnvelope: false
    };
  }

  if (pathname === '/ai/usage' && method === 'POST') {
    return {
      path: `${AI_SERVICE_PATH}/RecordUsage`,
      body: jsonBody,
      unwrapJsonEnvelope: false
    };
  }
  if (pathname === '/ai/usage' && method === 'GET') {
    return {
      path: `${AI_SERVICE_PATH}/GetUsage`,
      body: buildGetUsageBody(url.searchParams),
      unwrapJsonEnvelope: false,
      legacyDefaults: { hasMore: false }
    };
  }
  if (pathname === '/ai/usage/summary') {
    const body =
      method === 'GET' ? buildGetUsageBody(url.searchParams) : jsonBody;
    return {
      path: `${AI_SERVICE_PATH}/GetUsageSummary`,
      body,
      unwrapJsonEnvelope: false
    };
  }

  if (pathname === '/vfs/keys' && method === 'POST') {
    return {
      path: `${VFS_SERVICE_PATH}/SetupKeys`,
      body: { json: jsonBodyText },
      unwrapJsonEnvelope: true,
      successStatus: 201
    };
  }
  if (pathname === '/vfs/keys/me' && method === 'GET') {
    return {
      path: `${VFS_SERVICE_PATH}/GetMyKeys`,
      body: {},
      unwrapJsonEnvelope: true
    };
  }
  if (pathname === '/vfs/register' && method === 'POST') {
    return {
      path: `${VFS_SERVICE_PATH}/Register`,
      body: { json: jsonBodyText },
      unwrapJsonEnvelope: true
    };
  }
  if (pathname === '/vfs/vfs-sync' && method === 'GET') {
    return {
      path: `${VFS_SERVICE_PATH}/GetSync`,
      body: buildGetSyncBody(url.searchParams),
      unwrapJsonEnvelope: true
    };
  }
  if (pathname === '/vfs/crdt/vfs-sync' && method === 'GET') {
    return {
      path: `${VFS_SERVICE_PATH}/GetCrdtSync`,
      body: buildGetSyncBody(url.searchParams),
      unwrapJsonEnvelope: true
    };
  }
  if (pathname === '/vfs/crdt/push' && method === 'POST') {
    return {
      path: `${VFS_SERVICE_PATH}/PushCrdtOps`,
      body: { json: jsonBodyText },
      unwrapJsonEnvelope: true
    };
  }
  if (pathname === '/vfs/crdt/session' && method === 'POST') {
    return {
      path: `${VFS_SERVICE_PATH}/RunCrdtSession`,
      body: { json: jsonBodyText },
      unwrapJsonEnvelope: true
    };
  }
  if (pathname === '/vfs/blobs/stage' && method === 'POST') {
    return {
      path: `${VFS_SERVICE_PATH}/StageBlob`,
      body: { json: jsonBodyText },
      unwrapJsonEnvelope: true
    };
  }

  const blobStageChunksMatch = pathname.match(
    /^\/vfs\/blobs\/stage\/([^/]+)\/chunks$/
  );
  if (blobStageChunksMatch && method === 'POST') {
    return {
      path: `${VFS_SERVICE_PATH}/UploadBlobChunk`,
      body: {
        stagingId: encodedSegment(requiredMatchGroup(blobStageChunksMatch, 1)),
        json: jsonBodyText
      },
      unwrapJsonEnvelope: true
    };
  }

  const blobStageAttachMatch = pathname.match(
    /^\/vfs\/blobs\/stage\/([^/]+)\/attach$/
  );
  if (blobStageAttachMatch && method === 'POST') {
    return {
      path: `${VFS_SERVICE_PATH}/AttachBlob`,
      body: {
        stagingId: encodedSegment(requiredMatchGroup(blobStageAttachMatch, 1)),
        json: jsonBodyText
      },
      unwrapJsonEnvelope: true
    };
  }

  const blobStageAbandonMatch = pathname.match(
    /^\/vfs\/blobs\/stage\/([^/]+)\/abandon$/
  );
  if (blobStageAbandonMatch && method === 'POST') {
    return {
      path: `${VFS_SERVICE_PATH}/AbandonBlob`,
      body: {
        stagingId: encodedSegment(
          requiredMatchGroup(blobStageAbandonMatch, 1)
        ),
        json: jsonBodyText
      },
      unwrapJsonEnvelope: true
    };
  }

  const blobStageCommitMatch = pathname.match(
    /^\/vfs\/blobs\/stage\/([^/]+)\/commit$/
  );
  if (blobStageCommitMatch && method === 'POST') {
    return {
      path: `${VFS_SERVICE_PATH}/CommitBlob`,
      body: {
        stagingId: encodedSegment(requiredMatchGroup(blobStageCommitMatch, 1)),
        json: jsonBodyText
      },
      unwrapJsonEnvelope: true
    };
  }

  const blobMatch = pathname.match(/^\/vfs\/blobs\/([^/]+)$/);
  if (blobMatch && method === 'DELETE') {
    return {
      path: `${VFS_SERVICE_PATH}/DeleteBlob`,
      body: { blobId: encodedSegment(requiredMatchGroup(blobMatch, 1)) },
      unwrapJsonEnvelope: true
    };
  }
  if (blobMatch && method === 'GET') {
    return {
      path: `${VFS_SERVICE_PATH}/GetBlob`,
      body: { blobId: encodedSegment(requiredMatchGroup(blobMatch, 1)) },
      unwrapJsonEnvelope: false
    };
  }

  const rekeyMatch = pathname.match(/^\/vfs\/items\/([^/]+)\/rekey$/);
  if (rekeyMatch && method === 'POST') {
    return {
      path: `${VFS_SERVICE_PATH}/RekeyItem`,
      body: {
        itemId: encodedSegment(requiredMatchGroup(rekeyMatch, 1)),
        json: jsonBodyText
      },
      unwrapJsonEnvelope: true
    };
  }

  const itemSharesMatch = pathname.match(/^\/vfs\/items\/([^/]+)\/shares$/);
  if (itemSharesMatch && method === 'GET') {
    return {
      path: `${VFS_SHARES_SERVICE_PATH}/GetItemShares`,
      body: { itemId: encodedSegment(requiredMatchGroup(itemSharesMatch, 1)) },
      unwrapJsonEnvelope: true
    };
  }
  if (itemSharesMatch && method === 'POST') {
    return {
      path: `${VFS_SHARES_SERVICE_PATH}/CreateShare`,
      body: {
        itemId: encodedSegment(requiredMatchGroup(itemSharesMatch, 1)),
        json: jsonBodyText
      },
      unwrapJsonEnvelope: true
    };
  }

  const shareMatch = pathname.match(/^\/vfs\/shares\/([^/]+)$/);
  if (shareMatch && method === 'PATCH') {
    return {
      path: `${VFS_SHARES_SERVICE_PATH}/UpdateShare`,
      body: {
        shareId: encodedSegment(requiredMatchGroup(shareMatch, 1)),
        json: jsonBodyText
      },
      unwrapJsonEnvelope: true
    };
  }
  if (shareMatch && method === 'DELETE') {
    return {
      path: `${VFS_SHARES_SERVICE_PATH}/DeleteShare`,
      body: { shareId: encodedSegment(requiredMatchGroup(shareMatch, 1)) },
      unwrapJsonEnvelope: true
    };
  }

  const orgSharesMatch = pathname.match(/^\/vfs\/items\/([^/]+)\/org-shares$/);
  if (orgSharesMatch && method === 'POST') {
    return {
      path: `${VFS_SHARES_SERVICE_PATH}/CreateOrgShare`,
      body: {
        itemId: encodedSegment(requiredMatchGroup(orgSharesMatch, 1)),
        json: jsonBodyText
      },
      unwrapJsonEnvelope: true
    };
  }

  const orgShareMatch = pathname.match(/^\/vfs\/org-shares\/([^/]+)$/);
  if (orgShareMatch && method === 'DELETE') {
    return {
      path: `${VFS_SHARES_SERVICE_PATH}/DeleteOrgShare`,
      body: { shareId: encodedSegment(requiredMatchGroup(orgShareMatch, 1)) },
      unwrapJsonEnvelope: true
    };
  }

  return null;
}

export function mergeHeaders(
  authToken: string,
  extraHeaders?: RequestInit['headers']
): Headers {
  const merged = new Headers({ Authorization: `Bearer ${authToken}` });
  if (extraHeaders) {
    const provided = new Headers(extraHeaders);
    for (const [key, value] of provided.entries()) {
      merged.set(key, value);
    }
  }
  return merged;
}

function createJsonResponse(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' }
  });
}

function extractErrorMessage(rawText: string): string {
  if (rawText.trim().length === 0) {
    return 'Request failed';
  }

  try {
    const parsed = parseJson<unknown>(rawText);
    if (isRecord(parsed) && typeof parsed['error'] === 'string') {
      return parsed['error'];
    }
    if (isRecord(parsed) && typeof parsed['message'] === 'string') {
      return parsed['message'];
    }
  } catch {
    // Keep fallback text path.
  }

  return rawText;
}

export async function adaptConnectResponse(
  response: Response,
  mapping: ConnectRouteMapping
): Promise<Response> {
  const rawText = await response.text();
  if (!response.ok) {
    return createJsonResponse(response.status, {
      error: extractErrorMessage(rawText)
    });
  }

  let normalizedBody: unknown = {};
  if (rawText.trim().length > 0) {
    const parsedBody = parseJson<unknown>(rawText);
    normalizedBody = mapping.unwrapJsonEnvelope
      ? parseConnectJsonEnvelopeBody(parsedBody)
      : parsedBody;
  }
  if (mapping.legacyDefaults && isRecord(normalizedBody)) {
    normalizedBody = { ...mapping.legacyDefaults, ...normalizedBody };
  }

  return createJsonResponse(
    mapping.successStatus ?? response.status,
    normalizedBody
  );
}

export function resolveDirectApiPath(path: string): string {
  if (path.startsWith('/v1/')) {
    return path;
  }
  if (path.startsWith('/connect/')) {
    return `/v1${path}`;
  }
  return `/v1${path}`;
}
