import request from 'supertest';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { app } from '../index.js';
import { mockConsoleError } from '../test/console-mocks.js';

const mockLRange = vi.fn();
const mockLLen = vi.fn();
const mockGet = vi.fn();
const mockMGet = vi.fn();
const mockExec = vi.fn();

const createMockMulti = () => ({
  del: vi.fn().mockReturnThis(),
  lRem: vi.fn().mockReturnThis(),
  exec: mockExec
});

const createMockClient = () => ({
  lRange: mockLRange,
  lLen: mockLLen,
  get: mockGet,
  mGet: mockMGet,
  multi: createMockMulti
});

vi.mock('../lib/redis.js', () => ({
  getRedisClient: vi.fn(() => Promise.resolve(createMockClient()))
}));

const mockStoredEmail = {
  id: 'test-email-1',
  envelope: {
    mailFrom: { address: 'sender@example.com', name: 'Sender Name' },
    rcptTo: [{ address: 'recipient@example.com' }]
  },
  rawData: 'Subject: Test Subject\r\n\r\nEmail body',
  receivedAt: '2024-01-15T10:00:00Z',
  size: 1024
};

const mockEmailNoSubject = {
  id: 'test-email-2',
  envelope: {
    mailFrom: false,
    rcptTo: [{ address: 'recipient@example.com' }]
  },
  rawData: '\r\nEmail body without subject',
  receivedAt: '2024-01-15T10:00:00Z',
  size: 512
};

const mockEmailNoName = {
  id: 'test-email-3',
  envelope: {
    mailFrom: { address: 'sender@example.com' },
    rcptTo: [{ address: 'recipient@example.com' }]
  },
  rawData: 'From: sender@example.com\r\n\r\nEmail without subject line',
  receivedAt: '2024-01-15T10:00:00Z',
  size: 256
};

