import type { RedisClient } from '@tearleads/shared/redis';
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
const mockEval = vi.fn();
const mockCloseRedisClient = vi.fn();
const mockMultiExec = vi.fn();
const mockMultiSet = vi.fn().mockReturnThis();
const mockMultiSAdd = vi.fn().mockReturnThis();
const mockMultiLPush = vi.fn().mockReturnThis();
const mockMultiLRem = vi.fn().mockReturnThis();

const mockMulti = {
  set: mockMultiSet,
  sAdd: mockMultiSAdd,
  lPush: mockMultiLPush,
  lRem: mockMultiLRem,
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
    eval: mockEval,
    multi: () => mockMulti
  };
  if (!isRedisClient(mock)) throw new Error('Invalid mock');
  return mock;
}

vi.mock('@tearleads/shared/redis', () => ({
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
      const { getRedisClient } = await import('@tearleads/shared/redis');
      const storage = await createStorage('redis://localhost:6379');

      expect(getRedisClient).toHaveBeenCalledWith('redis://localhost:6379');
      expect(storage).toBeDefined();
    });

    it('should work without explicit redis URL', async () => {
      const { getRedisClient } = await import('@tearleads/shared/redis');
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

    it('should skip storing when no user ids are provided', async () => {
      const storage = await createStorage('redis://localhost:6379');
      await storage.store(testEmail, []);

      expect(mockMultiSet).not.toHaveBeenCalled();
      expect(mockMultiExec).not.toHaveBeenCalled();
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

    it('should return null for invalid stored data (missing required fields)', async () => {
      mockGet.mockResolvedValue(JSON.stringify({ id: 'test', invalid: true }));

      const storage = await createStorage('redis://localhost:6379');
      const result = await storage.get('test-123');

      expect(result).toBeNull();
    });

    it('should return null for invalid envelope mailFrom', async () => {
      mockGet.mockResolvedValue(
        JSON.stringify({
          id: 'test',
          rawData: 'data',
          receivedAt: '2024-01-01',
          size: 100,
          envelope: {
            mailFrom: { invalid: true }, // missing 'address'
            rcptTo: [{ address: 'test@example.com' }]
          }
        })
      );

      const storage = await createStorage('redis://localhost:6379');
      const result = await storage.get('test-123');

      expect(result).toBeNull();
    });

    it('should return null for invalid envelope rcptTo', async () => {
      mockGet.mockResolvedValue(
        JSON.stringify({
          id: 'test',
          rawData: 'data',
          receivedAt: '2024-01-01',
          size: 100,
          envelope: {
            mailFrom: false,
            rcptTo: [{ invalid: true }] // missing 'address'
          }
        })
      );

      const storage = await createStorage('redis://localhost:6379');
      const result = await storage.get('test-123');

      expect(result).toBeNull();
    });

    it('should return null when envelope is not an object', async () => {
      mockGet.mockResolvedValue(
        JSON.stringify({
          id: 'test',
          rawData: 'data',
          receivedAt: '2024-01-01',
          size: 100,
          envelope: 'invalid' // not an object
        })
      );

      const storage = await createStorage('redis://localhost:6379');
      const result = await storage.get('test-123');

      expect(result).toBeNull();
    });

    it('should return null when stored data is not an object', async () => {
      mockGet.mockResolvedValue(JSON.stringify('not an object'));

      const storage = await createStorage('redis://localhost:6379');
      const result = await storage.get('test-123');

      expect(result).toBeNull();
    });

    it('should return null when rcptTo is not an array', async () => {
      mockGet.mockResolvedValue(
        JSON.stringify({
          id: 'test',
          rawData: 'data',
          receivedAt: '2024-01-01',
          size: 100,
          envelope: {
            mailFrom: false,
            rcptTo: 'not an array'
          }
        })
      );

      const storage = await createStorage('redis://localhost:6379');
      const result = await storage.get('test-123');

      expect(result).toBeNull();
    });

    it('should accept email with optional name field', async () => {
      const emailWithName: StoredEmail = {
        id: 'test-456',
        envelope: {
          mailFrom: { address: 'sender@example.com', name: 'Sender Name' },
          rcptTo: [{ address: 'recipient@example.com', name: 'Recipient' }]
        },
        rawData: 'data',
        receivedAt: '2024-01-01',
        size: 100
      };
      mockGet.mockResolvedValue(JSON.stringify(emailWithName));

      const storage = await createStorage('redis://localhost:6379');
      const result = await storage.get('test-456');

      expect(result).toEqual(emailWithName);
    });

    it('should return null when email address name is not a string', async () => {
      mockGet.mockResolvedValue(
        JSON.stringify({
          id: 'test',
          rawData: 'data',
          receivedAt: '2024-01-01',
          size: 100,
          envelope: {
            mailFrom: { address: 'test@example.com', name: 123 }, // name should be string or undefined
            rcptTo: [{ address: 'test@example.com' }]
          }
        })
      );

      const storage = await createStorage('redis://localhost:6379');
      const result = await storage.get('test-123');

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
      mockEval.mockResolvedValue(1);

      const storage = await createStorage('redis://localhost:6379');
      const result = await storage.delete('test-123');

      expect(mockEval).toHaveBeenCalledWith(expect.any(String), {
        keys: ['smtp:email:users:test-123', 'smtp:email:test-123'],
        arguments: ['smtp:emails:', 'test-123']
      });
      expect(result).toBe(true);
    });

    it('should return false for non-existent email', async () => {
      mockEval.mockResolvedValue(0);

      const storage = await createStorage('redis://localhost:6379');
      const result = await storage.delete('non-existent');

      expect(result).toBe(false);
      expect(mockMultiLRem).not.toHaveBeenCalled();
    });
  });

  describe('close', () => {
    it('should close the redis connection using shared closeRedisClient', async () => {
      const { closeRedisClient } = await import('@tearleads/shared/redis');
      const storage = await createStorage('redis://localhost:6379');
      await storage.close();

      expect(closeRedisClient).toHaveBeenCalled();
    });
  });
});
