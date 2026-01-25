import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { OrganizationDetailPage } from './OrganizationDetailPage';

const mockGet = vi.fn();
const mockUpdate = vi.fn();
const mockDelete = vi.fn();

vi.mock('@/lib/api', () => ({
  api: {
    admin: {
      organizations: {
        get: (id: string) => mockGet(id),
        update: (id: string, payload: unknown) => mockUpdate(id, payload),
        delete: (id: string) => mockDelete(id)
      }
    }
  }
}));

describe('OrganizationDetailPage', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  const organizationResponse = {
    organization: {
      id: 'org-1',
      name: 'Acme',
      description: 'Team',
      createdAt: '2024-01-01T00:00:00Z',
      updatedAt: '2024-01-01T00:00:00Z'
    }
  };

  const renderWithRouter = (orgId: string) => {
    return render(
      <MemoryRouter initialEntries={[`/admin/organizations/${orgId}`]}>
        <Routes>
          <Route
            path="/admin/organizations/:id"
            element={<OrganizationDetailPage />}
          />
        </Routes>
      </MemoryRouter>
    );
  };

  it('renders loading state initially', async () => {
    mockGet.mockImplementation(
      () =>
        new Promise((resolve) =>
          setTimeout(() => resolve(organizationResponse), 100)
        )
    );

    renderWithRouter('org-1');

    expect(document.querySelector('.animate-spin')).toBeInTheDocument();
  });

  it('renders organization details when loaded', async () => {
    mockGet.mockResolvedValueOnce(organizationResponse);

    renderWithRouter('org-1');

    expect(
      await screen.findByRole('heading', { name: 'Edit Organization' })
    ).toBeInTheDocument();
    expect(screen.getByDisplayValue('Acme')).toBeInTheDocument();
    expect(screen.getByDisplayValue('Team')).toBeInTheDocument();
  });

  it('updates organization and saves', async () => {
    const user = userEvent.setup();
    mockGet.mockResolvedValueOnce(organizationResponse);
    mockUpdate.mockResolvedValueOnce({
      organization: {
        id: 'org-1',
        name: 'Acme Updated',
        description: 'Team',
        createdAt: '2024-01-01T00:00:00Z',
        updatedAt: '2024-01-01T00:00:00Z'
      }
    });

    renderWithRouter('org-1');

    const nameInput = await screen.findByDisplayValue('Acme');
    await user.clear(nameInput);
    await user.type(nameInput, 'Acme Updated');

    await user.click(screen.getByRole('button', { name: /save/i }));

    await waitFor(() => {
      expect(mockUpdate).toHaveBeenCalledWith('org-1', {
        name: 'Acme Updated',
        description: 'Team'
      });
    });
  });

  it('deletes organization when confirmed', async () => {
    const user = userEvent.setup();
    mockGet.mockResolvedValueOnce(organizationResponse);
    mockDelete.mockResolvedValueOnce({ deleted: true });

    renderWithRouter('org-1');

    await screen.findByDisplayValue('Acme');

    await user.click(screen.getByTestId('organization-delete-button'));
    await user.click(screen.getByRole('button', { name: 'Delete' }));

    await waitFor(() => {
      expect(mockDelete).toHaveBeenCalledWith('org-1');
    });
  });
});
