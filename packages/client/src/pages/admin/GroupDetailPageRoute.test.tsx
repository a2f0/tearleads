import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { GroupDetailPageRoute } from './GroupDetailPageRoute';

const mockNavigate = vi.fn();

vi.mock('react-router-dom', async () => {
  const actual = await vi.importActual('react-router-dom');
  return {
    ...actual,
    useNavigate: () => mockNavigate
  };
});

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
        </Routes>
      </MemoryRouter>
    );

    await user.click(screen.getByText('Delete Group'));

    await waitFor(() => {
      expect(mockNavigate).toHaveBeenCalledWith('/admin/groups');
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
