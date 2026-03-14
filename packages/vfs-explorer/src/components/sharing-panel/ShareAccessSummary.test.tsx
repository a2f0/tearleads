import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { ReactNode } from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { ShareAccessSummary } from './ShareAccessSummary';

const mockUseSharePolicyPreview = vi.fn((_: unknown) => ({
  nodes: [],
  summary: {
    totalMatchingNodes: 0,
    returnedNodes: 0,
    directCount: 0,
    derivedCount: 0,
    deniedCount: 0,
    includedCount: 0,
    excludedCount: 0
  },
  nextCursor: null,
  hasMore: false,
  loading: false,
  error: null,
  refetch: vi.fn(async () => undefined),
  loadMore: vi.fn(async () => undefined)
}));

vi.mock('../../context', () => ({
  useVfsExplorerContext: () => ({
    ui: {
      Button: ({
        children,
        ...props
      }: {
        children: ReactNode;
        [key: string]: unknown;
      }) => <button {...props}>{children}</button>,
      Input: (props: Record<string, unknown>) => <input {...props} />
    }
  })
}));

vi.mock('../../hooks/useSharePolicyPreview.js', () => ({
  useSharePolicyPreview: (options: unknown) =>
    mockUseSharePolicyPreview(options)
}));

describe('ShareAccessSummary', () => {
  beforeEach(() => {
    mockUseSharePolicyPreview.mockClear();
  });

  const baseProps = {
    itemId: 'root-1',
    shareType: 'user' as const,
    selectedTargetId: 'target-1',
    selectedTargetName: 'Target User'
  };

  it('does not render when target is not selected', () => {
    render(
      <ShareAccessSummary
        {...baseProps}
        selectedTargetId={null}
        selectedTargetName=""
      />
    );

    expect(
      screen.queryByTestId('share-access-summary')
    ).not.toBeInTheDocument();
  });

  it('forwards depth and object-type filters to preview hook', async () => {
    const user = userEvent.setup();
    render(<ShareAccessSummary {...baseProps} />);

    await user.click(screen.getByTestId('access-details-toggle'));
    await user.selectOptions(screen.getByTestId('access-depth-filter'), '2');
    await user.click(screen.getByTestId('access-object-type-note'));

    const latestCall = mockUseSharePolicyPreview.mock.calls.at(-1)?.[0];
    expect(latestCall).toMatchObject({
      rootItemId: 'root-1',
      principalType: 'user',
      principalId: 'target-1',
      maxDepth: 2,
      objectType: ['note'],
      enabled: true
    });
  });

  it('clears depth and object-type filters from clear control', async () => {
    const user = userEvent.setup();
    render(<ShareAccessSummary {...baseProps} />);

    await user.click(screen.getByTestId('access-details-toggle'));
    await user.selectOptions(screen.getByTestId('access-depth-filter'), '3');
    await user.click(screen.getByTestId('access-object-type-folder'));
    await user.click(screen.getByTestId('access-filter-clear'));

    const latestCall = mockUseSharePolicyPreview.mock.calls.at(-1)?.[0];
    expect(latestCall).toMatchObject({
      maxDepth: null,
      objectType: null,
      q: ''
    });
  });
});
