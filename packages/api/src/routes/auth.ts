import { isRecord } from '@rapid/shared';
import {
  type Request,
  type Response,
  Router,
  type Router as RouterType
} from 'express';
import { randomUUID } from 'node:crypto';
import { getAccessTokenTtlSeconds } from '../lib/authConfig.js';
import { createJwt } from '../lib/jwt.js';
import { verifyPassword } from '../lib/passwords.js';
import { getPostgresPool } from '../lib/postgres.js';
import { createSession } from '../lib/sessions.js';

const router: RouterType = Router();
const ACCESS_TOKEN_TTL_SECONDS = getAccessTokenTtlSeconds();

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
 *                 tokenType:
 *                   type: string
 *                 expiresIn:
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
    }>(
      `SELECT u.id, u.email, uc.password_hash, uc.password_salt
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
    await createSession(
      sessionId,
      { userId: user.id, email: user.email },
      ACCESS_TOKEN_TTL_SECONDS
    );

    const accessToken = createJwt(
      { sub: user.id, email: user.email, jti: sessionId },
      jwtSecret,
      ACCESS_TOKEN_TTL_SECONDS
    );

    res.json({
      accessToken,
      tokenType: 'Bearer',
      expiresIn: ACCESS_TOKEN_TTL_SECONDS,
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

export { router as authRouter };
