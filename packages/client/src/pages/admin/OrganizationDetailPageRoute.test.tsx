import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { describe, expect, it, vi } from 'vitest';
import { OrganizationDetailPageRoute } from './OrganizationDetailPageRoute';

vi.mock('./OrganizationDetailPage', () => ({
  OrganizationDetailPage: ({ onDelete }: { onDelete?: () => void }) => (
    <button type="button" onClick={onDelete}>
      Delete Organization
    </button>
  )
}));

describe('OrganizationDetailPageRoute', () => {
  it('navigates back to organizations list on delete', async () => {
    const user = userEvent.setup();

    render(
      <MemoryRouter initialEntries={[`/admin/organizations/org-1`]}>
        <Routes>
          <Route
            path="/admin/organizations/:id"
            element={<OrganizationDetailPageRoute />}
          />
          <Route
            path="/admin/organizations"
            element={<div>Organizations</div>}
          />
        </Routes>
      </MemoryRouter>
    );

    await user.click(screen.getByText('Delete Organization'));

    expect(screen.getByText('Organizations')).toBeInTheDocument();
  });
});
