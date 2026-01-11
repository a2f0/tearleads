/**
 * Integration tests for the Contacts page.
 *
 * These tests use the vitest integration test infrastructure with real SQLite
 * operations to verify contact management functionality.
 */

// Import integration setup FIRST
import '../../test/setup-integration';

import { screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { getDatabase } from '@/db';
import { contactEmails, contactPhones, contacts } from '@/db/schema';
import { renderWithDatabase } from '../../test/render-with-database';
import { resetTestKeyManager } from '../../test/test-key-manager';
import { Contacts } from './Contacts';

// Mock useVirtualizer to simplify testing
vi.mock('@tanstack/react-virtual', () => ({
  useVirtualizer: vi.fn(({ count }) => ({
    getVirtualItems: () =>
      Array.from({ length: count }, (_, i) => ({
        index: i,
        start: i * 72,
        size: 72,
        key: i
      })),
    getTotalSize: () => count * 72,
    measureElement: vi.fn()
  }))
}));

// Helper to create test contacts directly in the database
// Must be called after renderWithDatabase has set up the database
async function createTestContact(data: {
  id: string;
  firstName: string;
  lastName?: string;
  email?: string;
  phone?: string;
}) {
  const db = getDatabase();

  await db.insert(contacts).values({
    id: data.id,
    firstName: data.firstName,
    lastName: data.lastName ?? null,
    birthday: null,
    createdAt: new Date(),
    updatedAt: new Date(),
    deleted: false
  });

  if (data.email) {
    await db.insert(contactEmails).values({
      id: `${data.id}-email`,
      contactId: data.id,
      email: data.email,
      label: 'work',
      isPrimary: true
    });
  }

  if (data.phone) {
    await db.insert(contactPhones).values({
      id: `${data.id}-phone`,
      contactId: data.id,
      phoneNumber: data.phone,
      label: 'mobile',
      isPrimary: true
    });
  }
}

describe('Contacts Page Integration Tests', () => {
  beforeEach(async () => {
    await resetTestKeyManager();
  });

  describe('when database is unlocked', () => {
    it('shows add contact card when no contacts exist', async () => {
      await renderWithDatabase(<Contacts />, {
        initialRoute: '/contacts'
      });

      await waitFor(() => {
        expect(screen.getByTestId('add-contact-card')).toBeInTheDocument();
        expect(screen.getByText('Add new contact')).toBeInTheDocument();
      });
    });

    it('hides search input when no contacts exist', async () => {
      await renderWithDatabase(<Contacts />, {
        initialRoute: '/contacts'
      });

      await waitFor(() => {
        expect(screen.getByTestId('add-contact-card')).toBeInTheDocument();
      });

      // Search should be hidden when no contacts exist
      expect(
        screen.queryByPlaceholderText('Search contacts...')
      ).not.toBeInTheDocument();
    });

    it('shows Import CSV dropzone', async () => {
      await renderWithDatabase(<Contacts />, {
        initialRoute: '/contacts'
      });

      await waitFor(() => {
        expect(screen.getByText('Import CSV')).toBeInTheDocument();
      });
    });

    it('shows search and refresh when contacts exist', async () => {
      // Create contact before rendering
      await renderWithDatabase(<Contacts />, {
        initialRoute: '/contacts',
        beforeRender: async () => {
          const db = getDatabase();
          await db.insert(contacts).values({
            id: 'contact-1',
            firstName: 'Test',
            lastName: 'User',
            birthday: null,
            createdAt: new Date(),
            updatedAt: new Date(),
            deleted: false
          });
        }
      });

      await waitFor(() => {
        expect(
          screen.getByPlaceholderText('Search contacts...')
        ).toBeInTheDocument();
        expect(
          screen.getByRole('button', { name: /refresh/i })
        ).toBeInTheDocument();
      });
    });

    it('displays contacts when they exist', async () => {
      // Create contacts before rendering
      await renderWithDatabase(<Contacts />, {
        initialRoute: '/contacts',
        beforeRender: async () => {
          await createTestContact({
            id: 'contact-1',
            firstName: 'John',
            lastName: 'Doe',
            email: 'john@example.com',
            phone: '555-1234'
          });
          await createTestContact({
            id: 'contact-2',
            firstName: 'Jane',
            lastName: 'Smith',
            email: 'jane@example.com'
          });
        }
      });

      // Wait for contacts to appear
      await waitFor(() => {
        expect(screen.getByText('John Doe')).toBeInTheDocument();
        expect(screen.getByText('Jane Smith')).toBeInTheDocument();
      });

      // Check email and phone are displayed
      expect(screen.getByText('john@example.com')).toBeInTheDocument();
      expect(screen.getByText('555-1234')).toBeInTheDocument();
      expect(screen.getByText('jane@example.com')).toBeInTheDocument();
    });

    it('filters contacts by search query', async () => {
      const user = userEvent.setup();

      // Create contacts before rendering
      await renderWithDatabase(<Contacts />, {
        initialRoute: '/contacts',
        beforeRender: async () => {
          await createTestContact({
            id: 'contact-1',
            firstName: 'John',
            lastName: 'Doe',
            email: 'john@example.com'
          });
          await createTestContact({
            id: 'contact-2',
            firstName: 'Jane',
            lastName: 'Smith',
            email: 'jane@example.com'
          });
        }
      });

      // Wait for contacts to load
      await waitFor(() => {
        expect(screen.getByText('John Doe')).toBeInTheDocument();
        expect(screen.getByText('Jane Smith')).toBeInTheDocument();
      });

      // Search for "John"
      const searchInput = screen.getByPlaceholderText('Search contacts...');
      await user.type(searchInput, 'John');

      // Wait for debounced search
      await waitFor(
        () => {
          expect(screen.getByText('John Doe')).toBeInTheDocument();
          expect(screen.queryByText('Jane Smith')).not.toBeInTheDocument();
        },
        { timeout: 500 }
      );
    });

    it('shows no results message when search has no matches', async () => {
      const user = userEvent.setup();

      // Create contact before rendering
      await renderWithDatabase(<Contacts />, {
        initialRoute: '/contacts',
        beforeRender: async () => {
          await createTestContact({
            id: 'contact-1',
            firstName: 'John',
            lastName: 'Doe'
          });
        }
      });

      await waitFor(() => {
        expect(screen.getByText('John Doe')).toBeInTheDocument();
      });

      // Search for something that doesn't match
      const searchInput = screen.getByPlaceholderText('Search contacts...');
      await user.type(searchInput, 'xyz');

      await waitFor(
        () => {
          expect(
            screen.getByText(/No contacts found matching "xyz"/i)
          ).toBeInTheDocument();
        },
        { timeout: 500 }
      );
    });
  });
});
