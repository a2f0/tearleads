import { randomUUID } from 'node:crypto';
import { Code, ConnectError, type HandlerContext } from '@connectrpc/connect';
import type { RefreshTokenRequest } from '@tearleads/shared/gen/tearleads/v1/auth_pb';
import { createJwt, verifyRefreshJwt } from '../../../lib/jwt.js';
import {
  deleteRefreshToken,
  getRefreshToken,
  getSession,
  rotateTokensAtomically
} from '../../../lib/sessions.js';
import {
  ACCESS_TOKEN_TTL_SECONDS,
  parseRefreshPayload,
  REFRESH_TOKEN_TTL_SECONDS
} from '../../../routes/auth/shared.js';
import { getClientIpFromHeaders, getJwtSecretOrThrow } from './shared.js';

export async function refreshToken(
  request: RefreshTokenRequest,
  context: HandlerContext
) {
  const payload = parseRefreshPayload({
    refreshToken: request.refreshToken
  });
  if (!payload) {
    throw new ConnectError('refreshToken is required', Code.InvalidArgument);
  }

  const jwtSecret = getJwtSecretOrThrow('Failed to refresh token');

  try {
    const claims = verifyRefreshJwt(payload.refreshToken, jwtSecret);
    if (!claims) {
      throw new ConnectError('Invalid refresh token', Code.Unauthenticated);
    }

    const refreshTokenData = await getRefreshToken(claims.jti);
    if (!refreshTokenData) {
      throw new ConnectError(
        'Refresh token has been revoked',
        Code.Unauthenticated
      );
    }

    const session = await getSession(claims.sid);
    if (!session || session.userId !== claims.sub) {
      await deleteRefreshToken(claims.jti);
      throw new ConnectError('Session no longer valid', Code.Unauthenticated);
    }

    const newSessionId = randomUUID();
    const newRefreshTokenId = randomUUID();
    const ipAddress = getClientIpFromHeaders(context.requestHeader);

    await rotateTokensAtomically({
      oldRefreshTokenId: claims.jti,
      oldSessionId: claims.sid,
      newSessionId,
      newRefreshTokenId,
      sessionData: {
        userId: session.userId,
        email: session.email,
        admin: session.admin,
        ipAddress
      },
      sessionTtlSeconds: REFRESH_TOKEN_TTL_SECONDS,
      refreshTokenTtlSeconds: REFRESH_TOKEN_TTL_SECONDS,
      originalCreatedAt: session.createdAt
    });

    const accessToken = createJwt(
      { sub: session.userId, email: session.email, jti: newSessionId },
      jwtSecret,
      ACCESS_TOKEN_TTL_SECONDS
    );

    const refreshTokenJwt = createJwt(
      {
        sub: session.userId,
        jti: newRefreshTokenId,
        sid: newSessionId,
        type: 'refresh'
      },
      jwtSecret,
      REFRESH_TOKEN_TTL_SECONDS
    );

    return {
      accessToken,
      refreshToken: refreshTokenJwt,
      tokenType: 'Bearer',
      expiresIn: ACCESS_TOKEN_TTL_SECONDS,
      refreshExpiresIn: REFRESH_TOKEN_TTL_SECONDS,
      user: {
        id: session.userId,
        email: session.email
      }
    };
  } catch (error) {
    if (error instanceof ConnectError) {
      throw error;
    }
    throw new ConnectError('Failed to refresh token', Code.Internal);
  }
}
