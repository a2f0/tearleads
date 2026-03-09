/**
 * Tests for NotificationBadge component.
 */

import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { NotificationBadge } from './NotificationBadge';

describe('NotificationBadge', () => {
  it('renders nothing when count is 0', () => {
    const { container } = render(<NotificationBadge count={0} />);
    expect(container.firstChild).toBeNull();
  });

  it('renders the count when greater than 0', () => {
    render(<NotificationBadge count={5} />);
    expect(screen.getByText('5')).toBeInTheDocument();
  });

  it('renders 99+ when count exceeds 99', () => {
    render(<NotificationBadge count={100} />);
    expect(screen.getByText('99+')).toBeInTheDocument();
  });

  it('renders 99+ for exactly 100', () => {
    render(<NotificationBadge count={100} />);
    expect(screen.getByText('99+')).toBeInTheDocument();
  });

  it('renders 99 for exactly 99', () => {
    render(<NotificationBadge count={99} />);
    expect(screen.getByText('99')).toBeInTheDocument();
  });

  it('has title attribute for accessibility', () => {
    render(<NotificationBadge count={3} />);
    const badge = screen.getByTitle('3 unread notifications');
    expect(badge).toBeInTheDocument();
  });

  it('uses singular form for 1 notification', () => {
    render(<NotificationBadge count={1} />);
    const badge = screen.getByTitle('1 unread notification');
    expect(badge).toBeInTheDocument();
  });
});
