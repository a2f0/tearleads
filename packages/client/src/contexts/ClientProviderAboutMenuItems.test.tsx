import { ThemeProvider } from '@rapid/ui';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';

vi.mock('@/hooks/useAppVersion', () => ({
  useAppVersion: vi.fn(() => undefined)
}));

vi.mock('@rapid/email/package.json', () => ({
  default: { version: '0.0.8' }
}));

vi.mock('@rapid/notes/package.json', () => ({
  default: { version: '0.0.1' }
}));

vi.mock('@rapid/vfs-explorer/package.json', () => ({
  default: { version: '0.0.8' }
}));

const testCases = [
  {
    name: 'Email',
    importPath: './ClientEmailProvider',
    componentName: 'EmailAboutMenuItem',
    expectedVersion: '0.0.8'
  },
  {
    name: 'Notes',
    importPath: './ClientNotesProvider',
    componentName: 'NotesAboutMenuItem',
    expectedVersion: '0.0.1'
  },
  {
    name: 'VFS Explorer',
    importPath: './ClientVfsExplorerProvider',
    componentName: 'VfsExplorerAboutMenuItem',
    expectedVersion: '0.0.8'
  }
];

describe('ClientProvider AboutMenuItem wrappers', () => {
  it.each(
    testCases
  )('renders $name AboutMenuItem with correct app name and version', async ({
    name,
    importPath,
    componentName,
    expectedVersion
  }) => {
    const module = await import(importPath);
    const AboutMenuItemWrapper = module[componentName];
    const user = userEvent.setup();

    render(
      <ThemeProvider>
        <AboutMenuItemWrapper />
      </ThemeProvider>
    );

    await user.click(screen.getByText('About'));

    expect(screen.getByText(`About ${name}`)).toBeInTheDocument();
    expect(screen.getByTestId('about-version')).toHaveTextContent(
      expectedVersion
    );
  });
});
