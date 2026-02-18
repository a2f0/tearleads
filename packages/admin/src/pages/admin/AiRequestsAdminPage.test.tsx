import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { AiRequestsAdminPage } from './AiRequestsAdminPage';

const mockGetUsage = vi.fn();

vi.mock('@/lib/api', () => ({
  api: {
    ai: {
      getUsage: (options?: {
        startDate?: string;
        endDate?: string;
        cursor?: string;
        limit?: number;
      }) => mockGetUsage(options)
    }
  }
}));

describe('AiRequestsAdminPage', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('renders first page of AI usage rows with request IDs and token usage', async () => {
    mockGetUsage.mockResolvedValueOnce({
      usage: [
        {
          id: 'usage-1',
          conversationId: null,
          messageId: null,
          userId: 'user-1',
          organizationId: null,
          modelId: 'openai/gpt-4o-mini',
          promptTokens: 120,
          completionTokens: 80,
          totalTokens: 200,
          openrouterRequestId: 'req-1',
          createdAt: '2026-02-09T12:00:00.000Z'
        }
      ],
      summary: {
        totalPromptTokens: 120,
        totalCompletionTokens: 80,
        totalTokens: 200,
        requestCount: 1,
        periodStart: '2026-02-01T00:00:00.000Z',
        periodEnd: '2026-02-09T23:59:59.999Z'
      },
      hasMore: true,
      cursor: 'cursor-2'
    });

    render(
      <MemoryRouter>
        <AiRequestsAdminPage />
      </MemoryRouter>
    );

    expect(
      await screen.findByRole('heading', { name: 'AI Requests Admin' })
    ).toBeInTheDocument();
    expect(screen.getByText('usage-1')).toBeInTheDocument();
    expect(screen.getByText('req-1')).toBeInTheDocument();
    expect(
      screen.getByRole('button', { name: 'Load more' })
    ).toBeInTheDocument();

    expect(mockGetUsage).toHaveBeenCalledTimes(1);
    expect(mockGetUsage).toHaveBeenCalledWith({ limit: 100 });
  });

  it('loads more data when Load more button is clicked', async () => {
    const user = userEvent.setup();
    mockGetUsage
      .mockResolvedValueOnce({
        usage: [
          {
            id: 'usage-1',
            conversationId: null,
            messageId: null,
            userId: 'user-1',
            organizationId: null,
            modelId: 'openai/gpt-4o-mini',
            promptTokens: 120,
            completionTokens: 80,
            totalTokens: 200,
            openrouterRequestId: 'req-1',
            createdAt: '2026-02-09T12:00:00.000Z'
          }
        ],
        summary: {
          totalPromptTokens: 120,
          totalCompletionTokens: 80,
          totalTokens: 200,
          requestCount: 1,
          periodStart: '2026-02-01T00:00:00.000Z',
          periodEnd: '2026-02-09T23:59:59.999Z'
        },
        hasMore: true,
        cursor: 'cursor-2'
      })
      .mockResolvedValueOnce({
        usage: [
          {
            id: 'usage-2',
            conversationId: null,
            messageId: null,
            userId: 'user-2',
            organizationId: null,
            modelId: 'openai/gpt-4o',
            promptTokens: 50,
            completionTokens: 40,
            totalTokens: 90,
            openrouterRequestId: null,
            createdAt: '2026-02-09T12:10:00.000Z'
          }
        ],
        summary: {
          totalPromptTokens: 50,
          totalCompletionTokens: 40,
          totalTokens: 90,
          requestCount: 1,
          periodStart: '2026-02-01T00:00:00.000Z',
          periodEnd: '2026-02-09T23:59:59.999Z'
        },
        hasMore: false,
        cursor: undefined
      });

    render(
      <MemoryRouter>
        <AiRequestsAdminPage />
      </MemoryRouter>
    );

    await screen.findByText('usage-1');
    expect(screen.queryByText('usage-2')).not.toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: 'Load more' }));

    expect(await screen.findByText('usage-2')).toBeInTheDocument();
    expect(screen.getByText('N/A')).toBeInTheDocument();
    expect(
      screen.queryByRole('button', { name: 'Load more' })
    ).not.toBeInTheDocument();

    expect(mockGetUsage).toHaveBeenNthCalledWith(1, { limit: 100 });
    expect(mockGetUsage).toHaveBeenNthCalledWith(2, {
      cursor: 'cursor-2',
      limit: 100
    });
  });

  it('shows error when API request fails', async () => {
    const consoleSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    mockGetUsage.mockRejectedValueOnce(new Error('Failed to load usage'));

    render(
      <MemoryRouter>
        <AiRequestsAdminPage />
      </MemoryRouter>
    );

    await waitFor(() => {
      expect(screen.getByText('Failed to load usage')).toBeInTheDocument();
    });

    consoleSpy.mockRestore();
  });

  it('refreshes usage data when refresh is clicked', async () => {
    const user = userEvent.setup();
    mockGetUsage.mockResolvedValue({
      usage: [
        {
          id: 'usage-1',
          conversationId: null,
          messageId: null,
          userId: 'user-1',
          organizationId: null,
          modelId: 'openai/gpt-4o-mini',
          promptTokens: 1,
          completionTokens: 1,
          totalTokens: 2,
          openrouterRequestId: 'req-1',
          createdAt: '2026-02-09T12:00:00.000Z'
        }
      ],
      summary: {
        totalPromptTokens: 1,
        totalCompletionTokens: 1,
        totalTokens: 2,
        requestCount: 1,
        periodStart: '2026-02-01T00:00:00.000Z',
        periodEnd: '2026-02-09T23:59:59.999Z'
      },
      hasMore: false,
      cursor: undefined
    });

    render(
      <MemoryRouter>
        <AiRequestsAdminPage />
      </MemoryRouter>
    );

    await screen.findByText('usage-1');
    await user.click(screen.getByRole('button', { name: 'Refresh' }));

    expect(mockGetUsage).toHaveBeenCalledTimes(2);
  });

  it('applies userId query filter from route', async () => {
    mockGetUsage.mockResolvedValueOnce({
      usage: [
        {
          id: 'usage-1',
          conversationId: null,
          messageId: null,
          userId: 'user-1',
          organizationId: null,
          modelId: 'openai/gpt-4o-mini',
          promptTokens: 10,
          completionTokens: 10,
          totalTokens: 20,
          openrouterRequestId: 'req-1',
          createdAt: '2026-02-09T12:00:00.000Z'
        },
        {
          id: 'usage-2',
          conversationId: null,
          messageId: null,
          userId: 'user-2',
          organizationId: null,
          modelId: 'openai/gpt-4o-mini',
          promptTokens: 20,
          completionTokens: 20,
          totalTokens: 40,
          openrouterRequestId: 'req-2',
          createdAt: '2026-02-09T12:05:00.000Z'
        }
      ],
      summary: {
        totalPromptTokens: 30,
        totalCompletionTokens: 30,
        totalTokens: 60,
        requestCount: 2,
        periodStart: '2026-02-01T00:00:00.000Z',
        periodEnd: '2026-02-09T23:59:59.999Z'
      },
      hasMore: false,
      cursor: undefined
    });

    render(
      <MemoryRouter initialEntries={['/admin/users/ai-requests?userId=user-2']}>
        <AiRequestsAdminPage />
      </MemoryRouter>
    );

    await screen.findByRole('heading', { name: 'AI Requests Admin' });
    expect(screen.getByDisplayValue('user-2')).toBeInTheDocument();
    expect(await screen.findByText('usage-2')).toBeInTheDocument();
    expect(screen.queryByText('usage-1')).not.toBeInTheDocument();
  });

  it('renders custom backLink even when showBackLink is false', async () => {
    mockGetUsage.mockResolvedValueOnce({
      usage: [],
      summary: {
        totalPromptTokens: 0,
        totalCompletionTokens: 0,
        totalTokens: 0,
        requestCount: 0,
        periodStart: '2026-02-01T00:00:00.000Z',
        periodEnd: '2026-02-09T23:59:59.999Z'
      },
      hasMore: false,
      cursor: undefined
    });

    render(
      <MemoryRouter>
        <AiRequestsAdminPage
          showBackLink={false}
          backLink={<button type="button">Back to Users</button>}
        />
      </MemoryRouter>
    );

    expect(
      await screen.findByRole('button', { name: 'Back to Users' })
    ).toBeInTheDocument();
  });
});
