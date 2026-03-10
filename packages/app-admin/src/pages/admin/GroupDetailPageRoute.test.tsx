import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { GroupDetailPageRoute } from './GroupDetailPageRoute';

vi.mock('./GroupDetailPage', () => ({
  GroupDetailPage: ({ onDelete }: { onDelete?: () => void }) => (
    <div data-testid="group-detail-page">
      <button type="button" onClick={onDelete}>
        Delete Group
      </button>
    </div>
  )
}));

describe('GroupDetailPageRoute', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('navigates to groups list when group is deleted', async () => {
    const user = userEvent.setup();

    render(
      <MemoryRouter initialEntries={['/admin/groups/group-1']}>
        <Routes>
          <Route path="/admin/groups/:id" element={<GroupDetailPageRoute />} />
          <Route path="/admin/groups" element={<div>Groups Route</div>} />
        </Routes>
      </MemoryRouter>
    );

    await user.click(screen.getByText('Delete Group'));

    await waitFor(() => {
      expect(screen.getByText('Groups Route')).toBeInTheDocument();
    });
  });

  it('renders GroupDetailPage component', () => {
    render(
      <MemoryRouter initialEntries={['/admin/groups/group-1']}>
        <Routes>
          <Route path="/admin/groups/:id" element={<GroupDetailPageRoute />} />
        </Routes>
      </MemoryRouter>
    );

    expect(screen.getByTestId('group-detail-page')).toBeInTheDocument();
  });
});
