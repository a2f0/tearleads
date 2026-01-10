import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { ConnectionIndicator } from './connectionIndicator';

describe('ConnectionIndicator', () => {
  it('renders connected state with green color', () => {
    render(<ConnectionIndicator state="connected" />);
    const indicator = screen.getByRole('status');
    expect(indicator).toHaveClass('bg-green-500');
  });

  it('renders connecting state with pulse animation', () => {
    render(<ConnectionIndicator state="connecting" />);
    const indicator = screen.getByRole('status');
    expect(indicator).toHaveClass('animate-pulse', 'bg-muted-foreground');
  });

  it('renders disconnected state with red color', () => {
    render(<ConnectionIndicator state="disconnected" />);
    const indicator = screen.getByRole('status');
    expect(indicator).toHaveClass('bg-red-500');
  });

  it('has accessible label for connected state', () => {
    render(<ConnectionIndicator state="connected" />);
    expect(screen.getByRole('status')).toHaveAttribute(
      'aria-label',
      'Connection status: connected'
    );
  });

  it('has accessible label for connecting state', () => {
    render(<ConnectionIndicator state="connecting" />);
    expect(screen.getByRole('status')).toHaveAttribute(
      'aria-label',
      'Connection status: connecting'
    );
  });

  it('has accessible label for disconnected state', () => {
    render(<ConnectionIndicator state="disconnected" />);
    expect(screen.getByRole('status')).toHaveAttribute(
      'aria-label',
      'Connection status: disconnected'
    );
  });

  it('applies custom className', () => {
    render(<ConnectionIndicator state="connected" className="custom-class" />);
    const indicator = screen.getByRole('status');
    expect(indicator).toHaveClass('custom-class');
  });

  it('has correct base styles', () => {
    render(<ConnectionIndicator state="connected" />);
    const indicator = screen.getByRole('status');
    expect(indicator).toHaveClass('inline-block', 'h-2', 'w-2', 'rounded-full');
  });
});
