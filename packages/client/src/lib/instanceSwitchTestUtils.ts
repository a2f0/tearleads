import type { VfsCrdtSyncResponse, VfsSyncResponse } from '@tearleads/shared';
import {
  combinePublicKey,
  createConnectJsonPostInit,
  generateKeyPair,
  normalizeVfsCrdtSyncConnectPayload,
  normalizeVfsSyncConnectPayload,
  parseConnectJsonEnvelopeBody,
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

async function fetchVfsConnectJson(input: {
  actor: JsonApiActor;
  methodName: 'GetSync';
  requestBody?: Record<string, unknown>;
}): Promise<VfsSyncResponse>;
async function fetchVfsConnectJson(input: {
  actor: JsonApiActor;
  methodName: 'GetCrdtSync';
  requestBody?: Record<string, unknown>;
}): Promise<VfsCrdtSyncResponse>;
async function fetchVfsConnectJson(input: {
  actor: JsonApiActor;
  methodName: 'GetSync' | 'GetCrdtSync';
  requestBody?: Record<string, unknown>;
}): Promise<VfsSyncResponse | VfsCrdtSyncResponse> {
  const responseBody = await input.actor.fetchJson(
    `${VFS_V2_CONNECT_BASE_PATH}/${input.methodName}`,
    createConnectJsonPostInit(input.requestBody ?? {})
  );
  const parsedPayload = parseConnectJsonEnvelopeBody(responseBody);
  if (input.methodName === 'GetSync') {
    return normalizeVfsSyncConnectPayload(parsedPayload);
  }
  return normalizeVfsCrdtSyncConnectPayload(parsedPayload);
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
      return fetchVfsConnectJson({
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
      return fetchVfsConnectJson({
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
