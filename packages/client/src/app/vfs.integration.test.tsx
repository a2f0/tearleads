/**
 * VFS page integration tests with real SQLite database.
 *
 * These tests mount the full app (AppRoutes) with a real in-memory database,
 * simulating what a user sees when navigating to the VFS Explorer page.
 */

// Import integration setup FIRST - this sets up mocks for adapters and key manager
import '../test/setupIntegration';

import { resetTestKeyManager } from '@tearleads/db-test-utils';
import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { Suspense } from 'react';
import { beforeEach, describe, expect, it } from 'vitest';
import { AppRoutes } from '../AppRoutes';
import { renderWithDatabase } from '../test/renderWithDatabase';

function renderApp(initialRoute = '/vfs') {
  return renderWithDatabase(
    <Suspense fallback={<div>Loading...</div>}>
      <AppRoutes />
    </Suspense>,
    {
      initialRoute,
      autoSetup: false,
      waitForReady: false
    }
  );
}

describe('VFS Integration Tests', () => {
  beforeEach(() => {
    resetTestKeyManager();
  });

  describe('new user (database not set up)', () => {
    it('shows database not set up state with link to SQLite page', async () => {
      await renderApp();

      await waitFor(() => {
        expect(screen.getByTestId('inline-unlock')).toBeInTheDocument();
      });

      expect(
        screen.getByRole('heading', { name: 'VFS Explorer' })
      ).toBeInTheDocument();
      expect(
        screen.getByText(/Database is not set up/)
      ).toBeInTheDocument();

      const sqliteLink = screen.getByText('SQLite page');
      expect(sqliteLink.closest('a')).toHaveAttribute('href', '/sqlite');
    });

    it('renders the app shell around VFS page', async () => {
      await renderApp();

      await waitFor(() => {
        expect(screen.getByTestId('app-container')).toBeInTheDocument();
      });

      expect(screen.getByTestId('mobile-menu-button')).toBeInTheDocument();
    });
  });

  describe('database setup flow', () => {
    it('can navigate to SQLite, setup database, and return to VFS unlocked', async () => {
      const user = userEvent.setup();

      await renderApp();

      // 1. VFS shows "not set up" message
      await waitFor(() => {
        expect(screen.getByTestId('inline-unlock')).toBeInTheDocument();
      });
      expect(screen.getByText(/Database is not set up/)).toBeInTheDocument();

      // 2. Navigate to SQLite page via mobile menu
      await user.click(screen.getByTestId('mobile-menu-button'));
      const dropdown = screen.getByTestId('mobile-menu-dropdown');
      await user.click(within(dropdown).getByTestId('sqlite-link'));

      // 3. SQLite page loads with DatabaseTest component
      await waitFor(() => {
        expect(screen.getByTestId('database-test')).toBeInTheDocument();
      });
      expect(screen.getByTestId('db-status')).toHaveTextContent('Not Set Up');

      // 4. Setup the database with a password
      const passwordInput = screen.getByTestId('db-password-input');
      await user.clear(passwordInput);
      await user.type(passwordInput, 'my-test-password');
      await user.click(screen.getByTestId('db-setup-button'));

      // 5. Wait for setup to complete
      await waitFor(() => {
        expect(screen.getByTestId('db-test-result')).toHaveTextContent(
          'Database setup complete'
        );
      });
      expect(screen.getByTestId('db-status')).toHaveTextContent('Unlocked');

      // 6. Navigate back to VFS via mobile menu
      await user.click(screen.getByTestId('mobile-menu-button'));
      const dropdown2 = screen.getByTestId('mobile-menu-dropdown');
      await user.click(within(dropdown2).getByTestId('vfs-link'));

      // 7. VFS should now show unlocked state (no "not set up" message)
      await waitFor(() => {
        expect(
          screen.getByRole('heading', { name: 'VFS Explorer' })
        ).toBeInTheDocument();
        expect(screen.queryByTestId('inline-unlock')).not.toBeInTheDocument();
      });

      // The file upload input is only rendered when database is unlocked
      expect(screen.getByTestId('vfs-file-input')).toBeInTheDocument();
    });
  });
});
