import { randomUUID } from 'node:crypto';
import { isRecord } from '@rapid/shared';
import {
  type Request,
  type Response,
  Router,
  type Router as RouterType
} from 'express';
import {
  getAccessTokenTtlSeconds,
  getRefreshTokenTtlSeconds
} from '../lib/authConfig.js';
import { createJwt, verifyRefreshJwt } from '../lib/jwt.js';
import { verifyPassword } from '../lib/passwords.js';
import { getPostgresPool } from '../lib/postgres.js';
import { getClientIp } from '../lib/request-utils.js';
import {
  createSession,
  deleteRefreshToken,
  deleteSession,
  getRefreshToken,
  getSession,
  getSessionsByUserId,
  rotateTokensAtomically,
  storeRefreshToken
} from '../lib/sessions.js';

const router: RouterType = Router();
const ACCESS_TOKEN_TTL_SECONDS = getAccessTokenTtlSeconds();
const REFRESH_TOKEN_TTL_SECONDS = getRefreshTokenTtlSeconds();

type LoginPayload = {
  email: string;
  password: string;
};

function parseLoginPayload(body: unknown): LoginPayload | null {
  if (!isRecord(body)) {
    return null;
  }
  const emailValue = body['email'];
  const passwordValue = body['password'];
  if (typeof emailValue !== 'string' || typeof passwordValue !== 'string') {
    return null;
  }
  const email = emailValue.trim().toLowerCase();
  const password = passwordValue.trim();
  if (!email || !password) {
    return null;
  }
  return { email, password };
}

/**
 * @openapi
 * /auth/login:
 *   post:
 *     summary: Login with email and password
 *     description: Validates credentials and returns a bearer access token.
 *     tags:
 *       - Auth
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             properties:
 *               email:
 *                 type: string
 *                 format: email
 *               password:
 *                 type: string
 *             required:
 *               - email
 *               - password
 *     responses:
 *       200:
 *         description: Authenticated response
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 accessToken:
 *                   type: string
 *                 refreshToken:
 *                   type: string
 *                 tokenType:
 *                   type: string
 *                 expiresIn:
 *                   type: integer
 *                 refreshExpiresIn:
 *                   type: integer
 *                 user:
 *                   type: object
 *                   properties:
 *                     id:
 *                       type: string
 *                     email:
 *                       type: string
 *       400:
 *         description: Invalid request payload
 *       401:
 *         description: Invalid credentials
 *       500:
 *         description: Server error
 */
router.post('/login', async (req: Request, res: Response) => {
  const payload = parseLoginPayload(req.body);
  if (!payload) {
    res.status(400).json({ error: 'email and password are required' });
    return;
  }

  const jwtSecret = process.env['JWT_SECRET'];
  if (!jwtSecret) {
    console.error('Authentication setup error: JWT_SECRET is not configured.');
    res.status(500).json({ error: 'Failed to authenticate' });
    return;
  }

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
      res.status(401).json({ error: 'Invalid email or password' });
      return;
    }

    const passwordMatches = await verifyPassword(
      payload.password,
      user.password_salt,
      user.password_hash
    );
    if (!passwordMatches) {
      res.status(401).json({ error: 'Invalid email or password' });
      return;
    }

    const sessionId = randomUUID();
    const ipAddress = getClientIp(req);
    await createSession(
      sessionId,
      {
        userId: user.id,
        email: user.email,
        admin: user.admin ?? false,
        ipAddress
      },
      ACCESS_TOKEN_TTL_SECONDS
    );

    const accessToken = createJwt(
      { sub: user.id, email: user.email, jti: sessionId },
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

    res.json({
      accessToken,
      refreshToken,
      tokenType: 'Bearer',
      expiresIn: ACCESS_TOKEN_TTL_SECONDS,
      refreshExpiresIn: REFRESH_TOKEN_TTL_SECONDS,
      user: {
        id: user.id,
        email: user.email
      }
    });
  } catch (error) {
    console.error('Login failed:', error);
    res.status(500).json({ error: 'Failed to authenticate' });
  }
});