describe('Emails Routes', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockLRange.mockResolvedValue([]);
    mockLLen.mockResolvedValue(0);
    mockMGet.mockResolvedValue([]);
  });

  describe('GET /v1/emails', () => {
    it('returns empty array when no emails exist', async () => {
      const response = await request(app).get('/v1/emails');

      expect(response.status).toBe(200);
      expect(response.body).toEqual({
        emails: [],
        total: 0,
        offset: 0,
        limit: 50
      });
    });

    it('returns list of emails with parsed metadata', async () => {
      mockLLen.mockResolvedValue(1);
      mockLRange.mockResolvedValue(['test-email-1']);
      mockMGet.mockResolvedValue([JSON.stringify(mockStoredEmail)]);

      const response = await request(app).get('/v1/emails');

      expect(response.status).toBe(200);
      expect(response.body.emails).toHaveLength(1);
      expect(response.body.emails[0]).toEqual({
        id: 'test-email-1',
        from: 'Sender Name <sender@example.com>',
        to: ['recipient@example.com'],
        subject: 'Test Subject',
        receivedAt: '2024-01-15T10:00:00Z',
        size: 1024
      });
      expect(response.body.total).toBe(1);
    });

    it('handles error during fetch', async () => {
      mockConsoleError();
      mockLLen.mockRejectedValue(new Error('Redis error'));

      const response = await request(app).get('/v1/emails');

      expect(response.status).toBe(500);
      expect(response.body).toEqual({ error: 'Failed to list emails' });
    });

    it('handles emails with no subject line', async () => {
      mockLLen.mockResolvedValue(1);
      mockLRange.mockResolvedValue(['test-email-2']);
      mockMGet.mockResolvedValue([JSON.stringify(mockEmailNoSubject)]);

      const response = await request(app).get('/v1/emails');

      expect(response.status).toBe(200);
      expect(response.body.emails[0]).toEqual({
        id: 'test-email-2',
        from: '',
        to: ['recipient@example.com'],
        subject: '',
        receivedAt: '2024-01-15T10:00:00Z',
        size: 512
      });
    });

    it('handles emails with sender address but no name', async () => {
      mockLLen.mockResolvedValue(1);
      mockLRange.mockResolvedValue(['test-email-3']);
      mockMGet.mockResolvedValue([JSON.stringify(mockEmailNoName)]);

      const response = await request(app).get('/v1/emails');

      expect(response.status).toBe(200);
      expect(response.body.emails[0]).toEqual({
        id: 'test-email-3',
        from: 'sender@example.com',
        to: ['recipient@example.com'],
        subject: '',
        receivedAt: '2024-01-15T10:00:00Z',
        size: 256
      });
    });

    it('skips emails that no longer exist in Redis', async () => {
      mockLLen.mockResolvedValue(2);
      mockLRange.mockResolvedValue(['test-email-1', 'missing-email']);
      mockMGet.mockResolvedValue([JSON.stringify(mockStoredEmail), null]);

      const response = await request(app).get('/v1/emails');

      expect(response.status).toBe(200);
      expect(response.body.emails).toHaveLength(1);
    });

    it('supports pagination with offset and limit', async () => {
      mockLLen.mockResolvedValue(100);
      mockLRange.mockResolvedValue(['test-email-1']);
      mockMGet.mockResolvedValue([JSON.stringify(mockStoredEmail)]);

      const response = await request(app).get('/v1/emails?offset=10&limit=20');

      expect(response.status).toBe(200);
      expect(mockLRange).toHaveBeenCalledWith('smtp:emails', 10, 29);
      expect(response.body.total).toBe(100);
      expect(response.body.offset).toBe(10);
      expect(response.body.limit).toBe(20);
    });

    it('clamps limit to maximum of 100', async () => {
      mockLLen.mockResolvedValue(200);
      mockLRange.mockResolvedValue([]);

      const response = await request(app).get('/v1/emails?limit=500');

      expect(response.status).toBe(200);
      expect(mockLRange).toHaveBeenCalledWith('smtp:emails', 0, 99);
      expect(response.body.limit).toBe(100);
    });

    it('clamps offset to minimum of 0', async () => {
      mockLLen.mockResolvedValue(10);
      mockLRange.mockResolvedValue([]);

      const response = await request(app).get('/v1/emails?offset=-5');

      expect(response.status).toBe(200);
      expect(mockLRange).toHaveBeenCalledWith('smtp:emails', 0, 49);
      expect(response.body.offset).toBe(0);
    });
  });

  describe('GET /v1/emails/:id', () => {
    it('returns email by ID', async () => {
      mockGet.mockResolvedValue(JSON.stringify(mockStoredEmail));

      const response = await request(app).get('/v1/emails/test-email-1');

      expect(response.status).toBe(200);
      expect(response.body).toEqual({
        id: 'test-email-1',
        from: 'Sender Name <sender@example.com>',
        to: ['recipient@example.com'],
        subject: 'Test Subject',
        receivedAt: '2024-01-15T10:00:00Z',
        size: 1024,
        rawData: 'Subject: Test Subject\r\n\r\nEmail body'
      });
    });

    it('returns 404 when email not found', async () => {
      mockGet.mockResolvedValue(null);

      const response = await request(app).get('/v1/emails/nonexistent');

      expect(response.status).toBe(404);
      expect(response.body).toEqual({ error: 'Email not found' });
    });

    it('handles error during fetch', async () => {
      mockConsoleError();
      mockGet.mockRejectedValue(new Error('Redis error'));

      const response = await request(app).get('/v1/emails/test-email-1');

      expect(response.status).toBe(500);
      expect(response.body).toEqual({ error: 'Failed to get email' });
    });
  });

  describe('DELETE /v1/emails/:id', () => {
    it('deletes email by ID', async () => {
      // Redis multi/exec returns [error, result] tuples for each command
      mockExec.mockResolvedValue([
        [null, 1],
        [null, 1]
      ]);

      const response = await request(app).delete('/v1/emails/test-email-1');

      expect(response.status).toBe(200);
      expect(response.body).toEqual({ success: true });
    });

    it('returns 404 when email not found', async () => {
      // Redis multi/exec returns [error, result] tuples for each command
      mockExec.mockResolvedValue([
        [null, 0],
        [null, 0]
      ]);

      const response = await request(app).delete('/v1/emails/nonexistent');

      expect(response.status).toBe(404);
      expect(response.body).toEqual({ error: 'Email not found' });
    });

    it('handles error during delete', async () => {
      mockConsoleError();
      mockExec.mockRejectedValue(new Error('Redis error'));

      const response = await request(app).delete('/v1/emails/test-email-1');

      expect(response.status).toBe(500);
      expect(response.body).toEqual({ error: 'Failed to delete email' });
    });
  });
});
