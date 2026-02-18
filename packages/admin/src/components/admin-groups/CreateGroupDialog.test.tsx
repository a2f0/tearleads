import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { CreateGroupDialog } from './CreateGroupDialog';

const mockCreate = vi.fn();

vi.mock('@tearleads/api-client', () => ({
  api: {
    admin: {
      getContext: vi.fn().mockResolvedValue({
        isRootAdmin: true,
        organizations: [{ id: 'org-1', name: 'Org 1' }]
      }),
      groups: {
        create: (data: unknown) => mockCreate(data)
      }
    }
  }
}));

describe('CreateGroupDialog', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  function renderDialog(
    open = true,
    onOpenChange = vi.fn(),
    onCreated = vi.fn()
  ) {
    return {
      onOpenChange,
      onCreated,
      ...render(
        <CreateGroupDialog
          open={open}
          onOpenChange={onOpenChange}
          onCreated={onCreated}
        />
      )
    };
  }

  it('renders nothing when closed', () => {
    renderDialog(false);
    expect(screen.queryByText('Create Group')).not.toBeInTheDocument();
  });

  it('renders dialog when open', () => {
    renderDialog();
    expect(
      screen.getByRole('heading', { name: 'Create Group' })
    ).toBeInTheDocument();
    expect(screen.getByLabelText('Name')).toBeInTheDocument();
    expect(screen.getByLabelText('Description (optional)')).toBeInTheDocument();
    expect(screen.getByLabelText('Organization ID')).toBeInTheDocument();
  });

  it('focuses name input when opened', async () => {
    renderDialog();

    await waitFor(() => {
      expect(screen.getByLabelText('Name')).toHaveFocus();
    });
  });

  it('creates group with name and organization', async () => {
    const user = userEvent.setup();
    const { onOpenChange, onCreated } = renderDialog();
    mockCreate.mockResolvedValue({
      group: {
        id: 'new-group',
        name: 'Test Group',
        description: null,
        createdAt: '2024-01-01T00:00:00Z',
        updatedAt: '2024-01-01T00:00:00Z'
      }
    });

    await user.type(screen.getByLabelText('Name'), 'Test Group');
    await user.type(screen.getByLabelText('Organization ID'), 'org-1');
    await user.click(screen.getByRole('button', { name: 'Create' }));

    await waitFor(() => {
      expect(mockCreate).toHaveBeenCalledWith({
        name: 'Test Group',
        organizationId: 'org-1'
      });
    });
    expect(onOpenChange).toHaveBeenCalledWith(false);
    expect(onCreated).toHaveBeenCalled();
  });

  it('creates group with name, description, and organization', async () => {
    const user = userEvent.setup();
    const { onOpenChange } = renderDialog();
    mockCreate.mockResolvedValue({
      group: {
        id: 'new-group',
        name: 'Test Group',
        description: 'A test group',
        createdAt: '2024-01-01T00:00:00Z',
        updatedAt: '2024-01-01T00:00:00Z'
      }
    });

    await user.type(screen.getByLabelText('Name'), 'Test Group');
    await user.type(screen.getByLabelText('Organization ID'), 'org-1');
    await user.type(
      screen.getByLabelText('Description (optional)'),
      'A test group'
    );
    await user.click(screen.getByRole('button', { name: 'Create' }));

    await waitFor(() => {
      expect(mockCreate).toHaveBeenCalledWith({
        name: 'Test Group',
        description: 'A test group',
        organizationId: 'org-1'
      });
    });
    expect(onOpenChange).toHaveBeenCalledWith(false);
  });

  it('shows error when name is empty', async () => {
    const user = userEvent.setup();
    renderDialog();

    await user.click(screen.getByRole('button', { name: 'Create' }));

    expect(screen.getByText('Name is required')).toBeInTheDocument();
    expect(mockCreate).not.toHaveBeenCalled();
  });

  it('shows error when organization ID is empty', async () => {
    const user = userEvent.setup();
    renderDialog();

    await user.type(screen.getByLabelText('Name'), 'Test Group');
    await user.click(screen.getByRole('button', { name: 'Create' }));

    expect(screen.getByText('Organization ID is required')).toBeInTheDocument();
    expect(mockCreate).not.toHaveBeenCalled();
  });

  it('shows error when name already exists', async () => {
    const user = userEvent.setup();
    renderDialog();
    mockCreate.mockRejectedValue(new Error('409'));

    await user.type(screen.getByLabelText('Name'), 'Existing Group');
    await user.type(screen.getByLabelText('Organization ID'), 'org-1');
    await user.click(screen.getByRole('button', { name: 'Create' }));

    await waitFor(() => {
      expect(
        screen.getByText('A group with this name already exists')
      ).toBeInTheDocument();
    });
  });

  it('closes on cancel', async () => {
    const user = userEvent.setup();
    const { onOpenChange } = renderDialog();

    await user.click(screen.getByRole('button', { name: 'Cancel' }));

    expect(onOpenChange).toHaveBeenCalledWith(false);
  });

  it('closes on escape key', async () => {
    const user = userEvent.setup();
    const { onOpenChange } = renderDialog();

    await user.keyboard('{Escape}');

    expect(onOpenChange).toHaveBeenCalledWith(false);
  });

  it('closes on backdrop click', async () => {
    const user = userEvent.setup();
    const { onOpenChange } = renderDialog();

    const backdrop = document.querySelector('[aria-hidden="true"]');
    if (backdrop) {
      await user.click(backdrop);
    }

    expect(onOpenChange).toHaveBeenCalledWith(false);
  });

  it('resets form when reopened', async () => {
    const user = userEvent.setup();
    const { rerender } = render(
      <CreateGroupDialog
        open={true}
        onOpenChange={vi.fn()}
        onCreated={vi.fn()}
      />
    );

    await user.type(screen.getByLabelText('Name'), 'Test');

    rerender(
      <CreateGroupDialog
        open={false}
        onOpenChange={vi.fn()}
        onCreated={vi.fn()}
      />
    );

    rerender(
      <CreateGroupDialog
        open={true}
        onOpenChange={vi.fn()}
        onCreated={vi.fn()}
      />
    );

    expect(screen.getByLabelText('Name')).toHaveValue('');
  });

  it('uses scoped organization options when provided', async () => {
    const user = userEvent.setup();
    mockCreate.mockResolvedValue({
      group: {
        id: 'new-group',
        name: 'Scoped Group',
        description: null,
        createdAt: '2024-01-01T00:00:00Z',
        updatedAt: '2024-01-01T00:00:00Z'
      }
    });

    render(
      <CreateGroupDialog
        open={true}
        onOpenChange={vi.fn()}
        onCreated={vi.fn()}
        organizations={[
          { id: 'org-1', name: 'Org One' },
          { id: 'org-2', name: 'Org Two' }
        ]}
        defaultOrganizationId="org-2"
      />
    );

    expect(screen.getByLabelText('Organization ID')).toHaveValue('org-2');

    await user.type(screen.getByLabelText('Name'), 'Scoped Group');
    await user.click(screen.getByRole('button', { name: 'Create' }));

    await waitFor(() => {
      expect(mockCreate).toHaveBeenCalledWith({
        name: 'Scoped Group',
        organizationId: 'org-2'
      });
    });
  });
});
