import { randomUUID } from 'node:crypto';
import type { Pool as PgPool } from 'pg';
import { createJwt } from './jwt.js';
import type { RedisMockClient } from './redisMock.js';

export interface SeededUser {
  userId: string;
  email: string;
  accessToken: string;
  refreshToken: string;
  sessionId: string;
  organizationId: string;
}

export interface SeedTestUserOptions {
  email?: string;
  admin?: boolean;
}

export async function seedTestUser(
  ctx: { pool: PgPool; redis: RedisMockClient },
  options?: SeedTestUserOptions
): Promise<SeededUser> {
  const userId = randomUUID();
  const email = options?.email ?? `test-${userId.slice(0, 8)}@test.local`;
  const admin = options?.admin ?? false;
  const sessionId = randomUUID();
  const refreshTokenId = randomUUID();
  const orgId = `personal-org-${userId}`;

  // Create the user's personal organization
  await ctx.pool.query(
    `INSERT INTO organizations (id, name, is_personal, created_at, updated_at)
     VALUES ($1, $2, TRUE, NOW(), NOW())`,
    [orgId, `Personal - ${email}`]
  );

  // Insert user into the database
  await ctx.pool.query(
    `INSERT INTO users (id, email, personal_organization_id, created_at, updated_at)
     VALUES ($1, $2, $3, NOW(), NOW())`,
    [userId, email, orgId]
  );

  // Insert credentials into user_credentials
  await ctx.pool.query(
    `INSERT INTO user_credentials (user_id, password_hash, password_salt, created_at, updated_at)
     VALUES ($1, 'not-a-real-hash', 'not-a-real-salt', NOW(), NOW())`,
    [userId]
  );

  // Add user as admin member of their personal org
  await ctx.pool.query(
    `INSERT INTO user_organizations (user_id, organization_id, joined_at, is_admin)
     VALUES ($1, $2, NOW(), TRUE)`,
    [userId, orgId]
  );

  // Create session in Redis
  const sessionData = {
    userId,
    email,
    admin,
    createdAt: new Date().toISOString(),
    lastActiveAt: new Date().toISOString(),
    ipAddress: '127.0.0.1'
  };

  const sessionKey = `session:${sessionId}`;
  const userSessionsKey = `user_sessions:${userId}`;
  await ctx.redis.set(sessionKey, JSON.stringify(sessionData), {
    EX: 3600
  });
  await ctx.redis.sAdd(userSessionsKey, sessionId);

  // Store refresh token in Redis (matches sessions.ts storeRefreshToken format)
  const refreshTokenData = {
    sessionId,
    userId,
    createdAt: new Date().toISOString()
  };
  await ctx.redis.set(
    `refresh_token:${refreshTokenId}`,
    JSON.stringify(refreshTokenData),
    { EX: 604800 }
  );

  // Create JWT tokens
  const jwtSecret =
    process.env['JWT_SECRET'] ?? 'test-jwt-secret-for-api-test-utils';
  const accessToken = createJwt(
    { sub: userId, email, jti: sessionId },
    jwtSecret,
    3600
  );
  const refreshToken = createJwt(
    { sub: userId, jti: refreshTokenId, sid: sessionId, type: 'refresh' },
    jwtSecret,
    604800
  );

  return {
    userId,
    email,
    accessToken,
    refreshToken,
    sessionId,
    organizationId: orgId
  };
}
