import { render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { AdminGroupsWindow } from './AdminGroupsWindow';

vi.mock('./AdminWindow', () => ({
  AdminWindow: ({ initialView, id }: { initialView?: string; id: string }) => (
    <div
      data-testid="admin-window"
      data-initial-view={initialView}
      data-id={id}
    >
      AdminWindow Mock
    </div>
  )
}));

describe('AdminGroupsWindow', () => {
  const defaultProps = {
    id: 'test-groups-window',
    onClose: vi.fn(),
    onMinimize: vi.fn(),
    onFocus: vi.fn(),
    zIndex: 100
  };

  it('renders AdminWindow with initialView set to groups', () => {
    render(<AdminGroupsWindow {...defaultProps} />);

    const adminWindow = screen.getByTestId('admin-window');
    expect(adminWindow).toBeInTheDocument();
    expect(adminWindow).toHaveAttribute('data-initial-view', 'groups');
  });

  it('passes all props to AdminWindow', () => {
    render(<AdminGroupsWindow {...defaultProps} />);

    const adminWindow = screen.getByTestId('admin-window');
    expect(adminWindow).toHaveAttribute('data-id', 'test-groups-window');
  });
});
