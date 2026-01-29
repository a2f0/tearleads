import { ThemeProvider } from '@rapid/ui';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';

vi.mock('@/hooks/useAppVersion', () => ({
  useAppVersion: vi.fn(() => undefined)
}));

vi.mock('../../../email/package.json', () => ({
  default: { version: '0.0.8' }
}));

vi.mock('../../../notes/package.json', () => ({
  default: { version: '0.0.1' }
}));

vi.mock('../../../vfs-explorer/package.json', () => ({
  default: { version: '0.0.8' }
}));

describe('ClientProvider AboutMenuItem wrappers', () => {
  describe('EmailAboutMenuItem', () => {
    it('renders with correct app name and version', async () => {
      const { EmailAboutMenuItem } = await import('./ClientEmailProvider');
      const user = userEvent.setup();

      render(
        <ThemeProvider>
          <EmailAboutMenuItem />
        </ThemeProvider>
      );

      await user.click(screen.getByText('About'));

      expect(screen.getByText('About Email')).toBeInTheDocument();
      expect(screen.getByTestId('about-version')).toHaveTextContent('0.0.8');
    });
  });

  describe('NotesAboutMenuItem', () => {
    it('renders with correct app name and version', async () => {
      const { NotesAboutMenuItem } = await import('./ClientNotesProvider');
      const user = userEvent.setup();

      render(
        <ThemeProvider>
          <NotesAboutMenuItem />
        </ThemeProvider>
      );

      await user.click(screen.getByText('About'));

      expect(screen.getByText('About Notes')).toBeInTheDocument();
      expect(screen.getByTestId('about-version')).toHaveTextContent('0.0.1');
    });
  });

  describe('VfsExplorerAboutMenuItem', () => {
    it('renders with correct app name and version', async () => {
      const { VfsExplorerAboutMenuItem } = await import(
        './ClientVfsExplorerProvider'
      );
      const user = userEvent.setup();

      render(
        <ThemeProvider>
          <VfsExplorerAboutMenuItem />
        </ThemeProvider>
      );

      await user.click(screen.getByText('About'));

      expect(screen.getByText('About VFS Explorer')).toBeInTheDocument();
      expect(screen.getByTestId('about-version')).toHaveTextContent('0.0.8');
    });
  });
});
