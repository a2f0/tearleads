import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { OrganizationsAdminPage } from './OrganizationsAdminPage';

const mockNavigate = vi.fn();

vi.mock('./OrganizationsAdmin', () => ({
  OrganizationsAdmin: ({ onOrganizationSelect }: { onOrganizationSelect: (id: string) => void }) => (
    <button type="button" onClick={() => onOrganizationSelect('org-123')}>
      Select Org
    </button>
  )
}));

vi.mock('react-router-dom', async () => {
  const actual = await vi.importActual('react-router-dom');
  return {
    ...actual,
    useNavigate: () => mockNavigate
  };
});

describe('OrganizationsAdminPage', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('navigates to organization detail page when org is clicked', async () => {
    const user = userEvent.setup();

    render(
      <MemoryRouter>
        <OrganizationsAdminPage />
      </MemoryRouter>
    );

    await user.click(screen.getByText('Select Org'));

    await waitFor(() => {
      expect(mockNavigate).toHaveBeenCalledWith('/admin/organizations/org-123');
    });
  });

  it('renders OrganizationsAdmin component', () => {
    render(
      <MemoryRouter>
        <OrganizationsAdminPage />
      </MemoryRouter>
    );

    expect(screen.getByText('Select Org')).toBeInTheDocument();
  });
});
