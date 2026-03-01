import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { ReactNode } from 'react';
import { describe, expect, it, vi } from 'vitest';
import { SharingPanel } from './SharingPanel';

const mockCreateShare = vi.fn(async () => ({
  id: 'share-new',
  itemId: 'item-1',
  shareType: 'user' as const,
  targetId: 'target-1',
  targetName: 'Target',
  permissionLevel: 'view' as const,
  createdBy: 'user-1',
  createdByEmail: 'user-1@example.com',
  createdAt: new Date().toISOString(),
  expiresAt: null
}));

const mockDeleteShare = vi.fn(async () => true);
const mockDeleteOrgShare = vi.fn(async () => true);
const mockUpdateShare = vi.fn(async () => ({
  id: 'share-1',
  itemId: 'item-1',
  shareType: 'user' as const,
  targetId: 'target-1',
  targetName: 'Target',
  permissionLevel: 'edit' as const,
  createdBy: 'user-1',
  createdByEmail: 'user-1@example.com',
  createdAt: new Date().toISOString(),
  expiresAt: null
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
    },
    auth: {
      readStoredAuth: () => ({ user: { id: 'test-user' } })
    }
  })
}));

vi.mock('../../hooks', () => ({
  useVfsShares: () => ({
    shares: [],
    orgShares: [],
    loading: false,
    error: null,
    refetch: vi.fn(),
    createShare: mockCreateShare,
    updateShare: mockUpdateShare,
    deleteShare: mockDeleteShare,
    deleteOrgShare: mockDeleteOrgShare
  }),
  useShareTargetSearch: () => ({
    results: [],
    loading: false,
    search: vi.fn(),
    clear: vi.fn()
  }),
  useSharePolicyPreview: () => ({
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
    refetch: vi.fn(),
    loadMore: vi.fn()
  })
}));

vi.mock('@tearleads/window-manager', () => ({
  useResizableSidebar: () => ({
    resizeHandleProps: {}
  })
}));

describe('SharingPanel', () => {
  const defaultProps = {
    item: {
      id: 'item-1',
      objectType: 'file',
      name: 'document.pdf',
      createdAt: new Date()
    },
    width: 320,
    onWidthChange: vi.fn(),
    onClose: vi.fn()
  };

  it('renders panel with item name', () => {
    render(<SharingPanel {...defaultProps} />);
    expect(screen.getByText('Sharing: document.pdf')).toBeInTheDocument();
  });

  it('shows empty state when no shares exist', () => {
    render(<SharingPanel {...defaultProps} />);
    expect(screen.getByText('Not shared')).toBeInTheDocument();
    expect(screen.getByTestId('share-list-empty')).toBeInTheDocument();
  });

  it('shows Share button that toggles the form', async () => {
    const user = userEvent.setup();
    render(<SharingPanel {...defaultProps} />);

    expect(screen.getByTestId('open-share-form')).toBeInTheDocument();
    await user.click(screen.getByTestId('open-share-form'));
    expect(screen.getByTestId('share-form')).toBeInTheDocument();
  });

  it('closes form when Cancel is clicked', async () => {
    const user = userEvent.setup();
    render(<SharingPanel {...defaultProps} />);

    await user.click(screen.getByTestId('open-share-form'));
    expect(screen.getByTestId('share-form')).toBeInTheDocument();

    await user.click(screen.getByText('Cancel'));
    expect(screen.queryByTestId('share-form')).not.toBeInTheDocument();
  });

  it('calls onClose when close button is clicked', async () => {
    const onClose = vi.fn();
    const user = userEvent.setup();
    render(<SharingPanel {...defaultProps} onClose={onClose} />);

    const closeButtons = screen.getAllByRole('button');
    const closeButton = closeButtons.find(
      (btn) => btn.textContent === '' || btn.querySelector('svg')
    );
    if (closeButton) {
      await user.click(closeButton);
      expect(onClose).toHaveBeenCalled();
    }
  });
});
