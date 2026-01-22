import { randomUUID } from 'node:crypto';
import { getAccessTokenTtlSeconds } from '../lib/authConfig.js';
import { createJwt } from '../lib/jwt.js';
import { createSession } from '../lib/sessions.js';

type AuthUser = {
  id: string;
  email: string;
};

const DEFAULT_USER: AuthUser = {
  id: 'user-1',
  email: 'user@example.com'
};

export async function createAuthHeader(
  user: AuthUser = DEFAULT_USER
): Promise<string> {
  const sessionId = randomUUID();
  await createSession(sessionId, { userId: user.id, email: user.email });
  const token = createJwt(
    { sub: user.id, email: user.email, jti: sessionId },
    process.env['JWT_SECRET'] ?? 'test-secret',
    getAccessTokenTtlSeconds()
  );
  return `Bearer ${token}`;
}
