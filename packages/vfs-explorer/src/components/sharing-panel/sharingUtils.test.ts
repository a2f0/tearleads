import { describe, expect, it } from 'vitest';
import {
  formatRelativeTime,
  isExpired,
  isExpiringSoon,
  sharedByLabel
} from './sharingUtils';

describe('formatRelativeTime', () => {
  it('returns "Just now" for very recent dates', () => {
    const now = new Date().toISOString();
    expect(formatRelativeTime(now)).toBe('Just now');
  });

  it('returns minutes ago', () => {
    const fiveMinAgo = new Date(Date.now() - 5 * 60_000).toISOString();
    expect(formatRelativeTime(fiveMinAgo)).toBe('5m ago');
  });

  it('returns hours ago', () => {
    const twoHoursAgo = new Date(Date.now() - 2 * 3_600_000).toISOString();
    expect(formatRelativeTime(twoHoursAgo)).toBe('2h ago');
  });

  it('returns days ago', () => {
    const threeDaysAgo = new Date(Date.now() - 3 * 86_400_000).toISOString();
    expect(formatRelativeTime(threeDaysAgo)).toBe('3d ago');
  });

  it('returns weeks ago', () => {
    const twoWeeksAgo = new Date(Date.now() - 14 * 86_400_000).toISOString();
    expect(formatRelativeTime(twoWeeksAgo)).toBe('2w ago');
  });
});

describe('isExpiringSoon', () => {
  it('returns false for null expiration', () => {
    expect(isExpiringSoon(null)).toBe(false);
  });

  it('returns true when expiring within 7 days', () => {
    const inThreeDays = new Date(
      Date.now() + 3 * 86_400_000
    ).toISOString();
    expect(isExpiringSoon(inThreeDays)).toBe(true);
  });

  it('returns false when expiring after 7 days', () => {
    const inTenDays = new Date(
      Date.now() + 10 * 86_400_000
    ).toISOString();
    expect(isExpiringSoon(inTenDays)).toBe(false);
  });
});

describe('isExpired', () => {
  it('returns false for null', () => {
    expect(isExpired(null)).toBe(false);
  });

  it('returns true for past date', () => {
    const yesterday = new Date(Date.now() - 86_400_000).toISOString();
    expect(isExpired(yesterday)).toBe(true);
  });

  it('returns false for future date', () => {
    const tomorrow = new Date(Date.now() + 86_400_000).toISOString();
    expect(isExpired(tomorrow)).toBe(false);
  });
});

describe('sharedByLabel', () => {
  it('returns "Shared by you" for current user', () => {
    expect(sharedByLabel('user-1', 'user-1')).toBe('Shared by you');
  });

  it('returns "Shared by <id>" for other users', () => {
    expect(sharedByLabel('user-2', 'user-1')).toBe('Shared by user-2');
  });

  it('returns "Shared by <id>" when currentUserId is undefined', () => {
    expect(sharedByLabel('user-2', undefined)).toBe('Shared by user-2');
  });
});
