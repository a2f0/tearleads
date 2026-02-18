import { render } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { setAnalyticsDependencies } from '../lib/analyticsDependencies';

vi.mock('react', async (importOriginal) => {
  const actual = await importOriginal<typeof import('react')>();
  return {
    ...actual,
    useRef: () => ({ current: true })
  };
});

import { AnalyticsTab } from './AnalyticsTab';

describe('AnalyticsTab fetching guard', () => {
  it('skips fetch when a request is already in progress', () => {
    const mockGetEvents = vi.fn();
    setAnalyticsDependencies({
      useDatabaseContext: () => ({ isUnlocked: true }),
      getDatabase: () => ({}),
      getEvents: (db, options) => mockGetEvents(db, options),
      getEventStats: async () => [],
      getDistinctEventTypes: async () => [],
      getEventDisplayName: (eventName) => eventName,
      formatDuration: (durationMs) => `${durationMs}ms`,
      logError: () => {},
      DurationChart: () => null
    });

    render(<AnalyticsTab />);

    expect(mockGetEvents).not.toHaveBeenCalled();
  });
});
