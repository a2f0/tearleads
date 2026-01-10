import { describe, expect, it } from 'vitest';
import { isValidMessageType, MessageType } from './messages';

describe('MessageType', () => {
  it('should have GET_TAB_INFO constant', () => {
    expect(MessageType.GET_TAB_INFO).toBe('GET_TAB_INFO');
  });

  it('should have PING constant', () => {
    expect(MessageType.PING).toBe('PING');
  });
});

describe('isValidMessageType', () => {
  it('should return true for valid message types', () => {
    expect(isValidMessageType('GET_TAB_INFO')).toBe(true);
    expect(isValidMessageType('PING')).toBe(true);
  });

  it('should return false for invalid message types', () => {
    expect(isValidMessageType('INVALID')).toBe(false);
    expect(isValidMessageType('')).toBe(false);
    expect(isValidMessageType(null)).toBe(false);
    expect(isValidMessageType(undefined)).toBe(false);
    expect(isValidMessageType(123)).toBe(false);
    expect(isValidMessageType({})).toBe(false);
  });
});
