import { render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { AdminRedisWindow } from './AdminRedisWindow';

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

describe('AdminRedisWindow', () => {
  const defaultProps = {
    id: 'test-redis-window',
    onClose: vi.fn(),
    onMinimize: vi.fn(),
    onFocus: vi.fn(),
    zIndex: 100
  };

  it('renders AdminWindow with initialView set to redis', () => {
    render(<AdminRedisWindow {...defaultProps} />);

    const adminWindow = screen.getByTestId('admin-window');
    expect(adminWindow).toBeInTheDocument();
    expect(adminWindow).toHaveAttribute('data-initial-view', 'redis');
  });

  it('passes all props to AdminWindow', () => {
    render(<AdminRedisWindow {...defaultProps} />);

    const adminWindow = screen.getByTestId('admin-window');
    expect(adminWindow).toHaveAttribute('data-id', 'test-redis-window');
  });
});
