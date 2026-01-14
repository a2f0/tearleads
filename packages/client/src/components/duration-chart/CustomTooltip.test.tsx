import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { CustomTooltip } from './CustomTooltip';

describe('CustomTooltip', () => {
  it('renders nothing when inactive', () => {
    const { container } = render(
      <CustomTooltip
        active={false}
        payload={[
          {
            payload: {
              eventName: 'db_init',
              timestamp: Date.now(),
              durationMs: 1200,
              success: true
            }
          }
        ]}
      />
    );

    expect(container.firstChild).toBeNull();
  });

  it('renders success details when active', () => {
    render(
      <CustomTooltip
        active
        payload={[
          {
            payload: {
              eventName: 'db_init',
              timestamp: new Date('2024-01-01T00:00:00Z').getTime(),
              durationMs: 1200,
              success: true
            }
          }
        ]}
      />
    );

    expect(screen.getByText(/Duration:/)).toBeInTheDocument();
    expect(screen.getByText(/Time:/)).toBeInTheDocument();
    const status = screen.getByText('Success');
    expect(status).toBeInTheDocument();
    expect(status).toHaveClass('text-green-600');
  });

  it('renders failure details when active', () => {
    render(
      <CustomTooltip
        active
        payload={[
          {
            payload: {
              eventName: 'db_init',
              timestamp: new Date('2024-01-01T00:00:00Z').getTime(),
              durationMs: 1200,
              success: false
            }
          }
        ]}
      />
    );

    const status = screen.getByText('Failed');
    expect(status).toBeInTheDocument();
    expect(status).toHaveClass('text-red-600');
  });
});
