import { randomUUID } from 'node:crypto';
import { Code, ConnectError, type HandlerContext } from '@connectrpc/connect';
import type { LoginRequest } from '@tearleads/shared/gen/tearleads/v1/auth_pb';
import { createJwt } from '../../../lib/jwt.js';
import { verifyPassword } from '../../../lib/passwords.js';
import { getPostgresPool } from '../../../lib/postgres.js';
import { createSession, storeRefreshToken } from '../../../lib/sessions.js';
import {
  ACCESS_TOKEN_TTL_SECONDS,
  parseAuthPayload,
  REFRESH_TOKEN_TTL_SECONDS
} from '../../../routes/auth/shared.js';
import { getClientIpFromHeaders, getJwtSecretOrThrow } from './shared.js';

export async function login(request: LoginRequest, context: HandlerContext) {
  const payload = parseAuthPayload({
    email: request.email,
    password: request.password
  });

  if (!payload) {
    throw new ConnectError(
      'email and password are required',
      Code.InvalidArgument
    );
  }

  const jwtSecret = getJwtSecretOrThrow('Failed to authenticate');

  try {
    const pool = await getPostgresPool();
    const userResult = await pool.query<{
      id: string;
      email: string;
      password_hash: string | null;
      password_salt: string | null;
      admin: boolean;
    }>(
      `SELECT u.id, u.email, u.admin, uc.password_hash, uc.password_salt
       FROM users u
       LEFT JOIN user_credentials uc ON u.id = uc.user_id
       WHERE lower(u.email) = $1
       LIMIT 1`,
      [payload.email]
    );

    const user = userResult.rows[0];
    if (!user || !user.password_hash || !user.password_salt) {
      throw new ConnectError('Invalid email or password', Code.Unauthenticated);
    }

    const passwordMatches = await verifyPassword(
      payload.password,
      user.password_salt,
      user.password_hash
    );
    if (!passwordMatches) {
      throw new ConnectError('Invalid email or password', Code.Unauthenticated);
    }

    const sessionId = randomUUID();
    const ipAddress = getClientIpFromHeaders(context.requestHeader);

    await createSession(
      sessionId,
      {
        userId: user.id,
        email: user.email,
        admin: user.admin ?? false,
        ipAddress
      },
      REFRESH_TOKEN_TTL_SECONDS
    );

    const accessToken = createJwt(
      {
        sub: user.id,
        email: user.email,
        jti: sessionId
      },
      jwtSecret,
      ACCESS_TOKEN_TTL_SECONDS
    );

    const refreshTokenId = randomUUID();
    await storeRefreshToken(
      refreshTokenId,
      { sessionId, userId: user.id },
      REFRESH_TOKEN_TTL_SECONDS
    );

    const refreshToken = createJwt(
      { sub: user.id, jti: refreshTokenId, sid: sessionId, type: 'refresh' },
      jwtSecret,
      REFRESH_TOKEN_TTL_SECONDS
    );

    return {
      accessToken,
      refreshToken,
      tokenType: 'Bearer',
      expiresIn: ACCESS_TOKEN_TTL_SECONDS,
      refreshExpiresIn: REFRESH_TOKEN_TTL_SECONDS,
      user: {
        id: user.id,
        email: user.email
      }
    };
  } catch (error) {
    if (error instanceof ConnectError) {
      throw error;
    }
    throw new ConnectError('Failed to authenticate', Code.Internal);
  }
}
