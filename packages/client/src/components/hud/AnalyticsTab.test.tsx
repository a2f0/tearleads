import { act, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { AnalyticsTab } from './AnalyticsTab';
import { logStore } from '@/stores/logStore';

const mockEvents = [
  {
    id: '1',
    eventName: 'db_setup',
    durationMs: 100,
    success: true,
    timestamp: new Date(),
    detail: null
  }
];

const mockStats = [
  {
    eventName: 'db_setup',
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

vi.mock('@/db/analytics', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/db/analytics')>();
  return {
    ...actual,
    getEvents: vi.fn(),
    getEventStats: vi.fn(),
    getDistinctEventTypes: vi.fn()
  };
});

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

function createDeferred<T>() {
  let resolve: (value: T) => void;
  let reject: (reason?: unknown) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve: resolve!, reject: reject! };
}

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
    mockGetDistinctEventTypes.mockResolvedValue(['db_setup']);

    render(<AnalyticsTab />);

    await waitFor(() => {
      expect(screen.getByText('Database Setup')).toBeInTheDocument();
    });
    await flushPromises();
  });

  it('shows duration chart when events exist', async () => {
    mockUseDatabaseContext.mockReturnValue({ isUnlocked: true });
    mockGetEvents.mockResolvedValue(mockEvents);
    mockGetEventStats.mockResolvedValue(mockStats);
    mockGetDistinctEventTypes.mockResolvedValue(['db_setup']);

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

  it('shows loading message while initial fetch is in flight', async () => {
    const eventsDeferred = createDeferred<typeof mockEvents>();
    const statsDeferred = createDeferred<typeof mockStats>();
    const typesDeferred = createDeferred<string[]>();

    mockUseDatabaseContext.mockReturnValue({ isUnlocked: true });
    mockGetEvents.mockReturnValue(eventsDeferred.promise);
    mockGetEventStats.mockReturnValue(statsDeferred.promise);
    mockGetDistinctEventTypes.mockReturnValue(typesDeferred.promise);

    render(<AnalyticsTab />);

    expect(screen.getByText(/loading/i)).toBeInTheDocument();

    eventsDeferred.resolve([]);
    statsDeferred.resolve([]);
    typesDeferred.resolve([]);

    await flushPromises();
  });

  it('shows loading spinner during refresh when events already exist', async () => {
    const refreshDeferred = createDeferred<typeof mockEvents>();

    mockUseDatabaseContext.mockReturnValue({ isUnlocked: true });
    mockGetEvents.mockResolvedValueOnce(mockEvents);
    mockGetEventStats.mockResolvedValueOnce(mockStats);
    mockGetDistinctEventTypes.mockResolvedValueOnce(['db_setup']);

    render(<AnalyticsTab />);

    await waitFor(() => {
      expect(screen.getByTestId('duration-chart')).toBeInTheDocument();
    });

    mockGetEvents.mockReturnValueOnce(refreshDeferred.promise);
    mockGetEventStats.mockResolvedValueOnce(mockStats);
    mockGetDistinctEventTypes.mockResolvedValueOnce(['db_setup']);

    const refreshButton = screen.getByLabelText(/refresh/i);
    await userEvent.setup().click(refreshButton);

    const icon = refreshButton.querySelector('svg');
    expect(icon).toHaveClass('animate-spin');
    expect(refreshButton).toBeDisabled();
    act(() => {
      refreshButton.onclick?.(new MouseEvent('click'));
    });
    expect(mockGetEvents).toHaveBeenCalledTimes(2);

    refreshDeferred.resolve(mockEvents);

    await flushPromises();
  });

  it('shows summary when more than five event types exist', async () => {
    mockUseDatabaseContext.mockReturnValue({ isUnlocked: true });
    mockGetEvents.mockResolvedValue(mockEvents);
    mockGetEventStats.mockResolvedValue([
      ...mockStats,
      { ...mockStats[0], eventName: 'db_unlock' },
      { ...mockStats[0], eventName: 'db_lock' },
      { ...mockStats[0], eventName: 'db_password_change' },
      { ...mockStats[0], eventName: 'db_session_restore' },
      { ...mockStats[0], eventName: 'db_reset' }
    ]);
    mockGetDistinctEventTypes.mockResolvedValue(['db_setup']);

    render(<AnalyticsTab />);

    await waitFor(() => {
      expect(screen.getByText('+1 more event types')).toBeInTheDocument();
    });
  });

  it('logs errors when analytics fetch fails', async () => {
    const error = new Error('Fetch failed');
    error.stack = 'stack trace';
    const logSpy = vi.spyOn(logStore, 'error');

    mockUseDatabaseContext.mockReturnValue({ isUnlocked: true });
    mockGetEvents.mockRejectedValue(error);
    mockGetEventStats.mockResolvedValue([]);
    mockGetDistinctEventTypes.mockResolvedValue([]);

    render(<AnalyticsTab />);

    await waitFor(() => {
      expect(logSpy).toHaveBeenCalledWith(
        'Failed to fetch HUD analytics',
        'stack trace'
      );
    });

    logSpy.mockRestore();
  });

  it('logs non-Error failures using string fallback', async () => {
    const logSpy = vi.spyOn(logStore, 'error');

    mockUseDatabaseContext.mockReturnValue({ isUnlocked: true });
    mockGetEvents.mockRejectedValue('boom');
    mockGetEventStats.mockResolvedValue([]);
    mockGetDistinctEventTypes.mockResolvedValue([]);

    render(<AnalyticsTab />);

    await waitFor(() => {
      expect(logSpy).toHaveBeenCalledWith(
        'Failed to fetch HUD analytics',
        'boom'
      );
    });

    logSpy.mockRestore();
  });

  it('avoids logging after unmount when fetch completes', async () => {
    const eventsDeferred = createDeferred<typeof mockEvents>();
    const statsDeferred = createDeferred<typeof mockStats>();
    const typesDeferred = createDeferred<string[]>();
    const logSpy = vi.spyOn(logStore, 'error');

    mockUseDatabaseContext.mockReturnValue({ isUnlocked: true });
    mockGetEvents.mockReturnValue(eventsDeferred.promise);
    mockGetEventStats.mockReturnValue(statsDeferred.promise);
    mockGetDistinctEventTypes.mockReturnValue(typesDeferred.promise);

    const { unmount } = render(<AnalyticsTab />);
    unmount();

    eventsDeferred.resolve([]);
    statsDeferred.resolve([]);
    typesDeferred.resolve([]);

    await flushPromises();

    expect(logSpy).not.toHaveBeenCalled();
    logSpy.mockRestore();
  });

  it('avoids logging after unmount when fetch fails', async () => {
    const eventsDeferred = createDeferred<typeof mockEvents>();
    const logSpy = vi.spyOn(logStore, 'error');

    mockUseDatabaseContext.mockReturnValue({ isUnlocked: true });
    mockGetEvents.mockReturnValue(eventsDeferred.promise);
    mockGetEventStats.mockResolvedValue([]);
    mockGetDistinctEventTypes.mockResolvedValue([]);

    const { unmount } = render(<AnalyticsTab />);
    unmount();

    eventsDeferred.reject(new Error('late failure'));

    await flushPromises();

    expect(logSpy).not.toHaveBeenCalled();
    logSpy.mockRestore();
  });
});
