import request from 'supertest';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { app } from '../index.js';
import { mockConsoleError } from '../test/console-mocks.js';

interface MockRedisClient {
  lRange: typeof mockLRange;
  get: typeof mockGet;
  del: typeof mockDel;
  lRem: typeof mockLRem;
}

const mockLRange = vi.fn();
const mockGet = vi.fn();
const mockDel = vi.fn();
const mockLRem = vi.fn();

const createMockClient = (): MockRedisClient => ({
  lRange: mockLRange,
  get: mockGet,
  del: mockDel,
  lRem: mockLRem
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
  });

  describe('GET /v1/emails', () => {
    it('returns empty array when no emails exist', async () => {
      const response = await request(app).get('/v1/emails');

      expect(response.status).toBe(200);
      expect(response.body).toEqual({ emails: [] });
    });

    it('returns list of emails with parsed metadata', async () => {
      mockLRange.mockResolvedValue(['test-email-1']);
      mockGet.mockResolvedValue(JSON.stringify(mockStoredEmail));

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
    });

    it('handles error during fetch', async () => {
      mockConsoleError();
      mockLRange.mockRejectedValue(new Error('Redis error'));

      const response = await request(app).get('/v1/emails');

      expect(response.status).toBe(500);
      expect(response.body).toEqual({ error: 'Failed to list emails' });
    });

    it('handles emails with no subject line', async () => {
      mockLRange.mockResolvedValue(['test-email-2']);
      mockGet.mockResolvedValue(JSON.stringify(mockEmailNoSubject));

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
      mockLRange.mockResolvedValue(['test-email-3']);
      mockGet.mockResolvedValue(JSON.stringify(mockEmailNoName));

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
      mockLRange.mockResolvedValue(['test-email-1', 'missing-email']);
      mockGet
        .mockResolvedValueOnce(JSON.stringify(mockStoredEmail))
        .mockResolvedValueOnce(null);

      const response = await request(app).get('/v1/emails');

      expect(response.status).toBe(200);
      expect(response.body.emails).toHaveLength(1);
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
      mockDel.mockResolvedValue(1);
      mockLRem.mockResolvedValue(1);

      const response = await request(app).delete('/v1/emails/test-email-1');

      expect(response.status).toBe(200);
      expect(response.body).toEqual({ success: true });
      expect(mockLRem).toHaveBeenCalledWith('smtp:emails', 1, 'test-email-1');
    });

    it('returns 404 when email not found', async () => {
      mockDel.mockResolvedValue(0);

      const response = await request(app).delete('/v1/emails/nonexistent');

      expect(response.status).toBe(404);
      expect(response.body).toEqual({ error: 'Email not found' });
    });

    it('handles error during delete', async () => {
      mockConsoleError();
      mockDel.mockRejectedValue(new Error('Redis error'));

      const response = await request(app).delete('/v1/emails/test-email-1');

      expect(response.status).toBe(500);
      expect(response.body).toEqual({ error: 'Failed to delete email' });
    });
  });
});
