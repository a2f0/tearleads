import { randomUUID } from 'node:crypto';
import { Code, ConnectError, type HandlerContext } from '@connectrpc/connect';
import type { RegisterRequest } from '@tearleads/shared/gen/tearleads/v1/auth_pb';
import { buildRevenueCatAppUserId } from '../../../lib/billing.js';
import {
  buildPersonalOrganizationId,
  buildPersonalOrganizationName
} from '../../../lib/createAccount.js';
import { createJwt } from '../../../lib/jwt.js';
import { hashPassword } from '../../../lib/passwords.js';
import { getPostgresPool } from '../../../lib/postgres.js';
import { createSession, storeRefreshToken } from '../../../lib/sessions.js';
import {
  ACCESS_TOKEN_TTL_SECONDS,
  EMAIL_REGEX,
  getAllowedEmailDomains,
  MIN_PASSWORD_LENGTH,
  PASSWORD_COMPLEXITY_ERROR,
  parseRegisterPayload,
  passwordMeetsComplexity,
  REFRESH_TOKEN_TTL_SECONDS
} from '../../../routes/auth/shared.js';
import { getClientIpFromHeaders, getJwtSecretOrThrow } from './shared.js';

export async function register(
  request: RegisterRequest,
  context: HandlerContext
) {
  const parsedPayload = parseRegisterPayload({
    email: request.email,
    password: request.password,
    ...(request.vfsKeySetup
      ? {
          vfsKeySetup: {
            publicEncryptionKey: request.vfsKeySetup.publicEncryptionKey,
            publicSigningKey: request.vfsKeySetup.publicSigningKey,
            encryptedPrivateKeys: request.vfsKeySetup.encryptedPrivateKeys,
            argon2Salt: request.vfsKeySetup.argon2Salt
          }
        }
      : {})
  });

  if (!parsedPayload.ok) {
    if (parsedPayload.error === 'INVALID_VFS_KEY_SETUP') {
      throw new ConnectError(
        'vfsKeySetup must include publicEncryptionKey, encryptedPrivateKeys, and argon2Salt',
        Code.InvalidArgument
      );
    }
    throw new ConnectError(
      'email and password are required',
      Code.InvalidArgument
    );
  }

  const payload = parsedPayload.value;

  if (!EMAIL_REGEX.test(payload.email)) {
    throw new ConnectError('Invalid email format', Code.InvalidArgument);
  }

  const allowedDomains = getAllowedEmailDomains();
  if (allowedDomains.length > 0) {
    const emailDomain = payload.email.split('@')[1]?.toLowerCase();
    if (!emailDomain || !allowedDomains.includes(emailDomain)) {
      throw new ConnectError(
        `Email domain not allowed. Allowed domains: ${allowedDomains.join(', ')}`,
        Code.InvalidArgument
      );
    }
  }

  if (payload.password.length < MIN_PASSWORD_LENGTH) {
    throw new ConnectError(
      `Password must be at least ${MIN_PASSWORD_LENGTH} characters`,
      Code.InvalidArgument
    );
  }
  if (!passwordMeetsComplexity(payload.password)) {
    throw new ConnectError(PASSWORD_COMPLEXITY_ERROR, Code.InvalidArgument);
  }

  const jwtSecret = getJwtSecretOrThrow('Failed to register');

  try {
    const pool = await getPostgresPool();
    const existingUser = await pool.query<{ id: string }>(
      `SELECT id FROM users WHERE lower(email) = $1 LIMIT 1`,
      [payload.email]
    );
    if (existingUser.rows[0]) {
      throw new ConnectError('Email already registered', Code.AlreadyExists);
    }

    const { salt, hash } = await hashPassword(payload.password);
    const client = await pool.connect();
    let userId = '';

    try {
      await client.query('BEGIN');

      userId = randomUUID();
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
            payload.vfsKeySetup.publicSigningKey,
            payload.vfsKeySetup.encryptedPrivateKeys,
            payload.vfsKeySetup.argon2Salt,
            now
          ]
        );
      }

      await client.query('COMMIT');
    } catch (error) {
      await client.query('ROLLBACK');
      throw error;
    } finally {
      client.release();
    }

    const sessionId = randomUUID();
    const ipAddress = getClientIpFromHeaders(context.requestHeader);

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
      {
        sub: userId,
        email: payload.email,
        jti: sessionId
      },
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

    return {
      accessToken,
      refreshToken,
      tokenType: 'Bearer',
      expiresIn: ACCESS_TOKEN_TTL_SECONDS,
      refreshExpiresIn: REFRESH_TOKEN_TTL_SECONDS,
      user: {
        id: userId,
        email: payload.email
      }
    };
  } catch (error) {
    if (error instanceof ConnectError) {
      throw error;
    }
    throw new ConnectError('Failed to register', Code.Internal);
  }
}
