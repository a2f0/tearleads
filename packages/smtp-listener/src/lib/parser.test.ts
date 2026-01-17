import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createStoredEmail, generateEmailId, parseAddress } from './parser.js';

describe('parser', () => {
  describe('generateEmailId', () => {
    it('should generate a unique id with timestamp and random suffix', () => {
      const id = generateEmailId();
      expect(id).toMatch(/^[a-z0-9]+-[a-z0-9]+$/);
    });

    it('should generate different ids on subsequent calls', () => {
      const id1 = generateEmailId();
      const id2 = generateEmailId();
      expect(id1).not.toBe(id2);
    });
  });

  describe('parseAddress', () => {
    it('should parse a simple email address', () => {
      const result = parseAddress('test@example.com');
      expect(result).toEqual({ address: 'test@example.com' });
    });

    it('should parse an email address with angle brackets', () => {
      const result = parseAddress('<test@example.com>');
      expect(result).toEqual({ address: 'test@example.com' });
    });

    it('should parse an email address with name and angle brackets', () => {
      const result = parseAddress('John Doe <john@example.com>');
      expect(result).toEqual({ address: 'john@example.com', name: 'John Doe' });
    });

    it('should parse an email address with quoted name', () => {
      const result = parseAddress('"John Doe" <john@example.com>');
      expect(result).toEqual({ address: 'john@example.com', name: 'John Doe' });
    });

    it('should handle addresses with whitespace', () => {
      const result = parseAddress('  test@example.com  ');
      expect(result).toEqual({ address: 'test@example.com' });
    });

    it('should handle empty name gracefully', () => {
      const result = parseAddress('"" <test@example.com>');
      expect(result).toEqual({ address: 'test@example.com' });
    });

    it('should fallback to trimmed address when regex does not match', () => {
      const result = parseAddress('');
      expect(result).toEqual({ address: '' });
    });

    it('should fallback when address part is only whitespace', () => {
      const result = parseAddress('< >');
      expect(result).toEqual({ address: '< >' });
    });
  });

  describe('createStoredEmail', () => {
    beforeEach(() => {
      vi.useFakeTimers();
      vi.setSystemTime(new Date('2024-01-15T10:30:00.000Z'));
    });

    afterEach(() => {
      vi.useRealTimers();
    });

    it('should create a stored email with all fields', () => {
      const envelope = {
        mailFrom: { address: 'sender@example.com' },
        rcptTo: [{ address: 'recipient@example.com' }]
      };
      const rawData = 'Subject: Test\r\n\r\nHello World';

      const result = createStoredEmail(envelope, rawData);

      expect(result.envelope).toEqual(envelope);
      expect(result.rawData).toBe(rawData);
      expect(result.receivedAt).toBe('2024-01-15T10:30:00.000Z');
      expect(result.size).toBe(Buffer.byteLength(rawData, 'utf8'));
      expect(result.id).toMatch(/^[a-z0-9]+-[a-z0-9]+$/);
    });

    it('should calculate size correctly for unicode content', () => {
      const envelope = {
        mailFrom: { address: 'sender@example.com' },
        rcptTo: [{ address: 'recipient@example.com' }]
      };
      const rawData = 'Subject: Test\r\n\r\nHello 世界';

      const result = createStoredEmail(envelope, rawData);

      expect(result.size).toBe(Buffer.byteLength(rawData, 'utf8'));
    });
  });
});
