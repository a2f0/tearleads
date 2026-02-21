import { randomUUID } from 'node:crypto';
import type { Request, Response, Router as RouterType } from 'express';
import { createJwt, verifyRefreshJwt } from '../../lib/jwt.js';
import { getClientIp } from '../../lib/requestUtils.js';
import {
  deleteRefreshToken,
  getRefreshToken,
  getSession,
  rotateTokensAtomically
} from '../../lib/sessions.js';
import {
  ACCESS_TOKEN_TTL_SECONDS,
  parseRefreshPayload,
  REFRESH_TOKEN_TTL_SECONDS
} from './shared.js';

/**
 * @openapi
 * /auth/refresh:
 *   post:
 *     summary: Refresh access token
 *     description: Exchange a valid refresh token for new access and refresh tokens (rotation).
 *     tags:
 *       - Auth
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             properties:
 *               refreshToken:
 *                 type: string
 *             required:
 *               - refreshToken
 *     responses:
 *       200:
 *         description: New tokens issued
 *       400:
 *         description: Invalid request payload
 *       401:
 *         description: Invalid or expired refresh token
 *       500:
 *         description: Server error
 */
const postRefreshHandler = async (
  req: Request,
  res: Response
): Promise<void> => {
  const payload = parseRefreshPayload(req.body);
  if (!payload) {
    res.status(400).json({ error: 'refreshToken is required' });
    return;
  }

  const jwtSecret = process.env['JWT_SECRET'];
  if (!jwtSecret) {
    console.error('Authentication setup error: JWT_SECRET is not configured.');
    res.status(500).json({ error: 'Failed to refresh token' });
    return;
  }

  try {
    const claims = verifyRefreshJwt(payload.refreshToken, jwtSecret);
    if (!claims) {
      res.status(401).json({ error: 'Invalid refresh token' });
      return;
    }

    const refreshTokenData = await getRefreshToken(claims.jti);
    if (!refreshTokenData) {
      res.status(401).json({ error: 'Refresh token has been revoked' });
      return;
    }

    const session = await getSession(claims.sid);
    if (!session || session.userId !== claims.sub) {
      await deleteRefreshToken(claims.jti);
      res.status(401).json({ error: 'Session no longer valid' });
      return;
    }

    const newSessionId = randomUUID();
    const newRefreshTokenId = randomUUID();
    const ipAddress = getClientIp(req);

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

    const refreshToken = createJwt(
      {
        sub: session.userId,
        jti: newRefreshTokenId,
        sid: newSessionId,
        type: 'refresh'
      },
      jwtSecret,
      REFRESH_TOKEN_TTL_SECONDS
    );

    res.json({
      accessToken,
      refreshToken,
      tokenType: 'Bearer',
      expiresIn: ACCESS_TOKEN_TTL_SECONDS,
      refreshExpiresIn: REFRESH_TOKEN_TTL_SECONDS,
      user: {
        id: session.userId,
        email: session.email
      }
    });
  } catch (error) {
    console.error('Token refresh failed:', error);
    res.status(500).json({ error: 'Failed to refresh token' });
  }
};

export function registerPostRefreshRoute(authRouter: RouterType): void {
  authRouter.post('/refresh', postRefreshHandler);
}
