import type { VfsCrdtSyncResponse, VfsSyncResponse } from '@tearleads/shared';
import {
  combinePublicKey,
  createConnectJsonPostInit,
  generateKeyPair,
  parseConnectJsonEnvelopeBody,
  parseConnectJsonString,
  serializePublicKey,
  VFS_V2_CONNECT_BASE_PATH
} from '@tearleads/shared';
import { vi } from 'vitest';
import { api } from '@/lib/api';
import { readStoredAuth } from '@/lib/authStorage';

interface SeedUserKeysInput {
  client: {
    query: (text: string, params?: readonly unknown[]) => Promise<unknown>;
  };
  bobUserId: string;
  aliceUserId: string;
}

interface JsonApiActor {
  fetchJson(path: string, init?: RequestInit): Promise<unknown>;
}

export function toBase64(value: string): string {
  return Buffer.from(value, 'utf8').toString('base64');
}

export function buildPublicEncryptionKey(): string {
  const keyPair = generateKeyPair();
  return combinePublicKey(
    serializePublicKey({
      x25519PublicKey: keyPair.x25519PublicKey,
      mlKemPublicKey: keyPair.mlKemPublicKey
    })
  );
}

export async function seedUserKeys(input: SeedUserKeysInput): Promise<void> {
  const bobPublicKey = buildPublicEncryptionKey();
  const alicePublicKey = buildPublicEncryptionKey();

  await input.client.query(
    `INSERT INTO user_keys (
       user_id,
       public_encryption_key,
       public_signing_key,
       encrypted_private_keys,
       argon2_salt,
       created_at
     )
     VALUES ($1, $2, $3, $4, $5, NOW())
     ON CONFLICT (user_id) DO UPDATE SET
       public_encryption_key = EXCLUDED.public_encryption_key`,
    [
      input.bobUserId,
      bobPublicKey,
      'seeded-signing-key-bob',
      'seeded-private-keys-bob',
      'seeded-argon2-salt-bob'
    ]
  );

  await input.client.query(
    `INSERT INTO user_keys (
       user_id,
       public_encryption_key,
       public_signing_key,
       encrypted_private_keys,
       argon2_salt,
       created_at
     )
     VALUES ($1, $2, $3, $4, $5, NOW())
     ON CONFLICT (user_id) DO UPDATE SET
       public_encryption_key = EXCLUDED.public_encryption_key`,
    [
      input.aliceUserId,
      alicePublicKey,
      'seeded-signing-key-alice',
      'seeded-private-keys-alice',
      'seeded-argon2-salt-alice'
    ]
  );
}

async function readJsonResponse(response: Response): Promise<unknown> {
  const raw = await response.text();
  if (raw.trim().length === 0) {
    return null;
  }
  return JSON.parse(raw);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function normalizeLastReconciledWriteIds(
  value: unknown
): Record<string, number> {
  if (!isRecord(value)) {
    return {};
  }

  const normalized: Record<string, number> = {};
  for (const [replicaId, writeId] of Object.entries(value)) {
    const trimmedReplicaId = replicaId.trim();
    if (trimmedReplicaId.length === 0) {
      continue;
    }
    if (
      typeof writeId !== 'number' ||
      !Number.isInteger(writeId) ||
      !Number.isSafeInteger(writeId) ||
      writeId < 1
    ) {
      continue;
    }
    normalized[trimmedReplicaId] = writeId;
  }

  return normalized;
}

function normalizeSyncPagePayload(
  payload: unknown,
  methodName: string
): unknown {
  if (methodName !== 'GetSync' && methodName !== 'GetCrdtSync') {
    return payload;
  }

  const recordPayload = isRecord(payload) ? payload : {};
  const rawItems = recordPayload['items'];
  const rawNextCursor = recordPayload['nextCursor'];
  const rawHasMore = recordPayload['hasMore'];

  const items = Array.isArray(rawItems) ? rawItems : [];
  const nextCursor =
    typeof rawNextCursor === 'string' && rawNextCursor.trim().length > 0
      ? rawNextCursor
      : null;
  const hasMore = rawHasMore === true;

  if (methodName === 'GetSync') {
    return {
      ...recordPayload,
      items,
      nextCursor,
      hasMore
    };
  }

  return {
    ...recordPayload,
    items,
    nextCursor,
    hasMore,
    lastReconciledWriteIds: normalizeLastReconciledWriteIds(
      recordPayload['lastReconciledWriteIds']
    )
  };
}

function toParsedJson<T>(payload: unknown): T {
  if (typeof payload === 'string') {
    return parseConnectJsonString<T>(payload);
  }
  if (payload === null || payload === undefined) {
    return parseConnectJsonString<T>('{}');
  }
  try {
    return parseConnectJsonString<T>(JSON.stringify(payload));
  } catch {
    return parseConnectJsonString<T>('{}');
  }
}

async function fetchVfsConnectJson<T>(input: {
  actor: JsonApiActor;
  methodName: string;
  requestBody?: Record<string, unknown>;
}): Promise<T> {
  const responseBody = await input.actor.fetchJson(
    `${VFS_V2_CONNECT_BASE_PATH}/${input.methodName}`,
    createConnectJsonPostInit(input.requestBody ?? {})
  );
  const parsedPayload = parseConnectJsonEnvelopeBody(responseBody);
  const normalizedPayload = normalizeSyncPagePayload(
    parsedPayload,
    input.methodName
  );
  return toParsedJson<T>(normalizedPayload);
}

export function createTokenActor(input: {
  baseUrl: string;
  resolveToken: () => string | null;
}): JsonApiActor {
  return {
    async fetchJson(path: string, init?: RequestInit): Promise<unknown> {
      const token = input.resolveToken();
      if (!token) {
        throw new Error('Missing auth token');
      }

      const headers = new Headers(init?.headers);
      headers.set('Authorization', `Bearer ${token}`);
      if (init?.body && !headers.has('Content-Type')) {
        headers.set('Content-Type', 'application/json');
      }

      const response = await fetch(`${input.baseUrl}${path}`, {
        ...init,
        headers
      });
      const body = await readJsonResponse(response);
      if (!response.ok) {
        throw new Error(
          `Request failed: ${path} ${String(response.status)} ${JSON.stringify(body)}`
        );
      }
      return body;
    }
  };
}

export function installConnectSyncMocks(input: { baseUrl: string }): void {
  vi.spyOn(api.vfs, 'getSync').mockImplementation(
    async (cursor?: string, limit?: number): Promise<VfsSyncResponse> => {
      const actor = createTokenActor({
        baseUrl: input.baseUrl,
        resolveToken: () => readStoredAuth().token
      });
      return fetchVfsConnectJson<VfsSyncResponse>({
        actor,
        methodName: 'GetSync',
        requestBody: {
          ...(cursor ? { cursor } : {}),
          ...(typeof limit === 'number' ? { limit } : {})
        }
      });
    }
  );

  vi.spyOn(api.vfs, 'getCrdtSync').mockImplementation(
    async (cursor?: string, limit?: number): Promise<VfsCrdtSyncResponse> => {
      const actor = createTokenActor({
        baseUrl: input.baseUrl,
        resolveToken: () => readStoredAuth().token
      });
      return fetchVfsConnectJson<VfsCrdtSyncResponse>({
        actor,
        methodName: 'GetCrdtSync',
        requestBody: {
          ...(cursor ? { cursor } : {}),
          ...(typeof limit === 'number' ? { limit } : {})
        }
      });
    }
  );
}
