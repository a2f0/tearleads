import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { OrganizationsList } from './OrganizationsList';

const mockList = vi.fn();
const mockDelete = vi.fn();

vi.mock('@/lib/api', () => ({
  api: {
    admin: {
      organizations: {
        list: () => mockList(),
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

    expect(screen.getByText('Team')).toBeInTheDocument();
    expect(screen.getByText('Beta')).toBeInTheDocument();
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
});
