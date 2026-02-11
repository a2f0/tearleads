import { render, screen } from '@testing-library/react';
import type { ReactNode } from 'react';
import { MemoryRouter } from 'react-router-dom';
import { describe, expect, it, vi } from 'vitest';

// Mock the @tearleads/notes package
vi.mock('@tearleads/notes', () => ({
  Notes: () => <div data-testid="notes-base-component">Notes from package</div>
}));

// Mock the ClientNotesProvider
vi.mock('@/contexts/ClientNotesProvider', () => ({
  ClientNotesProvider: ({ children }: { children: ReactNode }) => (
    <div data-testid="client-notes-provider">{children}</div>
  )
}));

import { Notes } from './Notes';

describe('Notes wrapper', () => {
  it('renders ClientNotesProvider wrapping Notes from package', () => {
    render(
      <MemoryRouter>
        <Notes />
      </MemoryRouter>
    );

    // Verify the wrapper structure
    expect(screen.getByTestId('client-notes-provider')).toBeInTheDocument();
    expect(screen.getByTestId('notes-base-component')).toBeInTheDocument();

    // Verify Notes from package is a child of the provider
    const provider = screen.getByTestId('client-notes-provider');
    const notesComponent = screen.getByTestId('notes-base-component');
    expect(provider).toContainElement(notesComponent);
  });
});
