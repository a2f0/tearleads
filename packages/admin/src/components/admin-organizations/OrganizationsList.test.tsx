import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { OrganizationsList } from './OrganizationsList';

vi.mock('sonner', () => ({
  toast: {
    error: vi.fn(),
    success: vi.fn()
  }
}));

const mockList = vi.fn();
const mockDelete = vi.fn();

vi.mock('@tearleads/api-client', () => ({
  api: {
    admin: {
      getContext: vi.fn().mockResolvedValue({
        isRootAdmin: true,
        organizations: [{ id: 'org-1', name: 'Org 1' }]
      }),
      organizations: {
        list: (options?: { organizationId?: string }) => mockList(options),
        delete: (id: string) => mockDelete(id)
      }
    }
  }
}));

describe('OrganizationsList', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  const defaultProps = {
    onOrganizationSelect: vi.fn()
  };

  function renderOrganizationsList(props?: {
    onCreateClick?: () => void;
    onOrganizationSelect?: (organizationId: string) => void;
    organizationId?: string | null;
  }) {
    const mergedProps = { ...defaultProps, ...props };
    return render(
      <MemoryRouter>
        <OrganizationsList {...mergedProps} />
      </MemoryRouter>
    );
  }

  it('renders loading state initially', () => {
    mockList.mockImplementation(() => new Promise(() => {}));
    renderOrganizationsList();

    expect(document.querySelector('.animate-spin')).toBeInTheDocument();
  });

  it('requests organizations scoped to selected organization', async () => {
    mockList.mockResolvedValue({ organizations: [] });

    renderOrganizationsList({ organizationId: 'org-2' });

    await waitFor(() => {
      expect(mockList).toHaveBeenCalledWith({ organizationId: 'org-2' });
    });
  });

  it('renders organizations list after loading', async () => {
    mockList.mockResolvedValue({
      organizations: [
        {
          id: 'org-1',
          name: 'Acme',
          description: 'Team',
          createdAt: '2024-01-01T00:00:00Z',
          updatedAt: '2024-01-01T00:00:00Z'
        },
        {
          id: 'org-2',
          name: 'Beta',
          description: null,
          createdAt: '2024-01-01T00:00:00Z',
          updatedAt: '2024-01-01T00:00:00Z'
        }
      ]
    });

    renderOrganizationsList();

    await waitFor(() => {
      expect(screen.getByText('Acme')).toBeInTheDocument();
    });

    expect(screen.getByRole('table')).toBeInTheDocument();
    expect(
      screen.getByRole('columnheader', { name: 'ID' })
    ).toBeInTheDocument();
    expect(
      screen.getByRole('columnheader', { name: 'Name' })
    ).toBeInTheDocument();
    expect(
      screen.getByRole('columnheader', { name: 'Description' })
    ).toBeInTheDocument();
    expect(screen.getByText('org-1')).toBeInTheDocument();
    expect(screen.getByText('org-2')).toBeInTheDocument();
    expect(screen.getByText('Team')).toBeInTheDocument();
    expect(screen.getByText('Beta')).toBeInTheDocument();
    expect(screen.getByText('—')).toBeInTheDocument();
  });

  it('renders empty state when no organizations exist', async () => {
    mockList.mockResolvedValue({ organizations: [] });

    renderOrganizationsList();

    await waitFor(() => {
      expect(screen.getByText('No organizations yet')).toBeInTheDocument();
    });

    expect(
      screen.getByText('Create an organization to manage access')
    ).toBeInTheDocument();
  });

  it('shows create button in empty state when callback provided', async () => {
    const onCreateClick = vi.fn();
    mockList.mockResolvedValue({ organizations: [] });

    renderOrganizationsList({ onCreateClick });

    await waitFor(() => {
      expect(screen.getByText('No organizations yet')).toBeInTheDocument();
    });

    const createButton = screen.getByRole('button', {
      name: /create organization/i
    });
    expect(createButton).toBeInTheDocument();

    await userEvent.click(createButton);
    expect(onCreateClick).toHaveBeenCalled();
  });

  it('renders error state when fetch fails', async () => {
    mockList.mockRejectedValue(new Error('Network error'));

    renderOrganizationsList();

    await waitFor(() => {
      expect(screen.getByText('Network error')).toBeInTheDocument();
    });
  });

  it('renders fallback error message for non-error failures', async () => {
    mockList.mockRejectedValue('boom');

    renderOrganizationsList();

    await waitFor(() => {
      expect(
        screen.getByText('Failed to fetch organizations')
      ).toBeInTheDocument();
    });
  });

  it('retries fetch when retry button clicked', async () => {
    const user = userEvent.setup();
    mockList
      .mockRejectedValueOnce(new Error('Network error'))
      .mockResolvedValueOnce({ organizations: [] });

    renderOrganizationsList();

    await waitFor(() => {
      expect(screen.getByText('Network error')).toBeInTheDocument();
    });

    await user.click(screen.getByRole('button', { name: /retry/i }));

    await waitFor(() => {
      expect(screen.getByText('No organizations yet')).toBeInTheDocument();
    });
  });

  it('calls onOrganizationSelect when organization is clicked', async () => {
    const user = userEvent.setup();
    const onOrganizationSelect = vi.fn();
    mockList.mockResolvedValue({
      organizations: [
        {
          id: 'org-1',
          name: 'Acme',
          description: null,
          createdAt: '2024-01-01T00:00:00Z',
          updatedAt: '2024-01-01T00:00:00Z'
        }
      ]
    });

    renderOrganizationsList({ onOrganizationSelect });

    await waitFor(() => {
      expect(screen.getByText('Acme')).toBeInTheDocument();
    });

    await user.click(screen.getByText('Acme'));

    expect(onOrganizationSelect).toHaveBeenCalledWith('org-1');
  });

  it('calls onOrganizationSelect when Enter key pressed on row', async () => {
    const user = userEvent.setup();
    const onOrganizationSelect = vi.fn();
    mockList.mockResolvedValue({
      organizations: [
        {
          id: 'org-1',
          name: 'Acme',
          description: null,
          createdAt: '2024-01-01T00:00:00Z',
          updatedAt: '2024-01-01T00:00:00Z'
        }
      ]
    });

    renderOrganizationsList({ onOrganizationSelect });

    await waitFor(() => {
      expect(screen.getByText('Acme')).toBeInTheDocument();
    });

    const row = screen.getByRole('row', { name: /org-1.*acme/i });
    row.focus();
    await user.keyboard('{Enter}');

    expect(onOrganizationSelect).toHaveBeenCalledWith('org-1');
  });

  it('calls onOrganizationSelect when Space key pressed on row', async () => {
    const user = userEvent.setup();
    const onOrganizationSelect = vi.fn();
    mockList.mockResolvedValue({
      organizations: [
        {
          id: 'org-1',
          name: 'Acme',
          description: null,
          createdAt: '2024-01-01T00:00:00Z',
          updatedAt: '2024-01-01T00:00:00Z'
        }
      ]
    });

    renderOrganizationsList({ onOrganizationSelect });

    await waitFor(() => {
      expect(screen.getByText('Acme')).toBeInTheDocument();
    });

    const row = screen.getByRole('row', { name: /org-1.*acme/i });
    row.focus();
    await user.keyboard(' ');

    expect(onOrganizationSelect).toHaveBeenCalledWith('org-1');
  });

  it('copies organization id from context menu', async () => {
    const user = userEvent.setup();
    const writeTextMock = vi.fn().mockResolvedValue(undefined);
    vi.spyOn(navigator.clipboard, 'writeText').mockImplementation(
      writeTextMock
    );
    mockList.mockResolvedValue({
      organizations: [
        {
          id: 'org-1',
          name: 'Acme',
          description: null,
          createdAt: '2024-01-01T00:00:00Z',
          updatedAt: '2024-01-01T00:00:00Z'
        }
      ]
    });

    renderOrganizationsList();

    await waitFor(() => {
      expect(screen.getByText('Acme')).toBeInTheDocument();
    });

    fireEvent.contextMenu(screen.getByText('Acme'));
    await user.click(screen.getByText('Copy ID'));

    expect(writeTextMock).toHaveBeenCalledWith('org-1');
  });

  it('deletes an organization from context menu', async () => {
    const user = userEvent.setup();
    mockList.mockResolvedValue({
      organizations: [
        {
          id: 'org-1',
          name: 'Acme',
          description: null,
          createdAt: '2024-01-01T00:00:00Z',
          updatedAt: '2024-01-01T00:00:00Z'
        }
      ]
    });
    mockDelete.mockResolvedValue({ deleted: true });

    renderOrganizationsList();

    await waitFor(() => {
      expect(screen.getByText('Acme')).toBeInTheDocument();
    });

    fireEvent.contextMenu(screen.getByText('Acme'));
    await user.click(screen.getByText('Delete'));

    await user.click(screen.getByRole('button', { name: 'Delete' }));

    await waitFor(() => {
      expect(mockDelete).toHaveBeenCalledWith('org-1');
    });
  });

  it('closes context menu when clicking backdrop', async () => {
    const user = userEvent.setup();
    mockList.mockResolvedValue({
      organizations: [
        {
          id: 'org-1',
          name: 'Acme',
          description: null,
          createdAt: '2024-01-01T00:00:00Z',
          updatedAt: '2024-01-01T00:00:00Z'
        }
      ]
    });

    renderOrganizationsList();

    await waitFor(() => {
      expect(screen.getByText('Acme')).toBeInTheDocument();
    });

    fireEvent.contextMenu(screen.getByText('Acme'));

    expect(screen.getByText('Delete')).toBeInTheDocument();

    await user.click(
      screen.getByRole('button', { name: /close context menu/i })
    );

    await waitFor(() => {
      expect(screen.queryByText('Delete')).not.toBeInTheDocument();
    });
  });
});
