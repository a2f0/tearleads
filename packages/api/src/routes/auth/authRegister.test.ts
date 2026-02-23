import request from 'supertest';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { app } from '../../index.js';
import { verifyJwt, verifyRefreshJwt } from '../../lib/jwt.js';
import { deleteRefreshToken, deleteSession } from '../../lib/sessions.js';
import { mockConsoleError } from '../../test/consoleMocks.js';

const mockQuery = vi.fn();
const mockGetPostgresPool = vi.fn();

vi.mock('../../lib/postgres.js', () => ({
  getPostgresPool: () => mockGetPostgresPool()
}));

describe('Auth register routes', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.stubEnv('JWT_SECRET', 'test-secret');
    mockGetPostgresPool.mockResolvedValue({
      query: mockQuery
    });
  });

  afterEach(() => {
    vi.unstubAllEnvs();
  });

  describe('POST /auth/register', () => {
    it('returns 400 when payload is missing', async () => {
      const response = await request(app).post('/v1/auth/register').send({});

      expect(response.status).toBe(400);
      expect(response.body).toEqual({
        error: 'email and password are required'
      });
    });

    it('returns 400 for invalid email format', async () => {
      const response = await request(app)
        .post('/v1/auth/register')
        .send({ email: 'not-an-email', password: 'SecurePassword123!' });

      expect(response.status).toBe(400);
      expect(response.body).toEqual({ error: 'Invalid email format' });
    });

    it('returns 400 when vfsKeySetup payload is malformed', async () => {
      const response = await request(app)
        .post('/v1/auth/register')
        .send({
          email: 'user@example.com',
          password: 'SecurePassword123!',
          vfsKeySetup: {
            publicEncryptionKey: 'pub',
            encryptedPrivateKeys: 'encrypted'
          }
        });

      expect(response.status).toBe(400);
      expect(response.body).toEqual({
        error:
          'vfsKeySetup must include publicEncryptionKey, encryptedPrivateKeys, and argon2Salt'
      });
      expect(mockQuery).not.toHaveBeenCalled();
    });

    // COMPLIANCE_SENTINEL: TL-ACCT-001 | policy=compliance/SOC2/policies/01-account-management-policy.md | procedure=compliance/SOC2/procedures/01-account-management-procedure.md | control=password-complexity
    it('returns 400 for password too short', async () => {
      const response = await request(app)
        .post('/v1/auth/register')
        .send({ email: 'user@example.com', password: 'short' });

      expect(response.status).toBe(400);
      expect(response.body).toEqual({
        error: 'Password must be at least 12 characters'
      });
    });

    it('returns 400 for password missing complexity requirements', async () => {
      const response = await request(app).post('/v1/auth/register').send({
        email: 'user@example.com',
        password: 'alllowercase1234'
      });

      expect(response.status).toBe(400);
      expect(response.body).toEqual({
        error:
          'Password must include at least one uppercase letter, one lowercase letter, one number, and one symbol'
      });
    });

    it('returns 400 for invalid email domain when domains are restricted', async () => {
      vi.stubEnv('SMTP_RECIPIENT_DOMAINS', 'allowed.com,another.com');

      const response = await request(app)
        .post('/v1/auth/register')
        .send({ email: 'user@notallowed.com', password: 'SecurePassword123!' });

      expect(response.status).toBe(400);
      expect(response.body).toEqual({
        error:
          'Email domain not allowed. Allowed domains: allowed.com, another.com'
      });
    });

    it('returns 409 when email already exists', async () => {
      vi.stubEnv('SMTP_RECIPIENT_DOMAINS', '');
      mockQuery.mockResolvedValueOnce({
        rows: [{ id: 'existing-user' }]
      });

      const response = await request(app).post('/v1/auth/register').send({
        email: 'existing@example.com',
        password: 'SecurePassword123!'
      });

      expect(response.status).toBe(409);
      expect(response.body).toEqual({ error: 'Email already registered' });
    });

    it('returns 200 with tokens on successful registration', async () => {
      vi.stubEnv('SMTP_RECIPIENT_DOMAINS', '');

      const mockClient = {
        query: vi.fn(),
        release: vi.fn()
      };
      mockQuery.mockResolvedValueOnce({ rows: [] }); // Check for existing user
      mockGetPostgresPool.mockResolvedValue({
        query: mockQuery,
        connect: vi.fn().mockResolvedValue(mockClient)
      });

      const response = await request(app)
        .post('/v1/auth/register')
        .send({ email: 'newuser@example.com', password: 'SecurePassword123!' });

      expect(response.status).toBe(200);
      expect(response.body.accessToken).toEqual(expect.any(String));
      expect(response.body.refreshToken).toEqual(expect.any(String));
      expect(response.body.tokenType).toBe('Bearer');
      expect(response.body.expiresIn).toBe(3600);
      expect(response.body.refreshExpiresIn).toBe(604800);
      expect(response.body.user).toMatchObject({
        id: expect.any(String),
        email: 'newuser@example.com'
      });

      expect(mockClient.query).toHaveBeenCalledWith('BEGIN');
      expect(mockClient.query).toHaveBeenCalledWith(
        expect.stringContaining('personal_organization_id'),
        expect.any(Array)
      );
      expect(mockClient.query).toHaveBeenCalledWith(
        expect.stringContaining('INSERT INTO organizations'),
        expect.any(Array)
      );
      expect(mockClient.query).toHaveBeenCalledWith(
        expect.stringContaining('INSERT INTO user_organizations'),
        expect.any(Array)
      );
      expect(mockClient.query).toHaveBeenCalledWith(
        expect.stringContaining('INSERT INTO organization_billing_accounts'),
        expect.any(Array)
      );
      expect(mockClient.query).toHaveBeenCalledWith('COMMIT');
      expect(mockClient.release).toHaveBeenCalled();

      // Clean up Redis session data
      const claims = verifyJwt(response.body.accessToken, 'test-secret');
      if (claims) {
        await deleteSession(claims.jti, response.body.user.id);
      }
      const refreshClaims = verifyRefreshJwt(
        response.body.refreshToken,
        'test-secret'
      );
      if (refreshClaims) {
        await deleteRefreshToken(refreshClaims.jti);
      }
    });

    it('persists vfs keys during registration when bundle is provided', async () => {
      vi.stubEnv('SMTP_RECIPIENT_DOMAINS', '');

      const mockClient = {
        query: vi.fn(),
        release: vi.fn()
      };
      mockQuery.mockResolvedValueOnce({ rows: [] }); // Check for existing user
      mockGetPostgresPool.mockResolvedValue({
        query: mockQuery,
        connect: vi.fn().mockResolvedValue(mockClient)
      });

      const response = await request(app)
        .post('/v1/auth/register')
        .send({
          email: 'newuser@example.com',
          password: 'SecurePassword123!',
          vfsKeySetup: {
            publicEncryptionKey: 'enc-pub',
            publicSigningKey: 'sign-pub',
            encryptedPrivateKeys: 'encrypted-private-bundle',
            argon2Salt: 'argon2-salt'
          }
        });

      expect(response.status).toBe(200);
      expect(mockClient.query).toHaveBeenCalledWith(
        expect.stringContaining('INSERT INTO user_keys'),
        expect.arrayContaining([
          expect.any(String),
          'enc-pub',
          'sign-pub',
          'encrypted-private-bundle',
          'argon2-salt',
          expect.any(String)
        ])
      );
      expect(mockClient.query).toHaveBeenCalledWith('COMMIT');
      expect(mockClient.release).toHaveBeenCalled();

      const claims = verifyJwt(response.body.accessToken, 'test-secret');
      if (claims) {
        await deleteSession(claims.jti, response.body.user.id);
      }
      const refreshClaims = verifyRefreshJwt(
        response.body.refreshToken,
        'test-secret'
      );
      if (refreshClaims) {
        await deleteRefreshToken(refreshClaims.jti);
      }
    });

    it('allows registration when email matches allowed domain', async () => {
      vi.stubEnv('SMTP_RECIPIENT_DOMAINS', 'example.com');

      const mockClient = {
        query: vi.fn(),
        release: vi.fn()
      };
      mockQuery.mockResolvedValueOnce({ rows: [] });
      mockGetPostgresPool.mockResolvedValue({
        query: mockQuery,
        connect: vi.fn().mockResolvedValue(mockClient)
      });

      const response = await request(app)
        .post('/v1/auth/register')
        .send({ email: 'newuser@example.com', password: 'SecurePassword123!' });

      expect(response.status).toBe(200);

      // Clean up Redis session data
      const claims = verifyJwt(response.body.accessToken, 'test-secret');
      if (claims) {
        await deleteSession(claims.jti, response.body.user.id);
      }
      const refreshClaims = verifyRefreshJwt(
        response.body.refreshToken,
        'test-secret'
      );
      if (refreshClaims) {
        await deleteRefreshToken(refreshClaims.jti);
      }
    });

    it('returns 500 when database query fails', async () => {
      mockConsoleError();
      vi.stubEnv('SMTP_RECIPIENT_DOMAINS', '');
      mockQuery.mockRejectedValueOnce(new Error('db error'));

      const response = await request(app)
        .post('/v1/auth/register')
        .send({ email: 'user@example.com', password: 'SecurePassword123!' });

      expect(response.status).toBe(500);
      expect(response.body).toEqual({ error: 'Failed to register' });
    });

    it('returns 500 when JWT_SECRET is not configured', async () => {
      mockConsoleError();
      vi.unstubAllEnvs();

      const response = await request(app)
        .post('/v1/auth/register')
        .send({ email: 'user@example.com', password: 'SecurePassword123!' });

      expect(response.status).toBe(500);
      expect(response.body).toEqual({ error: 'Failed to register' });
    });

    it('rolls back transaction on insert failure', async () => {
      mockConsoleError();
      vi.stubEnv('SMTP_RECIPIENT_DOMAINS', '');

      const mockClient = {
        query: vi.fn().mockImplementation((sql: string) => {
          if (sql === 'BEGIN') return Promise.resolve();
          if (sql.includes('INSERT INTO users')) {
            return Promise.reject(new Error('Insert failed'));
          }
          return Promise.resolve();
        }),
        release: vi.fn()
      };
      mockQuery.mockResolvedValueOnce({ rows: [] });
      mockGetPostgresPool.mockResolvedValue({
        query: mockQuery,
        connect: vi.fn().mockResolvedValue(mockClient)
      });

      const response = await request(app)
        .post('/v1/auth/register')
        .send({ email: 'newuser@example.com', password: 'SecurePassword123!' });

      expect(response.status).toBe(500);
      expect(response.body).toEqual({ error: 'Failed to register' });
      expect(mockClient.query).toHaveBeenCalledWith('ROLLBACK');
      expect(mockClient.release).toHaveBeenCalled();
    });
  });
});
