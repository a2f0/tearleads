import { ThemeProvider } from '@tearleads/ui';
import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { EmailAboutMenuItem } from './ClientEmailProvider';
import { NotesAboutMenuItem } from './ClientNotesProvider';
import { VfsExplorerAboutMenuItem } from './ClientVfsExplorerProvider';

vi.mock('@/hooks/app', () => ({
  useAppVersion: vi.fn(() => undefined)
}));

vi.mock('@tearleads/email/package.json', () => ({
  default: { version: '0.0.8' }
}));

vi.mock('@tearleads/notes/package.json', () => ({
  default: { version: '0.0.1' }
}));

vi.mock('@tearleads/vfs-explorer/package.json', () => ({
  default: { version: '0.0.8' }
}));

const testCases = [
  {
    name: 'Email',
    Component: EmailAboutMenuItem,
    expectedVersion: '0.0.8'
  },
  {
    name: 'Notes',
    Component: NotesAboutMenuItem,
    expectedVersion: '0.0.1'
  },
  {
    name: 'VFS Explorer',
    Component: VfsExplorerAboutMenuItem,
    expectedVersion: '0.0.8'
  }
];

describe('ClientProvider AboutMenuItem wrappers', () => {
  it.each(
    testCases
  )('renders $name AboutMenuItem with correct app name and version', ({
    name,
    Component,
    expectedVersion
  }) => {
    render(
      <ThemeProvider>
        <Component />
      </ThemeProvider>
    );

    const [aboutButton] = screen.getAllByRole('menuitem', { name: 'About' });
    fireEvent.click(aboutButton);

    expect(screen.getByText(`About ${name}`)).toBeInTheDocument();
    expect(screen.getByTestId('about-version')).toHaveTextContent(
      expectedVersion
    );
  });
});
