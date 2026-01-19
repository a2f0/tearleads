/**
 * Integration tests for the Tables page.
 *
 * These tests use the vitest integration test infrastructure with real SQLite
 * operations to verify table listing functionality.
 */

// Import integration setup FIRST
import '../test/setup-integration';

import { screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it } from 'vitest';
import { getDatabase } from '@/db';
import { userSettings } from '@/db/schema';
import { renderWithDatabase } from '../test/render-with-database';
import { resetTestKeyManager } from '../test/test-key-manager';
import { Tables } from './Tables';

describe('Tables Page Integration Tests', () => {
  beforeEach(async () => {
    await resetTestKeyManager();
  });

  describe('when database is unlocked', () => {
    it('displays schema tables', async () => {
      await renderWithDatabase(<Tables />, {
        initialRoute: '/sqlite/tables'
      });

      // Wait for tables to load
      await waitFor(() => {
        // These are the tables created by the schema
        expect(screen.getByText('user_settings')).toBeInTheDocument();
        expect(screen.getByText('contacts')).toBeInTheDocument();
        expect(screen.getByText('files')).toBeInTheDocument();
      });
    });

    it('shows row counts for tables', async () => {
      await renderWithDatabase(<Tables />, {
        initialRoute: '/sqlite/tables'
      });

      // Wait for tables to load
      await waitFor(() => {
        expect(screen.getByText('user_settings')).toBeInTheDocument();
      });

      // Check that the user_settings table shows row count
      const settingsEntry = screen.getByText('user_settings').closest('a');
      expect(settingsEntry).toHaveTextContent(/\d+ rows?/);
    });

    it('shows correct row count after adding data', async () => {
      const user = userEvent.setup();

      await renderWithDatabase(<Tables />, {
        initialRoute: '/sqlite/tables'
      });

      // Wait for initial tables
      await waitFor(() => {
        expect(screen.getByText('user_settings')).toBeInTheDocument();
      });

      // Add data to user_settings
      const db = getDatabase();
      await db.insert(userSettings).values({
        key: 'test_key_1',
        value: 'test_value_1',
        updatedAt: new Date()
      });
      await db.insert(userSettings).values({
        key: 'test_key_2',
        value: 'test_value_2',
        updatedAt: new Date()
      });

      // Click refresh
      const refreshButton = screen.getByRole('button', { name: /refresh/i });
      await user.click(refreshButton);

      // Wait for updated counts
      await waitFor(() => {
        // Find the user_settings table entry and check it shows 2 rows
        const settingsEntry = screen.getByText('user_settings').closest('a');
        expect(settingsEntry).toHaveTextContent('2 rows');
      });
    });

    it('has a refresh button', async () => {
      await renderWithDatabase(<Tables />, {
        initialRoute: '/sqlite/tables'
      });

      await waitFor(() => {
        expect(
          screen.getByRole('button', { name: /refresh/i })
        ).toBeInTheDocument();
      });
    });

    it('table links navigate to table detail', async () => {
      await renderWithDatabase(<Tables />, {
        initialRoute: '/sqlite/tables'
      });

      // Wait for tables to load
      await waitFor(() => {
        expect(screen.getByText('user_settings')).toBeInTheDocument();
      });

      // Check that links have correct href
      const settingsLink = screen.getByText('user_settings').closest('a');
      expect(settingsLink).toHaveAttribute(
        'href',
        '/sqlite/tables/user_settings'
      );
    });

    it('shows all expected schema tables', async () => {
      await renderWithDatabase(<Tables />, {
        initialRoute: '/sqlite/tables'
      });

      // Wait for tables to load
      await waitFor(() => {
        // Core schema tables
        expect(screen.getByText('user_settings')).toBeInTheDocument();
        expect(screen.getByText('contacts')).toBeInTheDocument();
        expect(screen.getByText('contact_emails')).toBeInTheDocument();
        expect(screen.getByText('contact_phones')).toBeInTheDocument();
        expect(screen.getByText('files')).toBeInTheDocument();
        expect(screen.getByText('analytics_events')).toBeInTheDocument();
        expect(screen.getByText('secrets')).toBeInTheDocument();
        expect(screen.getByText('sync_metadata')).toBeInTheDocument();
        expect(screen.getByText('schema_migrations')).toBeInTheDocument();
      });
    });
  });
});
