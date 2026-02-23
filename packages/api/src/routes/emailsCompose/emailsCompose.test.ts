import request from 'supertest';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { app } from '../../index.js';
import { createAuthHeader } from '../../test/auth.js';
import { mockConsoleError } from '../../test/consoleMocks.js';

vi.mock('../../lib/emailSender.js', () => ({
  sendEmail: vi.fn(() =>
    Promise.resolve({ success: true, messageId: 'test-message-id' })
  )
}));

describe('emailsCompose routes', () => {
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

  describe('POST /v1/emails/drafts', () => {
    it('creates a new draft when no id is provided', async () => {
      const response = await request(app)
        .post('/v1/emails/drafts')
        .set('Authorization', authHeader)
        .send({
          to: ['test@example.com'],
          subject: 'Test Subject',
          body: 'Test body'
        });

      expect(response.status).toBe(200);
      expect(response.body).toHaveProperty('id');
      expect(response.body).toHaveProperty('updatedAt');
    });

    it('updates an existing draft when id is provided', async () => {
      const createResponse = await request(app)
        .post('/v1/emails/drafts')
        .set('Authorization', authHeader)
        .send({
          to: ['test@example.com'],
          subject: 'Original Subject',
          body: 'Original body'
        });

      const draftId = createResponse.body.id;

      const updateResponse = await request(app)
        .post('/v1/emails/drafts')
        .set('Authorization', authHeader)
        .send({
          id: draftId,
          subject: 'Updated Subject'
        });

      expect(updateResponse.status).toBe(200);
      expect(updateResponse.body.id).toBe(draftId);
    });

    it('returns 401 when not authenticated', async () => {
      const response = await request(app)
        .post('/v1/emails/drafts')
        .send({
          to: ['test@example.com'],
          subject: 'Test Subject'
        });

      expect(response.status).toBe(401);
    });

    it('handles errors gracefully', async () => {
      mockConsoleError();
      const response = await request(app)
        .post('/v1/emails/drafts')
        .set('Authorization', authHeader)
        .send({});

      expect(response.status).toBe(200);
    });
  });

  describe('GET /v1/emails/drafts', () => {
    it('returns empty list when no drafts exist', async () => {
      const response = await request(app)
        .get('/v1/emails/drafts')
        .set('Authorization', authHeader);

      expect(response.status).toBe(200);
      expect(response.body).toHaveProperty('drafts');
      expect(Array.isArray(response.body.drafts)).toBe(true);
    });

    it('returns list of drafts after creation', async () => {
      await request(app)
        .post('/v1/emails/drafts')
        .set('Authorization', authHeader)
        .send({
          to: ['test@example.com'],
          subject: 'Test Draft'
        });

      const response = await request(app)
        .get('/v1/emails/drafts')
        .set('Authorization', authHeader);

      expect(response.status).toBe(200);
      expect(response.body.drafts.length).toBeGreaterThan(0);
    });

    it('returns 401 when not authenticated', async () => {
      const response = await request(app).get('/v1/emails/drafts');

      expect(response.status).toBe(401);
    });
  });

  describe('GET /v1/emails/drafts/:id', () => {
    it('returns a draft by id', async () => {
      const createResponse = await request(app)
        .post('/v1/emails/drafts')
        .set('Authorization', authHeader)
        .send({
          to: ['test@example.com'],
          subject: 'Test Subject',
          body: 'Test body'
        });

      const draftId = createResponse.body.id;

      const response = await request(app)
        .get(`/v1/emails/drafts/${draftId}`)
        .set('Authorization', authHeader);

      expect(response.status).toBe(200);
      expect(response.body.id).toBe(draftId);
      expect(response.body.subject).toBe('Test Subject');
    });

    it('returns 404 for non-existent draft', async () => {
      const response = await request(app)
        .get('/v1/emails/drafts/non-existent-id')
        .set('Authorization', authHeader);

      expect(response.status).toBe(404);
    });

    it('returns 401 when not authenticated', async () => {
      const response = await request(app).get('/v1/emails/drafts/some-id');

      expect(response.status).toBe(401);
    });
  });

  describe('DELETE /v1/emails/drafts/:id', () => {
    it('deletes a draft by id', async () => {
      const createResponse = await request(app)
        .post('/v1/emails/drafts')
        .set('Authorization', authHeader)
        .send({
          to: ['test@example.com'],
          subject: 'Test Subject'
        });

      const draftId = createResponse.body.id;

      const deleteResponse = await request(app)
        .delete(`/v1/emails/drafts/${draftId}`)
        .set('Authorization', authHeader);

      expect(deleteResponse.status).toBe(200);
      expect(deleteResponse.body.success).toBe(true);

      const getResponse = await request(app)
        .get(`/v1/emails/drafts/${draftId}`)
        .set('Authorization', authHeader);

      expect(getResponse.status).toBe(404);
    });

    it('returns 404 for non-existent draft', async () => {
      const response = await request(app)
        .delete('/v1/emails/drafts/non-existent-id')
        .set('Authorization', authHeader);

      expect(response.status).toBe(404);
    });

    it('returns 401 when not authenticated', async () => {
      const response = await request(app).delete('/v1/emails/drafts/some-id');

      expect(response.status).toBe(401);
    });
  });

  describe('POST /v1/emails/send', () => {
    it('sends an email successfully', async () => {
      const response = await request(app)
        .post('/v1/emails/send')
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
        .post('/v1/emails/send')
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
        .post('/v1/emails/send')
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

    it('deletes draft after sending if draftId provided', async () => {
      const createResponse = await request(app)
        .post('/v1/emails/drafts')
        .set('Authorization', authHeader)
        .send({
          to: ['recipient@example.com'],
          subject: 'Draft Subject'
        });

      const draftId = createResponse.body.id;

      await request(app)
        .post('/v1/emails/send')
        .set('Authorization', authHeader)
        .send({
          draftId,
          to: ['recipient@example.com'],
          subject: 'Draft Subject',
          body: 'Body'
        });

      const getResponse = await request(app)
        .get(`/v1/emails/drafts/${draftId}`)
        .set('Authorization', authHeader);

      expect(getResponse.status).toBe(404);
    });

    it('returns 400 when no recipients provided', async () => {
      const response = await request(app)
        .post('/v1/emails/send')
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
        .post('/v1/emails/send')
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
        .post('/v1/emails/send')
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
        .post('/v1/emails/send')
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
