import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { CreateOrganizationDialog } from './CreateOrganizationDialog';

const mockCreate = vi.fn();

vi.mock('@/lib/api', () => ({
  api: {
    admin: {
      organizations: {
        create: (data: unknown) => mockCreate(data)
      }
    }
  }
}));

describe('CreateOrganizationDialog', () => {
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
        <CreateOrganizationDialog
          open={open}
          onOpenChange={onOpenChange}
          onCreated={onCreated}
        />
      )
    };
  }

  it('renders nothing when closed', () => {
    renderDialog(false);
    expect(screen.queryByText('Create Organization')).not.toBeInTheDocument();
  });

  it('renders dialog when open', () => {
    renderDialog();
    expect(
      screen.getByRole('heading', { name: 'Create Organization' })
    ).toBeInTheDocument();
    expect(screen.getByLabelText('Name')).toBeInTheDocument();
    expect(screen.getByLabelText('Description (optional)')).toBeInTheDocument();
  });

  it('focuses name input when opened', async () => {
    renderDialog();

    await waitFor(() => {
      expect(screen.getByLabelText('Name')).toHaveFocus();
    });
  });

  it('creates organization with name only', async () => {
    const user = userEvent.setup();
    const { onOpenChange, onCreated } = renderDialog();
    mockCreate.mockResolvedValue({
      organization: {
        id: 'org-1',
        name: 'Acme',
        description: null,
        createdAt: '2024-01-01T00:00:00Z',
        updatedAt: '2024-01-01T00:00:00Z'
      }
    });

    await user.type(screen.getByLabelText('Name'), 'Acme');
    await user.click(screen.getByRole('button', { name: 'Create' }));

    await waitFor(() => {
      expect(mockCreate).toHaveBeenCalledWith({ name: 'Acme' });
    });
    expect(onOpenChange).toHaveBeenCalledWith(false);
    expect(onCreated).toHaveBeenCalled();
  });

  it('creates organization with name and description', async () => {
    const user = userEvent.setup();
    const { onOpenChange } = renderDialog();
    mockCreate.mockResolvedValue({
      organization: {
        id: 'org-1',
        name: 'Acme',
        description: 'Team',
        createdAt: '2024-01-01T00:00:00Z',
        updatedAt: '2024-01-01T00:00:00Z'
      }
    });

    await user.type(screen.getByLabelText('Name'), 'Acme');
    await user.type(screen.getByLabelText('Description (optional)'), 'Team');
    await user.click(screen.getByRole('button', { name: 'Create' }));

    await waitFor(() => {
      expect(mockCreate).toHaveBeenCalledWith({
        name: 'Acme',
        description: 'Team'
      });
    });
    expect(onOpenChange).toHaveBeenCalledWith(false);
  });

  it('shows error when name is empty', async () => {
    const user = userEvent.setup();
    renderDialog();

    await user.click(screen.getByRole('button', { name: 'Create' }));

    expect(screen.getByText('Name is required')).toBeInTheDocument();
  });
});
