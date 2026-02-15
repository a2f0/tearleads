import { beforeEach, describe, expect, it } from 'vitest';
import {
  createTestKeyManager,
  getTestKeyManager,
  resetTestKeyManager,
  TestKeyManager
} from './testKeyManager.js';

describe('TestKeyManager', () => {
  describe('constructor and initial state', () => {
    it('starts with no existing key', async () => {
      const km = new TestKeyManager();
      expect(await km.hasExistingKey()).toBe(false);
    });

    it('starts with null current key', () => {
      const km = new TestKeyManager();
      expect(km.getCurrentKey()).toBeNull();
    });
  });

  describe('initialize', () => {
    it('is a no-op', async () => {
      const km = new TestKeyManager();
      await expect(km.initialize()).resolves.toBeUndefined();
    });
  });

  describe('setupNewKey', () => {
    it('returns deterministic test key', async () => {
      const km = new TestKeyManager();
      const key = await km.setupNewKey('any-password');
      expect(key).toBeInstanceOf(Uint8Array);
      expect(key.length).toBe(32);
      expect(key[0]).toBe(0x00);
      expect(key[31]).toBe(0x1f);
    });

    it('marks database as set up', async () => {
      const km = new TestKeyManager();
      await km.setupNewKey('password');
      expect(await km.hasExistingKey()).toBe(true);
    });

    it('sets current key', async () => {
      const km = new TestKeyManager();
      await km.setupNewKey('password');
      expect(km.getCurrentKey()).not.toBeNull();
    });
  });

  describe('unlockWithPassword', () => {
    it('throws if not set up', async () => {
      const km = new TestKeyManager();
      await expect(km.unlockWithPassword('password')).rejects.toThrow(
        'No existing key found'
      );
    });

    it('returns key when set up', async () => {
      const km = new TestKeyManager();
      await km.setupNewKey('password');
      const key = await km.unlockWithPassword('any-password');
      expect(key).toBeInstanceOf(Uint8Array);
      expect(key?.length).toBe(32);
    });
  });

  describe('changePassword', () => {
    it('returns null if not set up', async () => {
      const km = new TestKeyManager();
      const result = await km.changePassword('old', 'new');
      expect(result).toBeNull();
    });

    it('returns same keys when set up', async () => {
      const km = new TestKeyManager();
      await km.setupNewKey('password');
      const result = await km.changePassword('old', 'new');
      expect(result).not.toBeNull();
      expect(result?.oldKey).toEqual(result?.newKey);
    });
  });

  describe('clearKey', () => {
    it('clears the current key', async () => {
      const km = new TestKeyManager();
      await km.setupNewKey('password');
      expect(km.getCurrentKey()).not.toBeNull();
      km.clearKey();
      expect(km.getCurrentKey()).toBeNull();
    });
  });

  describe('reset', () => {
    it('resets all state', async () => {
      const km = new TestKeyManager();
      await km.setupNewKey('password');
      await km.persistSession();
      await km.reset();
      expect(await km.hasExistingKey()).toBe(false);
      expect(km.getCurrentKey()).toBeNull();
      expect(await km.hasPersistedSession()).toBe(false);
    });
  });

  describe('session persistence', () => {
    it('persistSession returns false without current key', async () => {
      const km = new TestKeyManager();
      expect(await km.persistSession()).toBe(false);
    });

    it('persistSession returns true with current key', async () => {
      const km = new TestKeyManager();
      await km.setupNewKey('password');
      expect(await km.persistSession()).toBe(true);
    });

    it('hasPersistedSession returns false initially', async () => {
      const km = new TestKeyManager();
      expect(await km.hasPersistedSession()).toBe(false);
    });

    it('hasPersistedSession returns true after persist', async () => {
      const km = new TestKeyManager();
      await km.setupNewKey('password');
      await km.persistSession();
      expect(await km.hasPersistedSession()).toBe(true);
    });

    it('restoreSession returns null without persisted session', async () => {
      const km = new TestKeyManager();
      expect(await km.restoreSession()).toBeNull();
    });

    it('restoreSession returns key with persisted session', async () => {
      const km = new TestKeyManager();
      await km.setupNewKey('password');
      await km.persistSession();
      km.clearKey();
      const key = await km.restoreSession();
      expect(key).toBeInstanceOf(Uint8Array);
    });

    it('clearPersistedSession clears session', async () => {
      const km = new TestKeyManager();
      await km.setupNewKey('password');
      await km.persistSession();
      await km.clearPersistedSession();
      expect(await km.hasPersistedSession()).toBe(false);
    });
  });

  describe('setIsSetUp', () => {
    it('forces setup state', async () => {
      const km = new TestKeyManager();
      km.setIsSetUp(true);
      expect(await km.hasExistingKey()).toBe(true);
    });
  });

  describe('getTestKey', () => {
    it('returns deterministic key', () => {
      const key = TestKeyManager.getTestKey();
      expect(key).toBeInstanceOf(Uint8Array);
      expect(key.length).toBe(32);
      expect(key[0]).toBe(0x00);
      expect(key[31]).toBe(0x1f);
    });
  });
});

describe('singleton helpers', () => {
  beforeEach(async () => {
    await resetTestKeyManager();
  });

  describe('getTestKeyManager', () => {
    it('returns same instance on multiple calls', () => {
      const km1 = getTestKeyManager();
      const km2 = getTestKeyManager();
      expect(km1).toBe(km2);
    });
  });

  describe('resetTestKeyManager', () => {
    it('resets the singleton', async () => {
      const km1 = getTestKeyManager();
      await km1.setupNewKey('password');
      await resetTestKeyManager();
      const km2 = getTestKeyManager();
      expect(await km2.hasExistingKey()).toBe(false);
    });
  });

  describe('createTestKeyManager', () => {
    it('returns fresh instance', () => {
      const km1 = createTestKeyManager();
      const km2 = createTestKeyManager();
      expect(km1).not.toBe(km2);
    });

    it('returns instance separate from singleton', () => {
      const singleton = getTestKeyManager();
      const fresh = createTestKeyManager();
      expect(fresh).not.toBe(singleton);
    });
  });
});
