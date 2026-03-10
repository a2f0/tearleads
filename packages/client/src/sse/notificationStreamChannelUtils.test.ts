import { describe, expect, it } from 'vitest';
import {
  areSameChannels,
  diffChannels,
  normalizeChannels
} from './notificationStreamChannelUtils';

describe('notificationStreamChannelUtils', () => {
  it('normalizes channels by de-duplicating and sorting', () => {
    expect(normalizeChannels(['broadcast', 'vfs:alpha', 'broadcast'])).toEqual([
      'broadcast',
      'vfs:alpha'
    ]);
  });

  it('compares channels using strict order and values', () => {
    expect(areSameChannels(['a', 'b'], ['a', 'b'])).toBe(true);
    expect(areSameChannels(['a', 'b'], ['b', 'a'])).toBe(false);
    expect(areSameChannels(['a'], ['a', 'b'])).toBe(false);
  });

  it('diffs channels into added and removed groups', () => {
    expect(
      diffChannels(['broadcast', 'vfs:old'], ['broadcast', 'vfs:new'])
    ).toEqual({
      added: ['vfs:new'],
      removed: ['vfs:old']
    });
  });
});
