import { describe, expect, it } from 'vitest';
import {
  createSmtpListener,
  createStorage,
  createStoredEmail,
  generateEmailId,
  parseAddress
} from './index.js';

describe('index exports', () => {
  it('should export createSmtpListener', () => {
    expect(createSmtpListener).toBeDefined();
    expect(typeof createSmtpListener).toBe('function');
  });

  it('should export createStorage', () => {
    expect(createStorage).toBeDefined();
    expect(typeof createStorage).toBe('function');
  });

  it('should export createStoredEmail', () => {
    expect(createStoredEmail).toBeDefined();
    expect(typeof createStoredEmail).toBe('function');
  });

  it('should export generateEmailId', () => {
    expect(generateEmailId).toBeDefined();
    expect(typeof generateEmailId).toBe('function');
  });

  it('should export parseAddress', () => {
    expect(parseAddress).toBeDefined();
    expect(typeof parseAddress).toBe('function');
  });
});
