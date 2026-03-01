/**
 * VFS page integration tests with real SQLite database.
 *
 * These tests mount the full app (AppRoutes) with a real in-memory database,
 * simulating what a user sees when navigating to the VFS Explorer page.
 */

// Import integration setup FIRST - this sets up mocks for adapters and key manager
import '../test/setupIntegration';

import { resetTestKeyManager } from '@tearleads/db-test-utils';
import { screen, waitFor } from '@testing-library/react';
import { Suspense } from 'react';
import { beforeEach, describe, expect, it } from 'vitest';
import { AppRoutes } from '../AppRoutes';
import { renderWithDatabase } from '../test/renderWithDatabase';

function renderVfsPage() {
  return renderWithDatabase(
    <Suspense fallback={<div>Loading...</div>}>
      <AppRoutes />
    </Suspense>,
    {
      initialRoute: '/vfs',
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
      await renderVfsPage();

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
      await renderVfsPage();

      await waitFor(() => {
        expect(screen.getByTestId('app-container')).toBeInTheDocument();
      });

      expect(screen.getByTestId('mobile-menu-button')).toBeInTheDocument();
    });
  });
});
