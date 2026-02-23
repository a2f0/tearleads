import { randomUUID } from 'node:crypto';
import type { Request, Response, Router as RouterType } from 'express';
import { buildRevenueCatAppUserId } from '../../lib/billing.js';
import {
  buildPersonalOrganizationId,
  buildPersonalOrganizationName
} from '../../lib/createAccount.js';
import { createJwt } from '../../lib/jwt.js';
import { hashPassword } from '../../lib/passwords.js';
import { getPostgresPool } from '../../lib/postgres.js';
import { getClientIp } from '../../lib/requestUtils.js';
import { createSession, storeRefreshToken } from '../../lib/sessions.js';
import {
  ACCESS_TOKEN_TTL_SECONDS,
  EMAIL_REGEX,
  getAllowedEmailDomains,
  MIN_PASSWORD_LENGTH,
  PASSWORD_COMPLEXITY_ERROR,
  parseRegisterPayload,
  passwordMeetsComplexity,
  REFRESH_TOKEN_TTL_SECONDS
} from './shared.js';

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
 *                 minLength: 12
 *               vfsKeySetup:
 *                 type: object
 *                 description: Optional VFS key bundle to persist during onboarding
 *                 properties:
 *                   publicEncryptionKey:
 *                     type: string
 *                   publicSigningKey:
 *                     type: string
 *                   encryptedPrivateKeys:
 *                     type: string
 *                   argon2Salt:
 *                     type: string
 *             required:
 *               - email
 *               - password
 *     responses:
 *       200:
 *         description: Registration successful, user logged in
 *       400:
 *         description: Invalid request payload or email domain not allowed
 *       409:
 *         description: Email already registered
 *       500:
 *         description: Server error
 */
const postRegisterHandler = async (
  req: Request,
  res: Response
): Promise<void> => {
  const parsedPayload = parseRegisterPayload(req.body);
  if (!parsedPayload.ok) {
    if (parsedPayload.error === 'INVALID_VFS_KEY_SETUP') {
      res.status(400).json({
        error:
          'vfsKeySetup must include publicEncryptionKey, encryptedPrivateKeys, and argon2Salt'
      });
      return;
    }
    res.status(400).json({ error: 'email and password are required' });
    return;
  }
  const payload = parsedPayload.value;

  if (!EMAIL_REGEX.test(payload.email)) {
    res.status(400).json({ error: 'Invalid email format' });
    return;
  }

  const allowedDomains = getAllowedEmailDomains();
  if (allowedDomains.length > 0) {
    const emailDomain = payload.email.split('@')[1]?.toLowerCase();
    if (!emailDomain || !allowedDomains.includes(emailDomain)) {
      res.status(400).json({
        error: `Email domain not allowed. Allowed domains: ${allowedDomains.join(', ')}`
      });
      return;
    }
  }

  if (payload.password.length < MIN_PASSWORD_LENGTH) {
    // COMPLIANCE_SENTINEL: TL-ACCT-001 | policy=compliance/SOC2/policies/01-account-management-policy.md | procedure=compliance/SOC2/procedures/01-account-management-procedure.md | control=password-complexity
    res.status(400).json({
      error: `Password must be at least ${MIN_PASSWORD_LENGTH} characters`
    });
    return;
  }
  if (!passwordMeetsComplexity(payload.password)) {
    // COMPLIANCE_SENTINEL: TL-ACCT-001 | policy=compliance/SOC2/policies/01-account-management-policy.md | procedure=compliance/SOC2/procedures/01-account-management-procedure.md | control=password-complexity
    res.status(400).json({
      error: PASSWORD_COMPLEXITY_ERROR
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

    const existingUser = await pool.query<{ id: string }>(
      `SELECT id FROM users WHERE lower(email) = $1 LIMIT 1`,
      [payload.email]
    );
    if (existingUser.rows[0]) {
      res.status(409).json({ error: 'Email already registered' });
      return;
    }

    const { salt, hash } = await hashPassword(payload.password);

    const client = await pool.connect();
    try {
      await client.query('BEGIN');

      const userId = randomUUID();
      const personalOrganizationId = buildPersonalOrganizationId(userId);
      const personalOrganizationName = buildPersonalOrganizationName(userId);
      const revenueCatAppUserId = buildRevenueCatAppUserId(
        personalOrganizationId
      );
      const now = new Date().toISOString();

      await client.query(
        `INSERT INTO users (
           id,
           email,
           email_confirmed,
           admin,
           personal_organization_id,
           created_at,
           updated_at
         )
         VALUES ($1, $2, true, false, $3, $4, $4)`,
        [userId, payload.email, personalOrganizationId, now]
      );

      await client.query(
        `INSERT INTO organizations (
           id,
           name,
           description,
           is_personal,
           created_at,
           updated_at
         )
         VALUES ($1, $2, $3, true, $4, $4)`,
        [
          personalOrganizationId,
          personalOrganizationName,
          `Personal organization for ${payload.email}`,
          now
        ]
      );

      await client.query(
        `INSERT INTO user_organizations (user_id, organization_id, joined_at, is_admin)
         VALUES ($1, $2, $3, true)`,
        [userId, personalOrganizationId, now]
      );

      await client.query(
        `INSERT INTO organization_billing_accounts (
           organization_id,
           revenuecat_app_user_id,
           entitlement_status,
           created_at,
           updated_at
         )
         VALUES ($1, $2, 'inactive', $3, $3)`,
        [personalOrganizationId, revenueCatAppUserId, now]
      );

      await client.query(
        `INSERT INTO user_credentials (user_id, password_hash, password_salt, created_at, updated_at)
         VALUES ($1, $2, $3, $4, $4)`,
        [userId, hash, salt, now]
      );

      if (payload.vfsKeySetup) {
        await client.query(
          `INSERT INTO user_keys (
             user_id,
             public_encryption_key,
             public_signing_key,
             encrypted_private_keys,
             argon2_salt,
             created_at
           ) VALUES ($1, $2, $3, $4, $5, $6)`,
          [
            userId,
            payload.vfsKeySetup.publicEncryptionKey,
            payload.vfsKeySetup.publicSigningKey ?? '',
            payload.vfsKeySetup.encryptedPrivateKeys,
            payload.vfsKeySetup.argon2Salt,
            now
          ]
        );
      }

      await client.query('COMMIT');

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
};

export function registerPostRegisterRoute(authRouter: RouterType): void {
  authRouter.post('/register', postRegisterHandler);
}
