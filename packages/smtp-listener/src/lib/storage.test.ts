import type { RedisClient } from '@rapid/shared/redis';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { StoredEmail } from '../types/email.js';

// Type guard for test mocks
function isRedisClient(obj: unknown): obj is RedisClient {
  return obj !== null && typeof obj === 'object';
}

const mockSet = vi.fn();
const mockGet = vi.fn();
const mockDel = vi.fn();
const mockLPush = vi.fn();
const mockLRange = vi.fn();
const mockLRem = vi.fn();
const mockSAdd = vi.fn();
const mockSMembers = vi.fn();
const mockCloseRedisClient = vi.fn();
const mockMultiExec = vi.fn();
const mockMultiSet = vi.fn().mockReturnThis();
const mockMultiSAdd = vi.fn().mockReturnThis();
const mockMultiLPush = vi.fn().mockReturnThis();
const mockMultiLRem = vi.fn().mockReturnThis();
const mockMultiDel = vi.fn().mockReturnThis();

const mockMulti = {
  set: mockMultiSet,
  sAdd: mockMultiSAdd,
  lPush: mockMultiLPush,
  lRem: mockMultiLRem,
  del: mockMultiDel,
  exec: mockMultiExec
};

function createMockClient(): RedisClient {
  const mock = {
    set: mockSet,
    get: mockGet,
    del: mockDel,
    lPush: mockLPush,
    lRange: mockLRange,
    lRem: mockLRem,
    sAdd: mockSAdd,
    sMembers: mockSMembers,
    multi: () => mockMulti
  };
  if (!isRedisClient(mock)) throw new Error('Invalid mock');
  return mock;
}

vi.mock('@rapid/shared/redis', () => ({
  getRedisClient: vi.fn(() => Promise.resolve(createMockClient())),
  closeRedisClient: vi.fn(() => mockCloseRedisClient())
}));

import { createStorage } from './storage.js';

describe('storage', () => {
  const testEmail: StoredEmail = {
    id: 'test-123',
    envelope: {
      mailFrom: { address: 'sender@example.com' },
      rcptTo: [{ address: 'recipient@example.com' }]
    },
    rawData: 'Subject: Test\r\n\r\nHello',
    receivedAt: '2024-01-15T10:30:00.000Z',
    size: 27
  };

  beforeEach(() => {
    vi.clearAllMocks();
    mockCloseRedisClient.mockResolvedValue(undefined);
    mockMultiExec.mockResolvedValue([]);
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  describe('createStorage', () => {
    it('should create a storage instance using shared redis client', async () => {
      const { getRedisClient } = await import('@rapid/shared/redis');
      const storage = await createStorage('redis://localhost:6379');

      expect(getRedisClient).toHaveBeenCalledWith('redis://localhost:6379');
      expect(storage).toBeDefined();
    });

    it('should work without explicit redis URL', async () => {
      const { getRedisClient } = await import('@rapid/shared/redis');
      const storage = await createStorage();

      expect(getRedisClient).toHaveBeenCalledWith(undefined);
      expect(storage).toBeDefined();
    });
  });

  describe('store', () => {
    it('should store an email in redis', async () => {
      const storage = await createStorage('redis://localhost:6379');
      await storage.store(testEmail, ['user-1']);

      expect(mockMultiSet).toHaveBeenCalledWith(
        'smtp:email:test-123',
        JSON.stringify(testEmail)
      );
      expect(mockMultiSAdd).toHaveBeenCalledWith('smtp:email:users:test-123', [
        'user-1'
      ]);
      expect(mockMultiLPush).toHaveBeenCalledWith(
        'smtp:emails:user-1',
        'test-123'
      );
    });
  });

  describe('get', () => {
    it('should retrieve an email by id', async () => {
      mockGet.mockResolvedValue(JSON.stringify(testEmail));

      const storage = await createStorage('redis://localhost:6379');
      const result = await storage.get('test-123');

      expect(mockGet).toHaveBeenCalledWith('smtp:email:test-123');
      expect(result).toEqual(testEmail);
    });

    it('should return null for non-existent email', async () => {
      mockGet.mockResolvedValue(null);

      const storage = await createStorage('redis://localhost:6379');
      const result = await storage.get('non-existent');

      expect(result).toBeNull();
    });
  });

  describe('list', () => {
    it('should list all email ids', async () => {
      mockLRange.mockResolvedValue(['id1', 'id2', 'id3']);

      const storage = await createStorage('redis://localhost:6379');
      const result = await storage.list('user-1');

      expect(mockLRange).toHaveBeenCalledWith('smtp:emails:user-1', 0, -1);
      expect(result).toEqual(['id1', 'id2', 'id3']);
    });
  });

  describe('delete', () => {
    it('should delete an email and return true', async () => {
      mockSMembers.mockResolvedValue(['user-1']);
      mockMultiExec.mockResolvedValue([[null, 1]]);

      const storage = await createStorage('redis://localhost:6379');
      const result = await storage.delete('test-123');

      expect(mockMultiDel).toHaveBeenCalledWith('smtp:email:test-123');
      expect(mockMultiLRem).toHaveBeenCalledWith(
        'smtp:emails:user-1',
        1,
        'test-123'
      );
      expect(result).toBe(true);
    });

    it('should return false for non-existent email', async () => {
      mockSMembers.mockResolvedValue([]);
      mockMultiExec.mockResolvedValue([[null, 0]]);

      const storage = await createStorage('redis://localhost:6379');
      const result = await storage.delete('non-existent');

      expect(result).toBe(false);
      expect(mockMultiLRem).not.toHaveBeenCalled();
    });
  });

  describe('close', () => {
    it('should close the redis connection using shared closeRedisClient', async () => {
      const { closeRedisClient } = await import('@rapid/shared/redis');
      const storage = await createStorage('redis://localhost:6379');
      await storage.close();

      expect(closeRedisClient).toHaveBeenCalled();
    });
  });
});
