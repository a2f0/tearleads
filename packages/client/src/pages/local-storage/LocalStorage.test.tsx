import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { mockConsoleError } from '@/test/console-mocks';
import { LocalStorage } from './LocalStorage';

// Store localStorage data for tests
let localStorageData: Record<string, string> = {};

function renderLocalStorage() {
  return render(
    <MemoryRouter>
      <LocalStorage />
    </MemoryRouter>
  );
}

describe('LocalStorage', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    localStorageData = {};

    // Reset localStorage mock with proper methods
    Object.defineProperty(window, 'localStorage', {
      value: {
        getItem: vi.fn((key: string) => localStorageData[key] ?? null),
        setItem: vi.fn((key: string, value: string) => {
          localStorageData[key] = value;
        }),
        removeItem: vi.fn((key: string) => {
          delete localStorageData[key];
        }),
        clear: vi.fn(() => {
          localStorageData = {};
        }),
        key: vi.fn(
          (index: number) => Object.keys(localStorageData)[index] ?? null
        ),
        get length() {
          return Object.keys(localStorageData).length;
        }
      },
      writable: true
    });
  });

  describe('page rendering', () => {
    it('renders the page title', () => {
      renderLocalStorage();

      expect(screen.getByText('Local Storage Browser')).toBeInTheDocument();
    });

    it('renders Refresh button', () => {
      renderLocalStorage();

      expect(
        screen.getByRole('button', { name: 'Refresh' })
      ).toBeInTheDocument();
    });
  });

  describe('empty state', () => {
    it('shows empty state message when localStorage is empty', async () => {
      renderLocalStorage();

      await waitFor(() => {
        expect(screen.getByText('localStorage is empty.')).toBeInTheDocument();
      });
    });

    it('does not show Clear All button when empty', async () => {
      renderLocalStorage();

      await waitFor(() => {
        expect(
          screen.queryByRole('button', { name: 'Clear all localStorage' })
        ).not.toBeInTheDocument();
      });
    });
  });

  describe('with localStorage data', () => {
    beforeEach(() => {
      localStorageData = {
        'test-key-1': 'test-value-1',
        'test-key-2': 'test-value-2',
        'long-key': 'a'.repeat(150) // Long value for expansion testing
      };
    });

    it('displays storage entries', async () => {
      renderLocalStorage();

      await waitFor(() => {
        expect(screen.getByText('test-key-1')).toBeInTheDocument();
        expect(screen.getByText('test-key-2')).toBeInTheDocument();
      });
    });

    it('displays entry count and total size', async () => {
      renderLocalStorage();

      await waitFor(() => {
        expect(screen.getByText(/3 entries/)).toBeInTheDocument();
      });
    });

    it('shows Clear All button when entries exist', async () => {
      renderLocalStorage();

      await waitFor(() => {
        expect(
          screen.getByRole('button', { name: 'Clear all localStorage' })
        ).toBeInTheDocument();
      });
    });

    it('displays entry values', async () => {
      renderLocalStorage();

      await waitFor(() => {
        expect(screen.getByText('test-value-1')).toBeInTheDocument();
        expect(screen.getByText('test-value-2')).toBeInTheDocument();
      });
    });

    it('truncates long values with ellipsis', async () => {
      renderLocalStorage();

      await waitFor(() => {
        // Long value should be truncated to 100 chars + ellipsis
        const longValuePreview = screen.getByText(/^a{100}\.\.\.$/);
        expect(longValuePreview).toBeInTheDocument();
      });
    });

    it('expands truncated value when "Show more" is clicked', async () => {
      const user = userEvent.setup();
      renderLocalStorage();

      await waitFor(() => {
        expect(screen.getByText('Show more')).toBeInTheDocument();
      });

      await user.click(screen.getByText('Show more'));

      await waitFor(() => {
        expect(screen.getByText('Show less')).toBeInTheDocument();
        // Full value should now be visible
        expect(screen.getByText('a'.repeat(150))).toBeInTheDocument();
      });
    });

    it('collapses expanded value when "Show less" is clicked', async () => {
      const user = userEvent.setup();
      renderLocalStorage();

      await waitFor(() => {
        expect(screen.getByText('Show more')).toBeInTheDocument();
      });

      await user.click(screen.getByText('Show more'));
      await user.click(screen.getByText('Show less'));

      await waitFor(() => {
        expect(screen.getByText('Show more')).toBeInTheDocument();
      });
    });
  });

  describe('delete functionality', () => {
    beforeEach(() => {
      localStorageData = {
        'delete-me': 'value-to-delete'
      };
    });

    it('deletes entry when delete button is clicked and confirmed', async () => {
      const user = userEvent.setup();
      renderLocalStorage();

      await waitFor(() => {
        expect(screen.getByText('delete-me')).toBeInTheDocument();
      });

      // Find and click delete button
      const deleteButton = screen.getByTitle('Delete');
      await user.click(deleteButton);

      await waitFor(() => {
        expect(screen.getByTestId('confirm-dialog')).toBeInTheDocument();
      });

      await user.click(screen.getByTestId('confirm-dialog-confirm'));

      await waitFor(() => {
        expect(localStorage.removeItem).toHaveBeenCalledWith('delete-me');
      });
    });

    it('does not delete entry when confirmation is cancelled', async () => {
      const user = userEvent.setup();
      renderLocalStorage();

      await waitFor(() => {
        expect(screen.getByText('delete-me')).toBeInTheDocument();
      });

      const deleteButton = screen.getByTitle('Delete');
      await user.click(deleteButton);

      await waitFor(() => {
        expect(screen.getByTestId('confirm-dialog')).toBeInTheDocument();
      });

      await user.click(screen.getByTestId('confirm-dialog-cancel'));

      expect(localStorage.removeItem).not.toHaveBeenCalled();
    });

    it('resets confirming state when delete dialog is reopened', async () => {
      localStorageData = {
        alpha: 'value-a',
        beta: 'value-b'
      };
      const user = userEvent.setup();
      renderLocalStorage();

      await waitFor(() => {
        expect(screen.getByText('alpha')).toBeInTheDocument();
        expect(screen.getByText('beta')).toBeInTheDocument();
      });

      const deleteButtons = screen.getAllByTitle('Delete');
      await user.click(deleteButtons[0]);

      await waitFor(() => {
        expect(screen.getByTestId('confirm-dialog')).toBeInTheDocument();
      });

      await user.click(screen.getByTestId('confirm-dialog-confirm'));

      await waitFor(() => {
        expect(localStorage.removeItem).toHaveBeenCalledWith('alpha');
        expect(screen.queryByTestId('confirm-dialog')).not.toBeInTheDocument();
      });

      const remainingDeleteButton = screen.getByTitle('Delete');
      await user.click(remainingDeleteButton);

      expect(screen.getByText('Delete')).toBeInTheDocument();
      expect(screen.queryByText('Deleting...')).not.toBeInTheDocument();
      expect(screen.getByTestId('confirm-dialog-confirm')).not.toBeDisabled();
      expect(screen.getByTestId('confirm-dialog-cancel')).not.toBeDisabled();
    });
  });

  describe('clear all functionality', () => {
    beforeEach(() => {
      localStorageData = {
        key1: 'value1',
        key2: 'value2'
      };
    });

    it('clears all entries when Clear All is clicked and confirmed', async () => {
      const user = userEvent.setup();
      renderLocalStorage();

      const clearAllButton = await screen.findByRole('button', {
        name: 'Clear all localStorage'
      });

      await user.click(clearAllButton);

      await waitFor(() => {
        expect(screen.getByTestId('confirm-dialog')).toBeInTheDocument();
        expect(
          screen.getByText(/Are you sure you want to clear ALL localStorage/)
        ).toBeInTheDocument();
      });

      await user.click(screen.getByTestId('confirm-dialog-confirm'));

      await waitFor(() => {
        expect(localStorage.clear).toHaveBeenCalled();
      });
    });

    it('does not clear when confirmation is cancelled', async () => {
      const user = userEvent.setup();
      renderLocalStorage();

      const clearAllButton = await screen.findByRole('button', {
        name: 'Clear all localStorage'
      });

      await user.click(clearAllButton);

      await waitFor(() => {
        expect(screen.getByTestId('confirm-dialog')).toBeInTheDocument();
      });

      await user.click(screen.getByTestId('confirm-dialog-cancel'));

      expect(localStorage.clear).not.toHaveBeenCalled();
    });
  });

  describe('refresh functionality', () => {
    it('refreshes storage contents when Refresh is clicked', async () => {
      const user = userEvent.setup();
      renderLocalStorage();

      await waitFor(() => {
        expect(screen.getByText('localStorage is empty.')).toBeInTheDocument();
      });

      // Add data to localStorage
      localStorageData = { 'new-key': 'new-value' };

      await user.click(screen.getByRole('button', { name: 'Refresh' }));

      await waitFor(() => {
        expect(screen.getByText('new-key')).toBeInTheDocument();
      });
    });
  });

  describe('error handling', () => {
    it('displays error when localStorage read fails', async () => {
      const consoleSpy = mockConsoleError();
      const mockError = new Error('Storage access denied');
      Object.defineProperty(window, 'localStorage', {
        value: {
          get length() {
            throw mockError;
          },
          key: () => {
            throw mockError;
          },
          getItem: () => {
            throw mockError;
          },
          setItem: () => {
            throw mockError;
          },
          removeItem: () => {
            throw mockError;
          },
          clear: () => {
            throw mockError;
          }
        },
        writable: true
      });

      renderLocalStorage();

      await waitFor(() => {
        expect(screen.getByText('Storage access denied')).toBeInTheDocument();
      });
      expect(consoleSpy).toHaveBeenCalledWith(
        'Failed to read localStorage:',
        expect.any(Error)
      );
      consoleSpy.mockRestore();
    });
  });

  describe('singular/plural entry count', () => {
    it('shows singular "entry" for 1 entry', async () => {
      localStorageData = { 'only-key': 'only-value' };

      renderLocalStorage();

      await waitFor(() => {
        expect(screen.getByText(/1 entry/)).toBeInTheDocument();
      });
    });

    it('shows plural "entries" for multiple entries', async () => {
      localStorageData = { key1: 'value1', key2: 'value2' };

      renderLocalStorage();

      await waitFor(() => {
        expect(screen.getByText(/2 entries/)).toBeInTheDocument();
      });
    });
  });
});
