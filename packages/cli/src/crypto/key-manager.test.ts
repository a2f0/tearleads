import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { getConfigPaths, setConfigRoot } from '../config/index.js';
import {
  changePassword,
  clearKey,
  clearPersistedSession,
  getCurrentKey,
  hasExistingKey,
  hasPersistedSession,
  persistSession,
  reset,
  restoreSession,
  setupNewKey,
  unlockWithPassword
} from './key-manager.js';

describe('key-manager', () => {
  let tempDir: string;

  beforeEach(async () => {
    tempDir = await fs.mkdtemp(path.join(os.tmpdir(), 'tearleads-keytest-'));
    setConfigRoot(tempDir);
    clearKey();
  });

  afterEach(async () => {
    setConfigRoot(null);
    clearKey();
    await fs.rm(tempDir, { recursive: true, force: true });
  });

  describe('hasExistingKey', () => {
    it('returns false when no key exists', async () => {
      const exists = await hasExistingKey();
      expect(exists).toBe(false);
    });

    it('returns true after key is set up', async () => {
      await setupNewKey('test-password');
      const exists = await hasExistingKey();
      expect(exists).toBe(true);
    });
  });

  describe('setupNewKey', () => {
    it('creates a new key and stores key data', async () => {
      const key = await setupNewKey('test-password');

      expect(key).toBeInstanceOf(Uint8Array);
      expect(key.length).toBe(32);

      const paths = getConfigPaths();
      const content = await fs.readFile(paths.keyData, 'utf-8');
      const data = JSON.parse(content);

      expect(data.salt).toBeDefined();
      expect(data.salt.length).toBe(32);
      expect(data.keyCheckValue).toBeDefined();
    });

    it('sets the current key', async () => {
      await setupNewKey('test-password');
      const current = getCurrentKey();

      expect(current).not.toBeNull();
      expect(current?.length).toBe(32);
    });
  });

  describe('unlockWithPassword', () => {
    it('returns the key for correct password', async () => {
      const originalKey = await setupNewKey('test-password');
      clearKey();

      const key = await unlockWithPassword('test-password');

      expect(key).not.toBeNull();
      expect(key).toEqual(originalKey);
    });

    it('returns null for incorrect password', async () => {
      await setupNewKey('test-password');
      clearKey();

      const key = await unlockWithPassword('wrong-password');

      expect(key).toBeNull();
    });

    it('throws when no key exists', async () => {
      await expect(unlockWithPassword('test-password')).rejects.toThrow(
        'No existing key found'
      );
    });

    it('sets the current key on success', async () => {
      await setupNewKey('test-password');
      clearKey();
      expect(getCurrentKey()).toBeNull();

      await unlockWithPassword('test-password');

      expect(getCurrentKey()).not.toBeNull();
    });
  });

  describe('changePassword', () => {
    it('changes the password successfully', async () => {
      const oldKey = await setupNewKey('old-password');
      clearKey();

      const result = await changePassword('old-password', 'new-password');

      expect(result).not.toBeNull();
      expect(result?.oldKey).toEqual(oldKey);
      expect(result?.newKey).not.toEqual(oldKey);
      expect(result?.newKey.length).toBe(32);
    });

    it('returns null for incorrect old password', async () => {
      await setupNewKey('old-password');
      clearKey();

      const result = await changePassword('wrong-password', 'new-password');

      expect(result).toBeNull();
    });

    it('allows unlocking with new password after change', async () => {
      await setupNewKey('old-password');
      const result = await changePassword('old-password', 'new-password');
      clearKey();

      const key = await unlockWithPassword('new-password');

      expect(key).not.toBeNull();
      expect(key).toEqual(result?.newKey);
    });

    it('disallows unlocking with old password after change', async () => {
      await setupNewKey('old-password');
      await changePassword('old-password', 'new-password');
      clearKey();

      const key = await unlockWithPassword('old-password');

      expect(key).toBeNull();
    });
  });

  describe('getCurrentKey', () => {
    it('returns null when not unlocked', () => {
      expect(getCurrentKey()).toBeNull();
    });

    it('returns key after setup', async () => {
      await setupNewKey('test-password');
      expect(getCurrentKey()).not.toBeNull();
    });

    it('returns key after unlock', async () => {
      await setupNewKey('test-password');
      clearKey();
      await unlockWithPassword('test-password');
      expect(getCurrentKey()).not.toBeNull();
    });
  });

  describe('clearKey', () => {
    it('clears the current key', async () => {
      await setupNewKey('test-password');
      expect(getCurrentKey()).not.toBeNull();

      clearKey();

      expect(getCurrentKey()).toBeNull();
    });

    it('does not throw when no key exists', () => {
      expect(() => clearKey()).not.toThrow();
    });
  });

  describe('reset', () => {
    it('clears key data and session', async () => {
      await setupNewKey('test-password');
      await persistSession();

      await reset();

      expect(getCurrentKey()).toBeNull();
      expect(await hasExistingKey()).toBe(false);
      expect(await hasPersistedSession()).toBe(false);
    });

    it('does not throw when nothing to reset', async () => {
      await expect(reset()).resolves.not.toThrow();
    });
  });

  describe('session persistence', () => {
    it('persists and restores session', async () => {
      const originalKey = await setupNewKey('test-password');
      const persisted = await persistSession();
      expect(persisted).toBe(true);

      clearKey();
      expect(getCurrentKey()).toBeNull();

      const restoredKey = await restoreSession();

      expect(restoredKey).not.toBeNull();
      expect(restoredKey).toEqual(originalKey);
      expect(getCurrentKey()).toEqual(originalKey);
    });

    it('hasPersistedSession returns true after persist', async () => {
      await setupNewKey('test-password');
      expect(await hasPersistedSession()).toBe(false);

      await persistSession();

      expect(await hasPersistedSession()).toBe(true);
    });

    it('clearPersistedSession removes session', async () => {
      await setupNewKey('test-password');
      await persistSession();
      expect(await hasPersistedSession()).toBe(true);

      await clearPersistedSession();

      expect(await hasPersistedSession()).toBe(false);
    });

    it('restoreSession returns null when no session exists', async () => {
      const result = await restoreSession();
      expect(result).toBeNull();
    });

    it('persistSession returns false when no key is set', async () => {
      const result = await persistSession();
      expect(result).toBe(false);
    });

    it('persistSession returns false on error', async () => {
      await setupNewKey('test-password');

      // Make config paths point to a non-writable location
      const originalWriteFile = fs.writeFile;
      vi.spyOn(fs, 'writeFile').mockRejectedValueOnce(new Error('Write error'));

      const result = await persistSession();
      expect(result).toBe(false);

      // Restore
      vi.mocked(fs.writeFile).mockImplementation(originalWriteFile);
    });

    it('restoreSession clears invalid session data', async () => {
      await setupNewKey('test-password');
      const paths = getConfigPaths();

      await fs.writeFile(paths.session, '{"invalid": "data"}');

      const result = await restoreSession();

      expect(result).toBeNull();
      expect(await hasPersistedSession()).toBe(false);
    });
  });
});
