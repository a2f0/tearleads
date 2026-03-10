import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { OrganizationsAdminPage } from './OrganizationsAdminPage';

vi.mock('./OrganizationsAdmin', () => ({
  OrganizationsAdmin: ({
    onOrganizationSelect
  }: {
    onOrganizationSelect: (id: string) => void;
  }) => (
    <button type="button" onClick={() => onOrganizationSelect('org-123')}>
      Select Org
    </button>
  )
}));

describe('OrganizationsAdminPage', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('navigates to organization detail page when org is clicked', async () => {
    const user = userEvent.setup();

    render(
      <MemoryRouter initialEntries={['/admin/organizations']}>
        <Routes>
          <Route
            path="/admin/organizations"
            element={<OrganizationsAdminPage />}
          />
          <Route
            path="/admin/organizations/:id"
            element={<div>Organization Detail Route</div>}
          />
        </Routes>
      </MemoryRouter>
    );

    await user.click(screen.getByText('Select Org'));

    await waitFor(() => {
      expect(screen.getByText('Organization Detail Route')).toBeInTheDocument();
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
