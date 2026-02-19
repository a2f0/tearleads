import type { VfsKeySetupRequest, VfsUserKeysResponse } from '@tearleads/shared';
import { splitPublicKey } from '@tearleads/shared';
import {
  createVfsOnboardingKeyBundle,
  decryptVfsPrivateKeyBundle
} from './keyOnboarding';

export interface VfsPublicKey {
  x25519PublicKey: string;
  mlKemPublicKey: string;
}

function isNotFoundError(error: unknown): boolean {
  return error instanceof Error && error.message.includes('404');
}

export interface VfsOnboardingApiClient {
  getMyKeys(): Promise<VfsUserKeysResponse>;
  setupKeys(payload: VfsKeySetupRequest): Promise<{ created: boolean }>;
}

export interface EnsureVfsOnboardingKeysInput {
  password: string;
  apiClient: VfsOnboardingApiClient;
}

export interface EnsureVfsOnboardingKeysResult {
  created: boolean;
  publicKey: VfsPublicKey;
  serverKeys: VfsUserKeysResponse;
}

function toPublicKey(response: VfsUserKeysResponse): VfsPublicKey {
  const parsed = splitPublicKey(response.publicEncryptionKey);
  return {
    x25519PublicKey: parsed.x25519PublicKey,
    mlKemPublicKey: parsed.mlKemPublicKey
  };
}

export async function ensureVfsOnboardingKeys(
  input: EnsureVfsOnboardingKeysInput
): Promise<EnsureVfsOnboardingKeysResult> {
  const password = input.password.trim();
  if (password.length === 0) {
    throw new Error('password is required');
  }

  try {
    const existing = await input.apiClient.getMyKeys();
    return {
      created: false,
      publicKey: toPublicKey(existing),
      serverKeys: existing
    };
  } catch (error) {
    if (!isNotFoundError(error)) {
      throw error;
    }
  }

  const onboarding = await createVfsOnboardingKeyBundle(password);
  await input.apiClient.setupKeys(onboarding.setupPayload);
  const created = await input.apiClient.getMyKeys();
  return {
    created: true,
    publicKey: toPublicKey(created),
    serverKeys: created
  };
}

export interface LoadVfsKeyPairFromServerInput {
  password: string;
  serverKeys: VfsUserKeysResponse;
}

export async function loadVfsKeyPairFromServer(
  input: LoadVfsKeyPairFromServerInput
) {
  const encryptedPrivateKeys = input.serverKeys.encryptedPrivateKeys;
  const argon2Salt = input.serverKeys.argon2Salt;
  if (!encryptedPrivateKeys || !argon2Salt) {
    throw new Error('encrypted private keys are not available');
  }

  return decryptVfsPrivateKeyBundle(
    input.password,
    encryptedPrivateKeys,
    argon2Salt,
    splitPublicKey(input.serverKeys.publicEncryptionKey)
  );
}
