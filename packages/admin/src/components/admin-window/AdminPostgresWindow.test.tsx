import { render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { AdminPostgresWindow } from './AdminPostgresWindow';

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

describe('AdminPostgresWindow', () => {
  const defaultProps = {
    id: 'test-postgres-window',
    onClose: vi.fn(),
    onMinimize: vi.fn(),
    onFocus: vi.fn(),
    zIndex: 100
  };

  it('renders AdminWindow with initialView set to postgres', () => {
    render(<AdminPostgresWindow {...defaultProps} />);

    const adminWindow = screen.getByTestId('admin-window');
    expect(adminWindow).toBeInTheDocument();
    expect(adminWindow).toHaveAttribute('data-initial-view', 'postgres');
  });

  it('passes all props to AdminWindow', () => {
    render(<AdminPostgresWindow {...defaultProps} />);

    const adminWindow = screen.getByTestId('admin-window');
    expect(adminWindow).toHaveAttribute('data-id', 'test-postgres-window');
  });
});
