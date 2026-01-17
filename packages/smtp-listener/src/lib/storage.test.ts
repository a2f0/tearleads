import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { StoredEmail } from '../types/email.js';

const mockSet = vi.fn();
const mockGet = vi.fn();
const mockDel = vi.fn();
const mockLPush = vi.fn();
const mockLRange = vi.fn();
const mockLRem = vi.fn();
const mockCloseRedisClient = vi.fn();

vi.mock('@rapid/shared', () => ({
  getRedisClient: vi.fn(() =>
    Promise.resolve({
      set: mockSet,
      get: mockGet,
      del: mockDel,
      lPush: mockLPush,
      lRange: mockLRange,
      lRem: mockLRem
    })
  ),
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
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  describe('createStorage', () => {
    it('should create a storage instance using shared redis client', async () => {
      const { getRedisClient } = await import('@rapid/shared');
      const storage = await createStorage('redis://localhost:6379');

      expect(getRedisClient).toHaveBeenCalledWith('redis://localhost:6379');
      expect(storage).toBeDefined();
    });

    it('should work without explicit redis URL', async () => {
      const { getRedisClient } = await import('@rapid/shared');
      const storage = await createStorage();

      expect(getRedisClient).toHaveBeenCalledWith(undefined);
      expect(storage).toBeDefined();
    });
  });

  describe('store', () => {
    it('should store an email in redis', async () => {
      mockSet.mockResolvedValue('OK');
      mockLPush.mockResolvedValue(1);

      const storage = await createStorage('redis://localhost:6379');
      await storage.store(testEmail);

      expect(mockSet).toHaveBeenCalledWith(
        'smtp:email:test-123',
        JSON.stringify(testEmail)
      );
      expect(mockLPush).toHaveBeenCalledWith('smtp:emails', 'test-123');
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
      const result = await storage.list();

      expect(mockLRange).toHaveBeenCalledWith('smtp:emails', 0, -1);
      expect(result).toEqual(['id1', 'id2', 'id3']);
    });
  });

  describe('delete', () => {
    it('should delete an email and return true', async () => {
      mockDel.mockResolvedValue(1);
      mockLRem.mockResolvedValue(1);

      const storage = await createStorage('redis://localhost:6379');
      const result = await storage.delete('test-123');

      expect(mockDel).toHaveBeenCalledWith('smtp:email:test-123');
      expect(mockLRem).toHaveBeenCalledWith('smtp:emails', 1, 'test-123');
      expect(result).toBe(true);
    });

    it('should return false for non-existent email', async () => {
      mockDel.mockResolvedValue(0);

      const storage = await createStorage('redis://localhost:6379');
      const result = await storage.delete('non-existent');

      expect(result).toBe(false);
      expect(mockLRem).not.toHaveBeenCalled();
    });
  });

  describe('close', () => {
    it('should close the redis connection using shared closeRedisClient', async () => {
      const { closeRedisClient } = await import('@rapid/shared');
      const storage = await createStorage('redis://localhost:6379');
      await storage.close();

      expect(closeRedisClient).toHaveBeenCalled();
    });
  });
});
