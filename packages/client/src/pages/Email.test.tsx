import { render, screen } from '@testing-library/react';
import type { ReactNode } from 'react';
import { describe, expect, it, vi } from 'vitest';
import { Email } from './Email';

vi.mock('@tearleads/email', () => ({
  Email: () => <div>Email App</div>
}));

vi.mock('@/contexts/ClientEmailProvider', () => ({
  ClientEmailProvider: ({ children }: { children: ReactNode }) => (
    <>{children}</>
  )
}));

describe('Email', () => {
  it('renders the email app', () => {
    render(<Email />);

    expect(screen.getByText('Email App')).toBeInTheDocument();
  });
});
