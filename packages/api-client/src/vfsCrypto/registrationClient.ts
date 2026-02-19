import {
  combineEncapsulation,
  deserializePublicKey,
  type VfsObjectType,
  type VfsRegisterResponse,
  wrapKeyForRecipient
} from '@tearleads/shared';
import { api } from '../apiClient';
import {
  ensureVfsOnboardingKeys,
  type VfsOnboardingApiClient
} from './onboardingClient';

export interface RegisterVfsItemWithOnboardingInput {
  password: string;
  id: string;
  objectType: VfsObjectType;
  apiClient: VfsOnboardingApiClient & {
    register(data: {
      id: string;
      objectType: VfsObjectType;
      encryptedSessionKey: string;
    }): Promise<VfsRegisterResponse>;
  };
  sessionKey?: Uint8Array;
}

export interface RegisterVfsItemWithOnboardingResult {
  sessionKey: Uint8Array;
  registerResponse: VfsRegisterResponse;
  createdKeys: boolean;
}

function createSessionKey(): Uint8Array {
  return crypto.getRandomValues(new Uint8Array(32));
}

export async function registerVfsItemWithOnboarding(
  input: RegisterVfsItemWithOnboardingInput
): Promise<RegisterVfsItemWithOnboardingResult> {
  const keyResult = await ensureVfsOnboardingKeys({
    password: input.password,
    apiClient: input.apiClient
  });

  const sessionKey = input.sessionKey ?? createSessionKey();
  const recipientPublicKey = deserializePublicKey(keyResult.publicKey);
  const wrappedSessionKey = combineEncapsulation(
    wrapKeyForRecipient(sessionKey, recipientPublicKey)
  );

  const registerResponse = await input.apiClient.register({
    id: input.id,
    objectType: input.objectType,
    encryptedSessionKey: wrappedSessionKey
  });

  return {
    sessionKey,
    registerResponse,
    createdKeys: keyResult.created
  };
}

export async function registerVfsItemWithApiOnboarding(input: {
  password: string;
  id: string;
  objectType: VfsObjectType;
  sessionKey?: Uint8Array;
}): Promise<RegisterVfsItemWithOnboardingResult> {
  return registerVfsItemWithOnboarding({
    ...input,
    apiClient: api.vfs
  });
}
