import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
  clearLastConversationId,
  readLastConversationId,
  saveLastConversationId
} from './conversationResumeStorage';

describe('conversationResumeStorage', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
    localStorage.clear();
  });

  it('uses an instance-specific key when instanceId is provided', () => {
    saveLastConversationId('conversation-1', 'instance-1');

    expect(
      localStorage.getItem('tearleads_last_ai_conversation_instance-1')
    ).toBe('conversation-1');
    expect(readLastConversationId('instance-1')).toBe('conversation-1');

    clearLastConversationId('instance-1');
    expect(
      localStorage.getItem('tearleads_last_ai_conversation_instance-1')
    ).toBeNull();
  });

  it('uses the default key when instanceId is omitted', () => {
    saveLastConversationId('conversation-2');

    expect(localStorage.getItem('tearleads_last_ai_conversation')).toBe(
      'conversation-2'
    );
    expect(readLastConversationId()).toBe('conversation-2');

    clearLastConversationId();
    expect(localStorage.getItem('tearleads_last_ai_conversation')).toBeNull();
  });

  it('returns null when localStorage read fails', () => {
    vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => {
      throw new Error('read failed');
    });

    expect(readLastConversationId('instance-1')).toBeNull();
  });

  it('swallows localStorage write and delete errors', () => {
    vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
      throw new Error('write failed');
    });
    vi.spyOn(Storage.prototype, 'removeItem').mockImplementation(() => {
      throw new Error('delete failed');
    });

    expect(() => saveLastConversationId('conversation-3', 'instance-1')).not
      .toThrow();
    expect(() => clearLastConversationId('instance-1')).not.toThrow();
  });
});
