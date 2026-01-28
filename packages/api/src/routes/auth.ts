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
import { hashPassword, verifyPassword } from '../lib/passwords.js';
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
      REFRESH_TOKEN_TTL_SECONDS
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

type RegisterPayload = {
  email: string;
  password: string;
};

const MIN_PASSWORD_LENGTH = 8;

function parseRegisterPayload(body: unknown): RegisterPayload | null {
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

function getAllowedEmailDomains(): string[] {
  return (process.env['SMTP_RECIPIENT_DOMAINS'] ?? '')
    .split(',')
    .map((d) => d.trim().toLowerCase())
    .filter((d) => d.length > 0);
}

function isEmailDomainAllowed(email: string): boolean {
  const allowedDomains = getAllowedEmailDomains();
  if (allowedDomains.length === 0) {
    // If no domains configured, allow any
    return true;
  }
  const emailDomain = email.split('@')[1]?.toLowerCase();
  if (!emailDomain) {
    return false;
  }
  return allowedDomains.includes(emailDomain);
}

/**
 * @openapi
 * /auth/register:
 *   post:
 *     summary: Register a new user
 *     description: Creates a new user account and returns access tokens for immediate login.
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
 *                 minLength: 8
 *             required:
 *               - email
 *               - password
 *     responses:
 *       200:
 *         description: Registration successful, user logged in
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
 *         description: Invalid request payload or email domain not allowed
 *       409:
 *         description: Email already registered
 *       500:
 *         description: Server error
 */
router.post('/register', async (req: Request, res: Response) => {
  const payload = parseRegisterPayload(req.body);
  if (!payload) {
    res.status(400).json({ error: 'email and password are required' });
    return;
  }

  // Validate email format
  const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
  if (!emailRegex.test(payload.email)) {
    res.status(400).json({ error: 'Invalid email format' });
    return;
  }

  // Validate email domain
  if (!isEmailDomainAllowed(payload.email)) {
    const allowedDomains = getAllowedEmailDomains();
    res.status(400).json({
      error: `Email domain not allowed. Allowed domains: ${allowedDomains.join(', ')}`
    });
    return;
  }

  // Validate password length
  if (payload.password.length < MIN_PASSWORD_LENGTH) {
    res.status(400).json({
      error: `Password must be at least ${MIN_PASSWORD_LENGTH} characters`
    });
    return;
  }

  const jwtSecret = process.env['JWT_SECRET'];
  if (!jwtSecret) {
    console.error('Authentication setup error: JWT_SECRET is not configured.');
    res.status(500).json({ error: 'Failed to register' });
    return;
  }

  try {
    const pool = await getPostgresPool();

    // Check if email already exists
    const existingUser = await pool.query<{ id: string }>(
      `SELECT id FROM users WHERE lower(email) = $1 LIMIT 1`,
      [payload.email]
    );
    if (existingUser.rows[0]) {
      res.status(409).json({ error: 'Email already registered' });
      return;
    }

    // Hash password
    const { salt, hash } = await hashPassword(payload.password);

    // Create user and credentials in a transaction
    const client = await pool.connect();
    try {
      await client.query('BEGIN');

      const userId = randomUUID();
      const now = new Date().toISOString();

      // Insert user
      await client.query(
        `INSERT INTO users (id, email, email_confirmed, admin, created_at, updated_at)
         VALUES ($1, $2, true, false, $3, $3)`,
        [userId, payload.email, now]
      );

      // Insert credentials
      await client.query(
        `INSERT INTO user_credentials (user_id, password_hash, password_salt, created_at, updated_at)
         VALUES ($1, $2, $3, $4, $4)`,
        [userId, hash, salt, now]
      );

      await client.query('COMMIT');

      // Create session and return tokens (same as login)
      const sessionId = randomUUID();
      const ipAddress = getClientIp(req);
      await createSession(
        sessionId,
        {
          userId,
          email: payload.email,
          admin: false,
          ipAddress
        },
        REFRESH_TOKEN_TTL_SECONDS
      );

      const accessToken = createJwt(
        { sub: userId, email: payload.email, jti: sessionId },
        jwtSecret,
        ACCESS_TOKEN_TTL_SECONDS
      );

      const refreshTokenId = randomUUID();
      await storeRefreshToken(
        refreshTokenId,
        { sessionId, userId },
        REFRESH_TOKEN_TTL_SECONDS
      );

      const refreshToken = createJwt(
        { sub: userId, jti: refreshTokenId, sid: sessionId, type: 'refresh' },
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
          id: userId,
          email: payload.email
        }
      });
    } catch (txError) {
      await client.query('ROLLBACK');
      throw txError;
    } finally {
      client.release();
    }
  } catch (error) {
    console.error('Registration failed:', error);
    res.status(500).json({ error: 'Failed to register' });
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
  if (!sessionId || typeof sessionId !== 'string') {
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

/**
 * @openapi
 * /auth/logout:
 *   post:
 *     summary: Logout and invalidate current session
 *     description: Deletes the current session and refresh token.
 *     tags:
 *       - Auth
 *     security:
 *       - bearerAuth: []
 *     responses:
 *       200:
 *         description: Logged out successfully
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 loggedOut:
 *                   type: boolean
 *       401:
 *         description: Unauthorized
 *       500:
 *         description: Server error
 */
router.post('/logout', async (req: Request, res: Response) => {
  const claims = req.authClaims;
  if (!claims) {
    res.status(401).json({ error: 'Unauthorized' });
    return;
  }

  try {
    await deleteSession(claims.jti, claims.sub);

    res.json({ loggedOut: true });
  } catch (error) {
    console.error('Failed to logout:', error);
    res.status(500).json({ error: 'Failed to logout' });
  }
});

export { router as authRouter };
