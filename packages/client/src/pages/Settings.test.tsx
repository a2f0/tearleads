import { ThemeProvider } from '@rapid/ui';
import { act, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { mockConsoleError } from '@/test/console-mocks';
import packageJson from '../../package.json';
import { Settings } from './Settings';

// Mock database context
const mockExportDatabase = vi.fn();
const mockImportDatabase = vi.fn();
const mockLock = vi.fn();

vi.mock('@/db/hooks', () => ({
  useDatabaseContext: vi.fn(() => ({
    exportDatabase: mockExportDatabase,
    importDatabase: mockImportDatabase,
    lock: mockLock
  }))
}));

// Mock useSettings for TooltipsToggle
vi.mock('@/db/SettingsProvider', () => ({
  useSettings: () => ({
    getSetting: vi.fn((key: string) =>
      key === 'desktopIconDepth' ? 'embossed' : 'enabled'
    ),
    setSetting: vi.fn()
  })
}));

vi.mock('@/hooks/useAppVersion', () => ({
  useAppVersion: vi.fn(() => packageJson.version)
}));

// Mock file-utils
const mockSaveFile = vi.fn();
vi.mock('@/lib/file-utils', () => ({
  generateBackupFilename: vi.fn(() => 'rapid-backup-2025-01-01-120000.db'),
  readFileAsUint8Array: vi.fn(() => Promise.resolve(new Uint8Array([1, 2, 3]))),
  saveFile: (...args: unknown[]) => mockSaveFile(...args)
}));

function renderSettings() {
  return render(
    <MemoryRouter>
      <ThemeProvider>
        <Settings />
      </ThemeProvider>
    </MemoryRouter>
  );
}

describe('Settings', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockExportDatabase.mockResolvedValue(new Uint8Array([1, 2, 3]));
    mockImportDatabase.mockResolvedValue(undefined);
    mockLock.mockResolvedValue(undefined);
    mockSaveFile.mockResolvedValue(undefined);
  });

  describe('basic rendering', () => {
    beforeEach(() => {
      renderSettings();
    });

    it('renders the settings title', () => {
      expect(screen.getByText('Settings')).toBeInTheDocument();
    });

    it('renders the theme selector', () => {
      expect(
        screen.getByTestId('theme-selector-container')
      ).toBeInTheDocument();
    });

    it('renders the language selector', () => {
      expect(
        screen.getByTestId('language-selector-container')
      ).toBeInTheDocument();
    });

    it('renders the tooltips toggle', () => {
      expect(
        screen.getByTestId('tooltips-toggle-container')
      ).toBeInTheDocument();
    });

    it('renders the icon depth toggle', () => {
      expect(
        screen.getByTestId('icon-depth-toggle-container')
      ).toBeInTheDocument();
    });

    it('renders the pattern selector', () => {
      expect(
        screen.getByTestId('pattern-selector-container')
      ).toBeInTheDocument();
    });

    it('renders the version at the bottom', () => {
      expect(screen.getByTestId('app-version')).toHaveTextContent(
        `v${packageJson.version}`
      );
    });

    it('renders the open source licenses link', () => {
      expect(
        screen.getByTestId('open-source-licenses-link')
      ).toBeInTheDocument();
      expect(screen.getByText('Open Source Licenses')).toBeInTheDocument();
    });
  });

  describe('backup & restore section', () => {
    beforeEach(() => {
      renderSettings();
    });

    it('renders backup section title', () => {
      expect(screen.getByText('Backup & Restore')).toBeInTheDocument();
    });

    it('renders backup description', () => {
      expect(
        screen.getByText(
          'Export your encrypted database or restore from a backup'
        )
      ).toBeInTheDocument();
    });

    it('renders export button', () => {
      expect(screen.getByTestId('backup-export-button')).toBeInTheDocument();
      expect(screen.getByText('Create Backup')).toBeInTheDocument();
    });

    it('renders restore dropzone', () => {
      expect(screen.getByText('Restore from Backup')).toBeInTheDocument();
    });
  });

  describe('export functionality', () => {
    it('calls exportDatabase and saveFile when export button is clicked', async () => {
      const user = userEvent.setup();
      renderSettings();

      await user.click(screen.getByTestId('backup-export-button'));

      await waitFor(() => {
        expect(mockExportDatabase).toHaveBeenCalledTimes(1);
      });
      expect(mockSaveFile).toHaveBeenCalledWith(
        expect.any(Uint8Array),
        'rapid-backup-2025-01-01-120000.db'
      );
    });

    it('shows loading state during export', async () => {
      // Make export take some time
      mockExportDatabase.mockImplementation(
        () => new Promise((resolve) => setTimeout(resolve, 100))
      );

      const user = userEvent.setup();
      renderSettings();

      await user.click(screen.getByTestId('backup-export-button'));

      expect(await screen.findByText('Exporting...')).toBeInTheDocument();
    });

    it('shows error message when export fails', async () => {
      const consoleSpy = mockConsoleError();
      mockExportDatabase.mockRejectedValue(new Error('Export failed'));

      const user = userEvent.setup();
      renderSettings();

      await user.click(screen.getByTestId('backup-export-button'));

      await waitFor(() => {
        expect(screen.getByText('Export failed')).toBeInTheDocument();
      });
      expect(consoleSpy).toHaveBeenCalledWith(
        'Export failed:',
        expect.any(Error)
      );
      consoleSpy.mockRestore();
    });
  });

  describe('restore functionality', () => {
    it('shows confirmation dialog when file is selected', async () => {
      const user = userEvent.setup();
      renderSettings();

      const input = screen.getByTestId('dropzone-input');
      const file = new File(['test'], 'backup.db', {
        type: 'application/octet-stream'
      });

      await user.upload(input, file);

      await waitFor(() => {
        expect(
          screen.getByText('Warning: This will replace your current data')
        ).toBeInTheDocument();
      });
      expect(
        screen.getByText(/Restoring from "backup.db"/)
      ).toBeInTheDocument();
    });

    it('shows error for non-.db files', async () => {
      const user = userEvent.setup();
      renderSettings();

      const input = screen.getByTestId('dropzone-input') as HTMLInputElement;
      const file = new File(['test'], 'backup.txt', { type: 'text/plain' });

      // Manually trigger the change event since accept attribute may block upload
      Object.defineProperty(input, 'files', {
        value: [file],
        configurable: true
      });
      await user.click(input);
      await act(async () => {
        input.dispatchEvent(new Event('change', { bubbles: true }));
      });

      await waitFor(() => {
        expect(
          screen.getByText('Please select a .db backup file')
        ).toBeInTheDocument();
      });
    });

    it('calls importDatabase and lock when restore is confirmed', async () => {
      const user = userEvent.setup();
      renderSettings();

      const input = screen.getByTestId('dropzone-input');
      const file = new File(['test'], 'backup.db', {
        type: 'application/octet-stream'
      });

      await user.upload(input, file);

      await waitFor(() => {
        expect(
          screen.getByTestId('backup-restore-confirm')
        ).toBeInTheDocument();
      });

      await user.click(screen.getByTestId('backup-restore-confirm'));

      await waitFor(() => {
        expect(mockImportDatabase).toHaveBeenCalledWith(expect.any(Uint8Array));
      });
      expect(mockLock).toHaveBeenCalledTimes(1);
    });

    it('hides confirmation dialog when cancel is clicked', async () => {
      const user = userEvent.setup();
      renderSettings();

      const input = screen.getByTestId('dropzone-input');
      const file = new File(['test'], 'backup.db', {
        type: 'application/octet-stream'
      });

      await user.upload(input, file);

      await waitFor(() => {
        expect(
          screen.getByTestId('backup-restore-confirm')
        ).toBeInTheDocument();
      });

      await user.click(screen.getByText('Cancel'));

      await waitFor(() => {
        expect(
          screen.queryByText('Warning: This will replace your current data')
        ).not.toBeInTheDocument();
      });
    });

    it('shows error message when restore fails', async () => {
      const consoleSpy = mockConsoleError();
      mockImportDatabase.mockRejectedValue(new Error('Restore failed'));

      const user = userEvent.setup();
      renderSettings();

      const input = screen.getByTestId('dropzone-input');
      const file = new File(['test'], 'backup.db', {
        type: 'application/octet-stream'
      });

      await user.upload(input, file);

      await waitFor(() => {
        expect(
          screen.getByTestId('backup-restore-confirm')
        ).toBeInTheDocument();
      });

      await user.click(screen.getByTestId('backup-restore-confirm'));

      await waitFor(() => {
        expect(screen.getByText('Restore failed')).toBeInTheDocument();
      });
      expect(consoleSpy).toHaveBeenCalledWith(
        'Restore failed:',
        expect.any(Error)
      );
      consoleSpy.mockRestore();
    });
  });
});
