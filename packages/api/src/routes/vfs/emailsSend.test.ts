import request from 'supertest';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { app } from '../../index.js';
import { createAuthHeader } from '../../test/auth.js';

vi.mock('../../lib/emailSender.js', () => ({
  sendEmail: vi.fn(() =>
    Promise.resolve({ success: true, messageId: 'test-message-id' })
  )
}));

describe('VFS email send route', () => {
  let authHeader: string;
  const userId = 'test-user-id';

  beforeEach(async () => {
    vi.stubEnv('JWT_SECRET', 'test-secret');
    authHeader = await createAuthHeader({
      id: userId,
      email: 'test@example.com'
    });
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  describe('POST /v1/vfs/emails/send', () => {
    it('sends an email successfully', async () => {
      const response = await request(app)
        .post('/v1/vfs/emails/send')
        .set('Authorization', authHeader)
        .send({
          to: ['recipient@example.com'],
          subject: 'Test Subject',
          body: 'Test body'
        });

      expect(response.status).toBe(200);
      expect(response.body.success).toBe(true);
      expect(response.body.messageId).toBe('test-message-id');
    });

    it('sends email with cc and bcc', async () => {
      const response = await request(app)
        .post('/v1/vfs/emails/send')
        .set('Authorization', authHeader)
        .send({
          to: ['recipient@example.com'],
          cc: ['cc@example.com'],
          bcc: ['bcc@example.com'],
          subject: 'Test Subject',
          body: 'Test body'
        });

      expect(response.status).toBe(200);
      expect(response.body.success).toBe(true);
    });

    it('sends email with attachments', async () => {
      const response = await request(app)
        .post('/v1/vfs/emails/send')
        .set('Authorization', authHeader)
        .send({
          to: ['recipient@example.com'],
          subject: 'Test Subject',
          body: 'Test body',
          attachments: [
            {
              fileName: 'test.txt',
              mimeType: 'text/plain',
              content: Buffer.from('test content').toString('base64')
            }
          ]
        });

      expect(response.status).toBe(200);
      expect(response.body.success).toBe(true);
    });

    it('returns 400 when no recipients provided', async () => {
      const response = await request(app)
        .post('/v1/vfs/emails/send')
        .set('Authorization', authHeader)
        .send({
          to: [],
          subject: 'Test Subject',
          body: 'Test body'
        });

      expect(response.status).toBe(400);
      expect(response.body.error).toContain('recipient');
    });

    it('returns 400 when subject is empty', async () => {
      const response = await request(app)
        .post('/v1/vfs/emails/send')
        .set('Authorization', authHeader)
        .send({
          to: ['recipient@example.com'],
          subject: '',
          body: 'Test body'
        });

      expect(response.status).toBe(400);
      expect(response.body.error).toContain('Subject');
    });

    it('returns 401 when not authenticated', async () => {
      const response = await request(app)
        .post('/v1/vfs/emails/send')
        .send({
          to: ['recipient@example.com'],
          subject: 'Test Subject',
          body: 'Test body'
        });

      expect(response.status).toBe(401);
    });

    it('handles send failure gracefully', async () => {
      const { sendEmail } = await import('../../lib/emailSender.js');
      vi.mocked(sendEmail).mockResolvedValueOnce({
        success: false,
        error: 'SMTP connection failed'
      });

      const response = await request(app)
        .post('/v1/vfs/emails/send')
        .set('Authorization', authHeader)
        .send({
          to: ['recipient@example.com'],
          subject: 'Test Subject',
          body: 'Test body'
        });

      expect(response.status).toBe(500);
      expect(response.body.error).toContain('SMTP');
    });
  });
});
