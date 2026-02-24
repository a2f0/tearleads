import {
  buildVfsPublicEncryptionKey,
  decryptVfsPrivateKeysWithPassword,
  reconstructVfsKeyPair,
  splitPublicKey
} from '@tearleads/shared';
import { describe, expect, it } from 'vitest';
import { type HarnessSqlClient, seedHarnessAccount } from './pgAccount.js';

describe('seedHarnessAccount', () => {
  it('persists onboarding keys derived from the account password', async () => {
    const calls: Array<{
      text: string;
      values: readonly unknown[] | undefined;
    }> = [];
    const client: HarnessSqlClient = {
      async query(
        text: string,
        values?: readonly unknown[]
      ): Promise<{ rows: Record<string, unknown>[] }> {
        calls.push({ text, values });
        if (text.includes('SELECT id FROM users')) {
          return { rows: [] };
        }
        return { rows: [] };
      }
    };

    const password = 'ComplexPassword123!';

    const result = await seedHarnessAccount(client, {
      email: 'alice@example.com',
      password
    });

    expect(result.createdVfsOnboardingKeys).toBe(true);

    const userKeysCall = calls.find((call) =>
      call.text.includes('INSERT INTO user_keys')
    );
    expect(userKeysCall).toBeDefined();
    if (!userKeysCall) {
      throw new Error('Expected INSERT INTO user_keys call');
    }
    const values = userKeysCall.values;
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

    expect(buildVfsPublicEncryptionKey(reconstructed)).toBe(
      publicEncryptionKey
    );
  });

  it('throws when the account already exists', async () => {
    const calls: Array<{
      text: string;
      values: readonly unknown[] | undefined;
    }> = [];
    const client: HarnessSqlClient = {
      async query(text: string): Promise<{ rows: Record<string, unknown>[] }> {
        calls.push({ text, values: undefined });
        if (text.includes('SELECT id FROM users')) {
          return { rows: [{ id: 'existing-user-id' }] };
        }
        return { rows: [] };
      }
    };

    await expect(
      seedHarnessAccount(client, {
        email: 'alice@example.com',
        password: 'ComplexPassword123!'
      })
    ).rejects.toThrow('Account already exists for alice@example.com.');

    const insertUserCall = calls.find((call) =>
      call.text.includes('INSERT INTO users')
    );
    expect(insertUserCall).toBeUndefined();
  });
});
