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
import { Suspense } from 'react';
import { beforeEach, describe, expect, it } from 'vitest';
import { AppRoutes } from '../AppRoutes';
import { getDatabase } from '../db';
import { renderWithDatabase } from '../test/renderWithDatabase';

// Coverage-mode CI runs can delay lazy route resolution; keep waits generous
// so integration assertions don't race against Suspense fallback rendering.
const LAZY_LOAD_TIMEOUT = 15000;
const SLOW_FLOW_TEST_TIMEOUT = 45000;

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

/** Helper: open mobile menu and click a nav link. */
async function navigateViaMobileMenu(
  user: ReturnType<typeof userEvent.setup>,
  testId: string
) {
  await user.click(screen.getByTestId('mobile-menu-button'));
  const dropdown = screen.getByTestId('mobile-menu-dropdown');
  await user.click(within(dropdown).getByTestId(testId));
}

async function waitForVfsUnlocked(): Promise<void> {
  await waitFor(
    () => {
      expect(
        screen.getByRole('heading', { name: 'VFS Explorer' })
      ).toBeInTheDocument();
      expect(screen.queryByTestId('inline-unlock')).not.toBeInTheDocument();
      expect(screen.getByTestId('vfs-file-input')).toBeInTheDocument();
    },
    { timeout: LAZY_LOAD_TIMEOUT }
  );
}

describe('VFS Integration Tests', () => {
  beforeEach(() => {
    resetTestKeyManager();
  });

  describe('new user (auto-initialized database)', () => {
    it('opens VFS without showing a setup prompt', async () => {
      await renderApp();

      await waitForVfsUnlocked();

      expect(
        screen.queryByText(/Database is not set up/)
      ).not.toBeInTheDocument();
    });

    it('renders the app shell around VFS page', async () => {
      await renderApp();

      await waitFor(
        () => {
          expect(screen.getByTestId('app-container')).toBeInTheDocument();
        },
        { timeout: LAZY_LOAD_TIMEOUT }
      );

      expect(screen.getByTestId('mobile-menu-button')).toBeInTheDocument();
    });
  });

  describe('database setup flow', () => {
    it('stays unlocked when navigating between VFS and SQLite', async () => {
      const user = userEvent.setup();

      await renderApp();

      await waitForVfsUnlocked();

      await navigateViaMobileMenu(user, 'sqlite-link');
      await waitFor(
        () => {
          expect(screen.getByTestId('database-test')).toBeInTheDocument();
          expect(screen.getByTestId('db-status')).toHaveTextContent('Unlocked');
        },
        { timeout: LAZY_LOAD_TIMEOUT }
      );

      // Navigate back to VFS via mobile menu
      await navigateViaMobileMenu(user, 'vfs-link');

      await waitForVfsUnlocked();
    });
  });

  describe('VFS All Items with note creation', () => {
    it(
      'shows a created note in All Items after navigating back',
      async () => {
        const user = userEvent.setup();

        await renderApp();

        // 1. Database is auto-initialized and unlocked
        await waitForVfsUnlocked();

        // 2. Navigate to VFS
        await navigateViaMobileMenu(user, 'vfs-link');
        await waitForVfsUnlocked();

        // 3. Click "All Items" in the tree panel
        await user.click(screen.getByText('All Items'));

        // 4. Verify All Items is empty
        await waitFor(
          () => {
            expect(
              screen.getByText('No items in registry')
            ).toBeInTheDocument();
          },
          { timeout: LAZY_LOAD_TIMEOUT }
        );

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

        const db = getDatabase();

        // 6. Create a note directly in DB to keep this integration flow deterministic.
        const now = new Date();
        const noteId = `vfs-test-note-${now.getTime()}`;
        await db.insert(notes).values({
          id: noteId,
          title: 'Untitled Note',
          content: '',
          createdAt: now,
          updatedAt: now,
          deleted: false
        });

        // 7. Register the note in VFS registry (the page-route code path
        //    creates notes without VFS registration; the window-based flow
        //    does register. We simulate the full registration here.)

        await db.insert(vfsRegistry).values({
          id: noteId,
          objectType: 'note',
          ownerId: null,
          encryptedSessionKey: null,
          createdAt: new Date()
        });

        // 8. Navigate back to VFS
        await navigateViaMobileMenu(user, 'vfs-link');
        await waitFor(
          () => {
            expect(
              screen.getByRole('heading', { name: 'VFS Explorer' })
            ).toBeInTheDocument();
          },
          { timeout: LAZY_LOAD_TIMEOUT }
        );

        // 9. Click "All Items" and verify the note appears
        await user.click(screen.getByText('All Items'));

        await waitFor(
          () => {
            expect(screen.getByText('Untitled Note')).toBeInTheDocument();
          },
          { timeout: LAZY_LOAD_TIMEOUT }
        );
        expect(
          screen.queryByText('No items in registry')
        ).not.toBeInTheDocument();
      },
      SLOW_FLOW_TEST_TIMEOUT
    );
  });
});
