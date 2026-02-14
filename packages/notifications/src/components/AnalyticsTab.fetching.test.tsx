import { render } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

vi.mock('react', async (importOriginal) => {
  const actual = await importOriginal<typeof import('react')>();
  return {
    ...actual,
    useRef: () => ({ current: true })
  };
});

vi.mock('@/db/hooks', () => ({
  useDatabaseContext: () => ({ isUnlocked: true })
}));

vi.mock('@/db', () => ({
  getDatabase: vi.fn(() => ({}))
}));

vi.mock('@/db/analytics', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/db/analytics')>();
  return {
    ...actual,
    getEvents: vi.fn(),
    getEventStats: vi.fn(),
    getDistinctEventTypes: vi.fn()
  };
});

import { getEvents } from '@/db/analytics';
import { AnalyticsTab } from './AnalyticsTab';

describe('AnalyticsTab fetching guard', () => {
  it('skips fetch when a request is already in progress', () => {
    render(<AnalyticsTab />);

    expect(getEvents).not.toHaveBeenCalled();
  });
});
