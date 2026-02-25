import { randomUUID } from 'node:crypto';
import type { Request, Response, Router as RouterType } from 'express';
import { createJwt } from '../../lib/jwt.js';
import { verifyPassword } from '../../lib/passwords.js';
import { getPool } from '../../lib/postgres.js';
import { getClientIp } from '../../lib/requestUtils.js';
import { createSession, storeRefreshToken } from '../../lib/sessions.js';
import {
  ACCESS_TOKEN_TTL_SECONDS,
  parseAuthPayload,
  REFRESH_TOKEN_TTL_SECONDS
} from './shared.js';

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
 *               app:
 *                 type: string
 *                 description: Optional app identifier for white-label apps
 *             required:
 *               - email
 *               - password
 *     responses:
 *       200:
 *         description: Authenticated response
 *       400:
 *         description: Invalid request payload
 *       401:
 *         description: Invalid credentials
 *       500:
 *         description: Server error
 */
const postLoginHandler = async (req: Request, res: Response): Promise<void> => {
  const payload = parseAuthPayload(req.body);
  if (!payload) {
    res.status(400).json({ error: 'email and password are required' });
    return;
  }

  // Optional app identifier for white-label apps
  const appId =
    typeof req.body?.app === 'string' && req.body.app.length > 0
      ? req.body.app
      : undefined;

  const jwtSecret = process.env['JWT_SECRET'];
  if (!jwtSecret) {
    console.error('Authentication setup error: JWT_SECRET is not configured.');
    res.status(500).json({ error: 'Failed to authenticate' });
    return;
  }

  try {
    const pool = await getPool('read');
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
      REFRESH_TOKEN_TTL_SECONDS
    );

    const accessToken = createJwt(
      {
        sub: user.id,
        email: user.email,
        jti: sessionId,
        ...(appId && { app: appId })
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
};

export function registerPostLoginRoute(authRouter: RouterType): void {
  authRouter.post('/login', postLoginHandler);
}
