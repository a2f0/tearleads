/**
 * VFS page integration tests with real SQLite database.
 *
 * These tests mount the full app (AppRoutes) with a real in-memory database,
 * simulating what a user sees when navigating to the VFS Explorer page.
 */

// Import integration setup FIRST - this sets up mocks for adapters and key manager
import '../test/setupIntegration';

import { notes, vfsRegistry } from '@tearleads/db/sqlite';
import { resetTestKeyManager } from '@tearleads/db-test-utils';
import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { desc } from 'drizzle-orm';
import { Suspense } from 'react';
import { beforeEach, describe, expect, it } from 'vitest';
import { AppRoutes } from '../AppRoutes';
import { getDatabase } from '../db';
import { renderWithDatabase } from '../test/renderWithDatabase';

const LAZY_LOAD_TIMEOUT = 5000;

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

/**
 * Helper: navigate to SQLite page and set up the database.
 * Returns after the database is unlocked.
 */
async function setupDatabaseViaSqlitePage(
  user: ReturnType<typeof userEvent.setup>
) {
  await user.click(screen.getByTestId('mobile-menu-button'));
  const dropdown = screen.getByTestId('mobile-menu-dropdown');
  await user.click(within(dropdown).getByTestId('sqlite-link'));

  await waitFor(() => {
    expect(screen.getByTestId('database-test')).toBeInTheDocument();
  });

  const passwordInput = screen.getByTestId('db-password-input');
  await user.clear(passwordInput);
  await user.type(passwordInput, 'my-test-password');
  await user.click(screen.getByTestId('db-setup-button'));

  await waitFor(() => {
    expect(screen.getByTestId('db-test-result')).toHaveTextContent(
      'Database setup complete'
    );
  });
}

/** Helper: open mobile menu and click a nav link. */
async function navigateViaMobileMenu(
  user: ReturnType<typeof userEvent.setup>,
  testId: string
) {
  await user.click(screen.getByTestId('mobile-menu-button'));
  const dropdown = screen.getByTestId('mobile-menu-dropdown');
  await user.click(within(dropdown).getByTestId(testId));
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
      expect(screen.getByText(/Database is not set up/)).toBeInTheDocument();

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

      // 2-5. Navigate to SQLite and set up the database
      await setupDatabaseViaSqlitePage(user);

      // 6. Navigate back to VFS via mobile menu
      await navigateViaMobileMenu(user, 'vfs-link');

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

  describe('VFS All Items with note creation', () => {
    it('shows a created note in All Items after navigating back', async () => {
      const user = userEvent.setup();

      await renderApp();

      // 1. Set up the database
      await waitFor(() => {
        expect(screen.getByTestId('inline-unlock')).toBeInTheDocument();
      });
      await setupDatabaseViaSqlitePage(user);

      // 2. Navigate to VFS
      await navigateViaMobileMenu(user, 'vfs-link');
      await waitFor(() => {
        expect(
          screen.getByRole('heading', { name: 'VFS Explorer' })
        ).toBeInTheDocument();
        expect(screen.queryByTestId('inline-unlock')).not.toBeInTheDocument();
      });

      // 3. Click "All Items" in the tree panel
      await user.click(screen.getByText('All Items'));

      // 4. Verify All Items is empty
      await waitFor(() => {
        expect(screen.getByText('No items in registry')).toBeInTheDocument();
      });

      // 5. Navigate to Notes page
      await navigateViaMobileMenu(user, 'notes-link');

      // Notes is lazy-loaded and may take longer to resolve under full-suite load
      await waitFor(
        () => {
          expect(
            screen.getByRole('heading', { name: 'Notes' })
          ).toBeInTheDocument();
        },
        { timeout: LAZY_LOAD_TIMEOUT }
      );

      // 6. Create a new note (empty notes list shows the add-note-card)
      await waitFor(
        () => {
          expect(screen.getByTestId('add-note-card')).toBeInTheDocument();
        },
        { timeout: LAZY_LOAD_TIMEOUT }
      );
      await user.click(screen.getByTestId('add-note-card'));

      // 7. Wait for navigation to NoteDetail page (lazy-loaded)
      await waitFor(
        () => {
          expect(screen.getByTestId('note-title')).toBeInTheDocument();
        },
        { timeout: LAZY_LOAD_TIMEOUT }
      );

      // 8. Register the note in VFS registry (the page-route code path
      //    creates notes without VFS registration; the window-based flow
      //    does register. We simulate the full registration here.)
      const db = getDatabase();
      const [latestNote] = await db
        .select({ id: notes.id })
        .from(notes)
        .orderBy(desc(notes.createdAt))
        .limit(1);
      expect(latestNote).toBeDefined();

      await db.insert(vfsRegistry).values({
        id: latestNote?.id,
        objectType: 'note',
        ownerId: null,
        encryptedSessionKey: null,
        createdAt: new Date()
      });

      // 9. Navigate back to VFS
      await navigateViaMobileMenu(user, 'vfs-link');
      await waitFor(() => {
        expect(
          screen.getByRole('heading', { name: 'VFS Explorer' })
        ).toBeInTheDocument();
      });

      // 10. Click "All Items" and verify the note appears
      await user.click(screen.getByText('All Items'));

      await waitFor(() => {
        expect(screen.getByText('Untitled Note')).toBeInTheDocument();
      });
      expect(
        screen.queryByText('No items in registry')
      ).not.toBeInTheDocument();
    });
  });
});
