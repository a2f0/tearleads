import { describe, expect, it } from 'vitest';
import type { EmailItem } from './email';
import {
  buildComposeRequest,
  buildForwardBody,
  buildForwardSubject,
  buildReplyBody,
  buildReplySubject
} from './quoteText';

const baseEmail: EmailItem = {
  id: '1',
  from: 'alice@example.com',
  to: ['bob@example.com'],
  subject: 'Hello',
  receivedAt: '2024-06-15T14:30:00Z',
  size: 1024
};

describe('buildReplySubject', () => {
  it('prepends Re: to a plain subject', () => {
    expect(buildReplySubject('Hello')).toBe('Re: Hello');
  });

  it('does not double-prefix Re:', () => {
    expect(buildReplySubject('Re: Hello')).toBe('Re: Hello');
  });

  it('is case-insensitive for existing Re:', () => {
    expect(buildReplySubject('RE: Hello')).toBe('RE: Hello');
    expect(buildReplySubject('re: Hello')).toBe('re: Hello');
  });

  it('trims whitespace', () => {
    expect(buildReplySubject('  Hello  ')).toBe('Re: Hello');
  });
});

describe('buildForwardSubject', () => {
  it('prepends Fwd: to a plain subject', () => {
    expect(buildForwardSubject('Hello')).toBe('Fwd: Hello');
  });

  it('does not double-prefix Fwd:', () => {
    expect(buildForwardSubject('Fwd: Hello')).toBe('Fwd: Hello');
  });

  it('is case-insensitive for existing Fwd:', () => {
    expect(buildForwardSubject('FWD: Hello')).toBe('FWD: Hello');
  });
});

describe('buildReplyBody', () => {
  it('quotes the original body with attribution', () => {
    const result = buildReplyBody('Hello world', baseEmail);
    expect(result).toContain('alice@example.com wrote:');
    expect(result).toContain('> Hello world');
  });

  it('quotes multi-line bodies line by line', () => {
    const result = buildReplyBody('Line 1\nLine 2\nLine 3', baseEmail);
    expect(result).toContain('> Line 1');
    expect(result).toContain('> Line 2');
    expect(result).toContain('> Line 3');
  });

  it('starts with two blank lines', () => {
    const result = buildReplyBody('Hello', baseEmail);
    expect(result.startsWith('\n\n')).toBe(true);
  });
});

describe('buildForwardBody', () => {
  it('includes forwarded message header block', () => {
    const result = buildForwardBody('Hello world', baseEmail);
    expect(result).toContain('---------- Forwarded message ----------');
    expect(result).toContain('From: alice@example.com');
    expect(result).toContain('Subject: Hello');
    expect(result).toContain('To: bob@example.com');
    expect(result).toContain('Hello world');
  });

  it('includes Cc when present', () => {
    const email: EmailItem = {
      ...baseEmail,
      cc: ['carol@example.com', 'dave@example.com']
    };
    const result = buildForwardBody('Hello', email);
    expect(result).toContain('Cc: carol@example.com, dave@example.com');
  });

  it('omits Cc line when no cc recipients', () => {
    const result = buildForwardBody('Hello', baseEmail);
    expect(result).not.toContain('Cc:');
  });

  it('starts with two blank lines', () => {
    const result = buildForwardBody('Hello', baseEmail);
    expect(result.startsWith('\n\n')).toBe(true);
  });
});

describe('buildComposeRequest', () => {
  it('builds a reply request', () => {
    const result = buildComposeRequest(baseEmail, 'Hello', 'reply');
    expect(result.to).toEqual(['alice@example.com']);
    expect(result.subject).toBe('Re: Hello');
    expect(result.composeMode).toBe('reply');
    expect(result.body).toContain('> Hello');
  });

  it('builds a reply-all request with cc', () => {
    const email: EmailItem = {
      ...baseEmail,
      cc: ['carol@example.com']
    };
    const result = buildComposeRequest(email, 'Hi', 'replyAll');
    expect(result.to).toEqual(['alice@example.com', 'bob@example.com']);
    expect(result.cc).toEqual(['carol@example.com']);
    expect(result.composeMode).toBe('replyAll');
  });

  it('builds a forward request with empty to', () => {
    const result = buildComposeRequest(baseEmail, 'Hello', 'forward');
    expect(result.to).toEqual([]);
    expect(result.subject).toBe('Fwd: Hello');
    expect(result.composeMode).toBe('forward');
    expect(result.body).toContain('Forwarded message');
  });
});