type RefreshPayload = {
  refreshToken: string;
};

function parseRefreshPayload(body: unknown): RefreshPayload | null {
  if (!isRecord(body)) {
    return null;
  }
  const refreshToken = body['refreshToken'];
  if (typeof refreshToken !== 'string' || !refreshToken.trim()) {
    return null;
  }
  return { refreshToken: refreshToken.trim() };
}

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
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 accessToken:
 *                   type: string
 *                 refreshToken:
 *                   type: string
 *                 tokenType:
 *                   type: string
 *                 expiresIn:
 *                   type: integer
 *                 refreshExpiresIn:
 *                   type: integer
 *                 user:
 *                   type: object
 *                   properties:
 *                     id:
 *                       type: string
 *                     email:
 *                       type: string
 *       400:
 *         description: Invalid request payload
 *       401:
 *         description: Invalid or expired refresh token
 *       500:
 *         description: Server error
 */
router.post('/refresh', async (req: Request, res: Response) => {
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
      sessionTtlSeconds: ACCESS_TOKEN_TTL_SECONDS,
      refreshTokenTtlSeconds: REFRESH_TOKEN_TTL_SECONDS
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
});

/**
 * @openapi
 * /auth/sessions:
 *   get:
 *     summary: List all active sessions for the current user
 *     description: Returns all sessions with metadata. Requires authentication.
 *     tags:
 *       - Auth
 *     security:
 *       - bearerAuth: []
 *     responses:
 *       200:
 *         description: List of sessions
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 sessions:
 *                   type: array
 *                   items:
 *                     type: object
 *                     properties:
 *                       id:
 *                         type: string
 *                       createdAt:
 *                         type: string
 *                         format: date-time
 *                       lastActiveAt:
 *                         type: string
 *                         format: date-time
 *                       ipAddress:
 *                         type: string
 *                       isCurrent:
 *                         type: boolean
 *       401:
 *         description: Unauthorized
 *       500:
 *         description: Server error
 */
router.get('/sessions', async (req: Request, res: Response) => {
  const claims = req.authClaims;
  if (!claims) {
    res.status(401).json({ error: 'Unauthorized' });
    return;
  }

  try {
    const sessions = await getSessionsByUserId(claims.sub);
    const response = sessions.map((session) => ({
      id: session.id,
      createdAt: session.createdAt,
      lastActiveAt: session.lastActiveAt,
      ipAddress: session.ipAddress,
      isCurrent: session.id === claims.jti,
      isAdmin: session.admin
    }));

    res.json({ sessions: response });
  } catch (error) {
    console.error('Failed to list sessions:', error);
    res.status(500).json({ error: 'Failed to list sessions' });
  }
});

/**
 * @openapi
 * /auth/sessions/{sessionId}:
 *   delete:
 *     summary: Delete a session
 *     description: Revokes a session. Cannot delete the current session.
 *     tags:
 *       - Auth
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: sessionId
 *         required: true
 *         schema:
 *           type: string
 *     responses:
 *       200:
 *         description: Session deleted
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 deleted:
 *                   type: boolean
 *       401:
 *         description: Unauthorized
 *       403:
 *         description: Cannot delete current session
 *       404:
 *         description: Session not found
 *       500:
 *         description: Server error
 */
router.delete('/sessions/:sessionId', async (req: Request, res: Response) => {
  const claims = req.authClaims;
  if (!claims) {
    res.status(401).json({ error: 'Unauthorized' });
    return;
  }

  const { sessionId } = req.params;
  if (!sessionId) {
    res.status(400).json({ error: 'Session ID is required' });
    return;
  }

  if (sessionId === claims.jti) {
    res.status(403).json({ error: 'Cannot delete current session' });
    return;
  }

  try {
    const deleted = await deleteSession(sessionId, claims.sub);
    if (!deleted) {
      res.status(404).json({ error: 'Session not found' });
      return;
    }

    res.json({ deleted: true });
  } catch (error) {
    console.error('Failed to delete session:', error);
    res.status(500).json({ error: 'Failed to delete session' });
  }
});

export { router as authRouter };
