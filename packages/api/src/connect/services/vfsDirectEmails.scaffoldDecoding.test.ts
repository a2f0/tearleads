import { beforeEach, describe, expect, it, vi } from 'vitest';

const { getPoolMock, readQueryMock, requireVfsClaimsMock } = vi.hoisted(() => ({
  getPoolMock: vi.fn(),
  readQueryMock: vi.fn(),
  requireVfsClaimsMock: vi.fn()
}));

vi.mock('../../lib/postgres.js', () => ({
  getPool: (...args: unknown[]) => getPoolMock(...args),
  getPostgresPool: vi.fn()
}));

vi.mock('./vfsDirectAuth.js', () => ({
  requireVfsClaims: (...args: unknown[]) => requireVfsClaimsMock(...args)
}));

import { getEmailDirect } from './vfsDirectEmails.js';

function parseJson(json: string): unknown {
  return JSON.parse(json);
}

describe('vfsDirectEmails scaffold decoding', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    readQueryMock.mockReset();
    getPoolMock.mockResolvedValue({
      query: readQueryMock
    });
    requireVfsClaimsMock.mockResolvedValue({
      sub: 'user-1'
    });
  });

  it('decodes base64-encoded email payload fields', async () => {
    readQueryMock.mockResolvedValueOnce({
      rows: [
        {
          id: 'email-decode',
          encrypted_from: 'c3lzdGVtQHRlYXJsZWFkcy5jb20=',
          encrypted_to: ['Ym9iQHRlc3QubG9jYWw=', 'alice@test.local'],
          encrypted_subject: 'V2VsY29tZSB0byBUZWFybGVhZHM=',
          received_at: '2026-03-03T00:00:00.000Z',
          ciphertext_size: 12,
          encrypted_body_path: 'scaffolding://welcome-email-body'
        }
      ]
    });

    const response = await getEmailDirect(
      {
        id: 'email-decode'
      },
      {
        requestHeader: new Headers()
      }
    );

    expect(parseJson(response.json)).toEqual({
      id: 'email-decode',
      from: 'system@tearleads.com',
      to: ['bob@test.local', 'alice@test.local'],
      subject: 'Welcome to Tearleads',
      receivedAt: '2026-03-03T00:00:00.000Z',
      size: 12,
      rawData: '',
      encryptedBodyPath: 'scaffolding://welcome-email-body'
    });
  });
});
