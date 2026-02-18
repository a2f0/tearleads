import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { CreateOrganizationDialog } from './CreateOrganizationDialog';

const mockCreate = vi.fn();

vi.mock('@tearleads/api-client', () => ({
  api: {
    admin: {
      getContext: vi.fn().mockResolvedValue({
        isRootAdmin: true,
        organizations: [{ id: 'org-1', name: 'Org 1' }]
      }),
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

  it('shows error when name already exists', async () => {
    const user = userEvent.setup();
    renderDialog();
    mockCreate.mockRejectedValue(new Error('409'));

    await user.type(screen.getByLabelText('Name'), 'Acme');
    await user.click(screen.getByRole('button', { name: 'Create' }));

    await waitFor(() => {
      expect(
        screen.getByText('An organization with this name already exists')
      ).toBeInTheDocument();
    });
  });

  it('shows fallback error when create fails', async () => {
    const user = userEvent.setup();
    renderDialog();
    mockCreate.mockRejectedValue('boom');

    await user.type(screen.getByLabelText('Name'), 'Acme');
    await user.click(screen.getByRole('button', { name: 'Create' }));

    await waitFor(() => {
      expect(
        screen.getByText('Failed to create organization')
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
      <CreateOrganizationDialog
        open={true}
        onOpenChange={vi.fn()}
        onCreated={vi.fn()}
      />
    );

    await user.type(screen.getByLabelText('Name'), 'Acme');
    await user.type(screen.getByLabelText('Description (optional)'), 'Team');

    rerender(
      <CreateOrganizationDialog
        open={false}
        onOpenChange={vi.fn()}
        onCreated={vi.fn()}
      />
    );

    rerender(
      <CreateOrganizationDialog
        open={true}
        onOpenChange={vi.fn()}
        onCreated={vi.fn()}
      />
    );

    expect(screen.getByLabelText('Name')).toHaveValue('');
    expect(screen.getByLabelText('Description (optional)')).toHaveValue('');
  });
});
