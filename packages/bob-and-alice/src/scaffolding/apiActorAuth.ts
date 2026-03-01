import type { JsonApiActor } from './setupBobNotesShareForAlice.js';

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

interface AuthTokens {
  accessToken: string;
  userId: string;
  userEmail: string;
}

export interface AuthenticatedApiActor extends JsonApiActor {
  userId: string;
  userEmail: string;
}

export interface LoginApiActorInput {
  baseUrl: string;
  email: string;
  password: string;
}

async function readJsonResponse(response: Response): Promise<unknown> {
  const text = await response.text();
  if (text.trim().length === 0) {
    return null;
  }

  try {
    return JSON.parse(text);
  } catch (error) {
    throw new Error(
      `Expected JSON response but received invalid JSON: ${String(error)}`
    );
  }
}

function parseAuthTokens(value: unknown): AuthTokens {
  if (!isRecord(value) || !isRecord(value['user'])) {
    throw new Error('Unexpected auth response shape');
  }

  const accessToken = value['accessToken'];
  const userId = value['user']['id'];
  const userEmail = value['user']['email'];

  if (
    typeof accessToken !== 'string' ||
    typeof userId !== 'string' ||
    typeof userEmail !== 'string'
  ) {
    throw new Error('Auth response is missing required fields');
  }

  return {
    accessToken,
    userId,
    userEmail
  };
}

export async function loginApiActor(
  input: LoginApiActorInput
): Promise<AuthenticatedApiActor> {
  const loginResponse = await fetch(`${input.baseUrl}/auth/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      email: input.email,
      password: input.password
    })
  });

  const loginBody = await readJsonResponse(loginResponse);
  if (!loginResponse.ok) {
    throw new Error(
      `Failed to login ${input.email}: ${String(loginResponse.status)} ${JSON.stringify(loginBody)}`
    );
  }

  const tokens = parseAuthTokens(loginBody);

  const fetchJson: JsonApiActor['fetchJson'] = async (
    path: string,
    init?: RequestInit
  ): Promise<unknown> => {
    const response = await fetch(`${input.baseUrl}${path}`, {
      ...init,
      headers: {
        Authorization: `Bearer ${tokens.accessToken}`,
        ...(init?.headers ?? {})
      }
    });

    const body = await readJsonResponse(response);
    if (!response.ok) {
      throw new Error(
        `API request failed: ${path} ${String(response.status)} ${JSON.stringify(body)}`
      );
    }
    return body;
  };

  return {
    userId: tokens.userId,
    userEmail: tokens.userEmail,
    fetchJson
  };
}

export async function ensureVfsKeysExist(input: {
  actor: JsonApiActor;
  keyPrefix: string;
}): Promise<void> {
  const response = await input.actor.fetchJson('/vfs/keys', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      publicEncryptionKey: `${input.keyPrefix}-public-encryption-key`,
      publicSigningKey: `${input.keyPrefix}-public-signing-key`,
      encryptedPrivateKeys: `${input.keyPrefix}-encrypted-private-keys`,
      argon2Salt: `${input.keyPrefix}-argon2-salt`
    })
  }).catch((error: unknown) => {
    const message =
      error instanceof Error ? error.message : `Unknown error: ${String(error)}`;

    if (message.includes('409')) {
      return null;
    }
    throw error;
  });

  if (response !== null && response !== undefined && !isRecord(response)) {
    throw new Error('Unexpected /vfs/keys response');
  }
}
