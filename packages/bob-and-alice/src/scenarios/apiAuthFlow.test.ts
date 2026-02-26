import { afterEach, describe, expect, it } from 'vitest';
import { ApiScenarioHarness } from '../harness/apiScenarioHarness.js';

interface AuthResponse {
  accessToken: string;
  refreshToken: string;
  user: { email: string };
}

interface SessionsResponse {
  sessions: unknown[];
}

interface LogoutResponse {
  loggedOut: boolean;
}

const getApiDeps = async () => {
  const api = await import('@tearleads/api');
  return { app: api.app, migrations: api.migrations };
};

describe('API auth flow', () => {
  let harness: ApiScenarioHarness | null = null;

  afterEach(async () => {
    if (harness) {
      await harness.teardown();
      harness = null;
    }
  });

  it('registers a new user, logs in, refreshes, and logs out', async () => {
    harness = await ApiScenarioHarness.create(
      [{ alias: 'alice', admin: true }],
      getApiDeps
    );
    const alice = harness.actor('alice');
    const baseUrl = `http://localhost:${String(harness.ctx.port)}/v1`;

    // Register a brand-new user (goes through real bcrypt hashing)
    const registerResponse = await fetch(`${baseUrl}/auth/register`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        email: 'newuser@test.local',
        password: 'Secure-password-123!'
      })
    });

    expect(registerResponse.status).toBe(200);
    const registerBody = (await registerResponse.json()) as AuthResponse;
    expect(registerBody).toHaveProperty('accessToken');
    expect(registerBody).toHaveProperty('refreshToken');
    expect(registerBody).toHaveProperty('user');
    expect(registerBody.user.email).toBe('newuser@test.local');

    // Login with the newly registered user
    const loginResponse = await fetch(`${baseUrl}/auth/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        email: 'newuser@test.local',
        password: 'Secure-password-123!'
      })
    });

    expect(loginResponse.status).toBe(200);
    const loginBody = (await loginResponse.json()) as AuthResponse;
    expect(loginBody).toHaveProperty('accessToken');
    expect(loginBody).toHaveProperty('refreshToken');
    expect(loginBody.user.email).toBe('newuser@test.local');

    const { accessToken, refreshToken } = loginBody;

    // Refresh the token
    const refreshResponse = await fetch(`${baseUrl}/auth/refresh`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${accessToken}`
      },
      body: JSON.stringify({ refreshToken })
    });

    expect(refreshResponse.status).toBe(200);
    const refreshBody = (await refreshResponse.json()) as AuthResponse;
    expect(refreshBody).toHaveProperty('accessToken');
    expect(refreshBody).toHaveProperty('refreshToken');
    expect(refreshBody.accessToken).not.toBe(accessToken);

    // List sessions using the new access token
    const sessionsResponse = await fetch(`${baseUrl}/auth/sessions`, {
      headers: { Authorization: `Bearer ${refreshBody.accessToken}` }
    });

    expect(sessionsResponse.status).toBe(200);
    const sessionsBody = (await sessionsResponse.json()) as SessionsResponse;
    expect(sessionsBody.sessions.length).toBeGreaterThanOrEqual(1);

    // Logout
    const logoutResponse = await fetch(`${baseUrl}/auth/logout`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${refreshBody.accessToken}` }
    });

    expect(logoutResponse.status).toBe(200);
    const logoutBody = (await logoutResponse.json()) as LogoutResponse;
    expect(logoutBody.loggedOut).toBe(true);

    // Verify the seeded user's auth also works via the harness
    const pingResponse = await alice.fetchJson<{ version: string }>('/ping');
    expect(pingResponse).toHaveProperty('version');
  });

  it('rejects login with wrong password', async () => {
    harness = await ApiScenarioHarness.create([{ alias: 'alice' }], getApiDeps);
    const baseUrl = `http://localhost:${String(harness.ctx.port)}/v1`;

    // Register a user first
    await fetch(`${baseUrl}/auth/register`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        email: 'badpass@test.local',
        password: 'Correct-password-1!'
      })
    });

    // Try to login with wrong password
    const loginResponse = await fetch(`${baseUrl}/auth/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        email: 'badpass@test.local',
        password: 'wrong-password'
      })
    });

    expect(loginResponse.status).toBe(401);
  });

  it('rejects duplicate registration', async () => {
    harness = await ApiScenarioHarness.create([{ alias: 'alice' }], getApiDeps);
    const baseUrl = `http://localhost:${String(harness.ctx.port)}/v1`;

    // Register first user
    const firstResponse = await fetch(`${baseUrl}/auth/register`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        email: 'dupe@test.local',
        password: 'Password-dupe-1!'
      })
    });
    expect(firstResponse.status).toBe(200);

    // Try to register with same email
    const dupeResponse = await fetch(`${baseUrl}/auth/register`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        email: 'dupe@test.local',
        password: 'Password-dupe-2!'
      })
    });
    expect(dupeResponse.status).toBe(409);
  });
});
