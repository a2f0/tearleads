import type { VfsShare } from '@tearleads/shared';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { ReactNode } from 'react';
import { describe, expect, it, vi } from 'vitest';
import { ShareListItem } from './ShareListItem';

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
      readStoredAuth: () => ({ user: { id: 'current-user' } })
    }
  })
}));

const makeShare = (overrides?: Partial<VfsShare>): VfsShare => ({
  id: 'share-1',
  itemId: 'item-1',
  shareType: 'user',
  targetId: 'user-2',
  targetName: 'Jane Doe',
  permissionLevel: 'view',
  createdBy: 'current-user',
  createdByEmail: 'me@example.com',
  createdAt: new Date().toISOString(),
  expiresAt: null,
  ...overrides
});

describe('ShareListItem', () => {
  const defaultProps = {
    editState: null,
    deleteConfirm: null,
    onStartEdit: vi.fn(),
    onCancelEdit: vi.fn(),
    onSaveEdit: vi.fn(async () => {}),
    onRequestDelete: vi.fn(),
    onCancelDelete: vi.fn(),
    onConfirmDelete: vi.fn(async () => {})
  };

  it('renders share target name and permission badge', () => {
    render(<ShareListItem share={makeShare()} {...defaultProps} />);
    expect(screen.getByText('Jane Doe')).toBeInTheDocument();
    expect(screen.getByText('View')).toBeInTheDocument();
  });

  it('shows "Shared by you" for own shares', () => {
    render(<ShareListItem share={makeShare()} {...defaultProps} />);
    expect(screen.getByText('Shared by you')).toBeInTheDocument();
  });

  it('opens menu and shows Edit/Remove options', async () => {
    const user = userEvent.setup();
    render(<ShareListItem share={makeShare()} {...defaultProps} />);

    await user.click(screen.getByTestId('share-item-menu'));
    expect(screen.getByTestId('share-item-edit')).toBeInTheDocument();
    expect(screen.getByTestId('share-item-remove')).toBeInTheDocument();
  });

  it('enters edit mode when Edit is clicked', async () => {
    const onStartEdit = vi.fn();
    const user = userEvent.setup();
    const share = makeShare();
    render(
      <ShareListItem
        share={share}
        {...defaultProps}
        onStartEdit={onStartEdit}
      />
    );

    await user.click(screen.getByTestId('share-item-menu'));
    await user.click(screen.getByTestId('share-item-edit'));

    expect(onStartEdit).toHaveBeenCalledWith({
      shareId: 'share-1',
      permissionLevel: 'view',
      expiresAt: ''
    });
  });

  it('shows edit form when in edit state', () => {
    render(
      <ShareListItem
        share={makeShare()}
        {...defaultProps}
        editState={{
          shareId: 'share-1',
          permissionLevel: 'view',
          expiresAt: ''
        }}
      />
    );
    expect(screen.getByTestId('share-edit-mode')).toBeInTheDocument();
    expect(screen.getByText('Save')).toBeInTheDocument();
    expect(screen.getByText('Cancel')).toBeInTheDocument();
  });

  it('requests delete when Remove is clicked', async () => {
    const onRequestDelete = vi.fn();
    const user = userEvent.setup();
    render(
      <ShareListItem
        share={makeShare()}
        {...defaultProps}
        onRequestDelete={onRequestDelete}
      />
    );

    await user.click(screen.getByTestId('share-item-menu'));
    await user.click(screen.getByTestId('share-item-remove'));

    expect(onRequestDelete).toHaveBeenCalledWith({
      shareId: 'share-1',
      targetName: 'Jane Doe',
      isOrg: false
    });
  });

  it('shows delete confirmation when deleteConfirm matches', () => {
    render(
      <ShareListItem
        share={makeShare()}
        {...defaultProps}
        deleteConfirm={{
          shareId: 'share-1',
          targetName: 'Jane Doe',
          isOrg: false
        }}
      />
    );
    expect(screen.getByTestId('share-delete-confirmation')).toBeInTheDocument();
  });
});
