import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { mockConsoleError } from '../test/console-mocks.js';
import {
  getEmailTransporter,
  resetEmailTransporter,
  sendEmail,
  verifySmtpConnection
} from './emailSender.js';

const mockSendMail = vi.fn();
const mockVerify = vi.fn();

vi.mock('nodemailer', () => ({
  default: {
    createTransport: vi.fn(() => ({
      sendMail: mockSendMail,
      verify: mockVerify
    }))
  }
}));

describe('emailSender', () => {
  beforeEach(() => {
    resetEmailTransporter();
    vi.clearAllMocks();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  describe('getEmailTransporter', () => {
    it('creates transporter with default config', () => {
      const transporter = getEmailTransporter();
      expect(transporter).toBeDefined();
    });

    it('reuses existing transporter', () => {
      const transporter1 = getEmailTransporter();
      const transporter2 = getEmailTransporter();
      expect(transporter1).toBe(transporter2);
    });

    it('creates new transporter after reset', () => {
      const transporter1 = getEmailTransporter();
      resetEmailTransporter();
      const transporter2 = getEmailTransporter();
      expect(transporter1).not.toBe(transporter2);
    });
  });

  describe('sendEmail', () => {
    it('sends email successfully', async () => {
      mockSendMail.mockResolvedValue({ messageId: 'test-id-123' });

      const result = await sendEmail({
        to: ['recipient@example.com'],
        subject: 'Test Subject',
        text: 'Test body'
      });

      expect(result.success).toBe(true);
      expect(result.messageId).toBe('test-id-123');
    });

    it('sends email with all fields', async () => {
      mockSendMail.mockResolvedValue({ messageId: 'test-id-456' });

      const result = await sendEmail({
        from: 'sender@example.com',
        to: ['recipient1@example.com', 'recipient2@example.com'],
        cc: ['cc@example.com'],
        bcc: ['bcc@example.com'],
        subject: 'Test Subject',
        text: 'Test body',
        attachments: [
          {
            filename: 'test.txt',
            content: Buffer.from('test content'),
            contentType: 'text/plain'
          }
        ]
      });

      expect(result.success).toBe(true);
      expect(mockSendMail).toHaveBeenCalledWith(
        expect.objectContaining({
          from: 'sender@example.com',
          to: 'recipient1@example.com, recipient2@example.com',
          cc: 'cc@example.com',
          bcc: 'bcc@example.com',
          subject: 'Test Subject',
          text: 'Test body'
        })
      );
    });

    it('uses default from address when not provided', async () => {
      mockSendMail.mockResolvedValue({ messageId: 'test-id' });

      await sendEmail({
        to: ['recipient@example.com'],
        subject: 'Test',
        text: 'Body'
      });

      expect(mockSendMail).toHaveBeenCalledWith(
        expect.objectContaining({
          from: expect.stringContaining('@')
        })
      );
    });

    it('handles send failure', async () => {
      mockConsoleError();
      mockSendMail.mockRejectedValue(new Error('Connection refused'));

      const result = await sendEmail({
        to: ['recipient@example.com'],
        subject: 'Test',
        text: 'Body'
      });

      expect(result.success).toBe(false);
      expect(result.error).toBe('Connection refused');
    });

    it('handles non-Error rejection', async () => {
      mockConsoleError();
      mockSendMail.mockRejectedValue('Unknown error');

      const result = await sendEmail({
        to: ['recipient@example.com'],
        subject: 'Test',
        text: 'Body'
      });

      expect(result.success).toBe(false);
      expect(result.error).toBe('Unknown error');
    });
  });

  describe('verifySmtpConnection', () => {
    it('returns true when connection is valid', async () => {
      mockVerify.mockResolvedValue(true);

      const result = await verifySmtpConnection();

      expect(result).toBe(true);
    });

    it('returns false when connection fails', async () => {
      mockVerify.mockRejectedValue(new Error('Connection failed'));

      const result = await verifySmtpConnection();

      expect(result).toBe(false);
    });
  });
});
