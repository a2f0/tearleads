import { act, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { AnalyticsTab } from './AnalyticsTab';

const mockEvents = [
  {
    id: '1',
    eventName: 'db_test_event',
    durationMs: 100,
    success: true,
    timestamp: new Date()
  }
];

const mockStats = [
  {
    eventName: 'db_test_event',
    count: 5,
    avgDurationMs: 100,
    minDurationMs: 50,
    maxDurationMs: 150,
    successRate: 100
  }
];

vi.mock('@/db/hooks', () => ({
  useDatabaseContext: vi.fn()
}));

vi.mock('@/db', () => ({
  getDatabase: vi.fn(() => ({}))
}));

vi.mock('@/db/analytics', () => ({
  getEvents: vi.fn(),
  getEventStats: vi.fn(),
  getDistinctEventTypes: vi.fn()
}));

vi.mock('@/components/duration-chart', () => ({
  DurationChart: () => <div data-testid="duration-chart">Duration Chart</div>
}));

import {
  getDistinctEventTypes,
  getEventStats,
  getEvents
} from '@/db/analytics';
import { useDatabaseContext } from '@/db/hooks';

const mockUseDatabaseContext = useDatabaseContext as ReturnType<typeof vi.fn>;
const mockGetEvents = getEvents as ReturnType<typeof vi.fn>;
const mockGetEventStats = getEventStats as ReturnType<typeof vi.fn>;
const mockGetDistinctEventTypes = getDistinctEventTypes as ReturnType<
  typeof vi.fn
>;

async function flushPromises(): Promise<void> {
  await act(() => new Promise((resolve) => setTimeout(resolve, 0)));
}

describe('AnalyticsTab', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('shows database locked message when not unlocked', async () => {
    mockUseDatabaseContext.mockReturnValue({ isUnlocked: false });

    render(<AnalyticsTab />);
    await flushPromises();

    expect(screen.getByText(/database locked/i)).toBeInTheDocument();
  });

  it('shows no events message when data is empty', async () => {
    mockUseDatabaseContext.mockReturnValue({ isUnlocked: true });
    mockGetEvents.mockResolvedValue([]);
    mockGetEventStats.mockResolvedValue([]);
    mockGetDistinctEventTypes.mockResolvedValue([]);

    render(<AnalyticsTab />);

    await waitFor(() => {
      expect(
        screen.getByText(/no events in the last hour/i)
      ).toBeInTheDocument();
    });
    await flushPromises();
  });

  it('displays stats when available', async () => {
    mockUseDatabaseContext.mockReturnValue({ isUnlocked: true });
    mockGetEvents.mockResolvedValue(mockEvents);
    mockGetEventStats.mockResolvedValue(mockStats);
    mockGetDistinctEventTypes.mockResolvedValue(['db_test_event']);

    render(<AnalyticsTab />);

    await waitFor(() => {
      expect(screen.getByText(/test event/i)).toBeInTheDocument();
    });
    await flushPromises();
  });

  it('shows duration chart when events exist', async () => {
    mockUseDatabaseContext.mockReturnValue({ isUnlocked: true });
    mockGetEvents.mockResolvedValue(mockEvents);
    mockGetEventStats.mockResolvedValue(mockStats);
    mockGetDistinctEventTypes.mockResolvedValue(['db_test_event']);

    render(<AnalyticsTab />);

    await waitFor(() => {
      expect(screen.getByTestId('duration-chart')).toBeInTheDocument();
    });
    await flushPromises();
  });

  it('refreshes data when refresh button is clicked', async () => {
    const user = userEvent.setup();
    mockUseDatabaseContext.mockReturnValue({ isUnlocked: true });
    mockGetEvents.mockResolvedValue([]);
    mockGetEventStats.mockResolvedValue([]);
    mockGetDistinctEventTypes.mockResolvedValue([]);

    render(<AnalyticsTab />);

    await waitFor(() => {
      expect(
        screen.getByRole('button', { name: /refresh/i })
      ).toBeInTheDocument();
    });

    mockGetEvents.mockClear();
    await user.click(screen.getByRole('button', { name: /refresh/i }));

    await waitFor(() => {
      expect(mockGetEvents).toHaveBeenCalled();
    });
    await flushPromises();
  });
});
