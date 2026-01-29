import { render, screen } from '@testing-library/react';
import type { ReactNode } from 'react';
import { MemoryRouter } from 'react-router-dom';
import { describe, expect, it, vi } from 'vitest';
import { Vfs } from './Vfs';

vi.mock('@/components/ui/back-link', () => ({
  BackLink: ({
    defaultTo,
    defaultLabel
  }: {
    defaultTo: string;
    defaultLabel: string;
  }) => <a href={defaultTo}>{defaultLabel}</a>
}));

vi.mock('@rapid/vfs-explorer', () => ({
  VfsExplorer: ({ className }: { className: string }) => (
    <div data-testid="vfs-explorer" className={className}>
      VFS Explorer Component
    </div>
  )
}));

vi.mock('@/contexts/ClientVfsExplorerProvider', () => ({
  ClientVfsExplorerProvider: ({ children }: { children: ReactNode }) => (
    <>{children}</>
  )
}));

describe('Vfs', () => {
  it('renders page title', () => {
    render(
      <MemoryRouter>
        <Vfs />
      </MemoryRouter>
    );

    expect(screen.getByText('VFS Explorer')).toBeInTheDocument();
  });

  it('renders description text', () => {
    render(
      <MemoryRouter>
        <Vfs />
      </MemoryRouter>
    );

    expect(
      screen.getByText(
        'Organize and share your data with end-to-end encryption'
      )
    ).toBeInTheDocument();
  });

  it('renders back link', () => {
    render(
      <MemoryRouter>
        <Vfs />
      </MemoryRouter>
    );

    expect(screen.getByText('Back to Home')).toBeInTheDocument();
  });

  it('renders VfsExplorer component', () => {
    render(
      <MemoryRouter>
        <Vfs />
      </MemoryRouter>
    );

    expect(screen.getByTestId('vfs-explorer')).toBeInTheDocument();
  });
});
