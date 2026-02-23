import {
  buildVfsPublicEncryptionKey,
  decryptVfsPrivateKeysWithPassword,
  reconstructVfsKeyPair,
  splitPublicKey
} from '@tearleads/shared';
import { describe, expect, it, vi } from 'vitest';
import {
  seedHarnessAccount,
  type HarnessSqlClient
} from './accountSeed.js';

describe('seedHarnessAccount', () => {
  it('persists onboarding keys derived from the account password', async () => {
    const queryImpl: HarnessSqlClient['query'] = async (text) => {
      if (text.includes('SELECT id FROM users')) {
        return { rows: [] };
      }
      return { rows: [] };
    };
    const querySpy = vi.fn(queryImpl);
    const client: HarnessSqlClient = { query: querySpy };
    const password = 'ComplexPassword123!';

    const result = await seedHarnessAccount(client, {
      email: 'alice@example.com',
      password
    });

    expect(result.createdVfsOnboardingKeys).toBe(true);

    const userKeysCall = querySpy.mock.calls.find(([text]) =>
      text.includes('INSERT INTO user_keys')
    );
    expect(userKeysCall).toBeDefined();
    if (!userKeysCall) {
      throw new Error('Expected INSERT INTO user_keys call');
    }
    const values = userKeysCall[1];
    if (!values) {
      throw new Error('Expected parameter values for user_keys insert');
    }

    const publicEncryptionKey = values[1];
    const encryptedPrivateKeys = values[3];
    const argon2Salt = values[4];

    if (
      typeof publicEncryptionKey !== 'string' ||
      typeof encryptedPrivateKeys !== 'string' ||
      typeof argon2Salt !== 'string'
    ) {
      throw new Error('Invalid user_keys parameter types');
    }

    const decryptedPrivateKeys = await decryptVfsPrivateKeysWithPassword(
      encryptedPrivateKeys,
      argon2Salt,
      password
    );
    const reconstructed = reconstructVfsKeyPair(
      splitPublicKey(publicEncryptionKey),
      decryptedPrivateKeys
    );

    expect(buildVfsPublicEncryptionKey(reconstructed)).toBe(publicEncryptionKey);
  });

  it('throws when the account already exists', async () => {
    const queryImpl: HarnessSqlClient['query'] = async (text) => {
      if (text.includes('SELECT id FROM users')) {
        return { rows: [{ id: 'existing-user-id' }] };
      }
      return { rows: [] };
    };
    const querySpy = vi.fn(queryImpl);
    const client: HarnessSqlClient = { query: querySpy };

    await expect(
      seedHarnessAccount(client, {
        email: 'alice@example.com',
        password: 'ComplexPassword123!'
      })
    ).rejects.toThrow('Account already exists for alice@example.com.');

    const insertUserCall = querySpy.mock.calls.find(([text]) =>
      text.includes('INSERT INTO users')
    );
    expect(insertUserCall).toBeUndefined();
  });
});
