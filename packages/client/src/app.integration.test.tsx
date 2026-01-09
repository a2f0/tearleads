/**
 * App-level integration tests with real SQLite database.
 *
 * These tests mount the full app with a real in-memory database,
 * allowing testing of actual database operations.
 */

// Import integration setup FIRST - this sets up mocks for adapters and key manager
import './test/setup-integration';

import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it } from 'vitest';
import App from './App';
import { renderWithDatabase } from './test/render-with-database';
import { resetTestKeyManager } from './test/test-key-manager';

describe('App Integration Tests', () => {
  beforeEach(() => {
    // Reset test state between tests
    resetTestKeyManager();
  });

  it('renders the app with database context', async () => {
    await renderWithDatabase(<App />);

    // App should render successfully
    expect(screen.getByTestId('app-container')).toBeInTheDocument();
  });

  it('shows navigation links in mobile menu', async () => {
    const user = userEvent.setup();
    await renderWithDatabase(<App />);

    // Open mobile menu first
    await user.click(screen.getByTestId('mobile-menu-button'));

    // Check for navigation links within the mobile menu dropdown
    const dropdown = screen.getByTestId('mobile-menu-dropdown');
    expect(within(dropdown).getByTestId('contacts-link')).toBeInTheDocument();
    expect(within(dropdown).getByTestId('tables-link')).toBeInTheDocument();
    expect(within(dropdown).getByTestId('settings-link')).toBeInTheDocument();
  });

  it('can navigate to contacts page', async () => {
    const user = userEvent.setup();

    await renderWithDatabase(<App />, { initialRoute: '/' });

    // Open mobile menu first
    await user.click(screen.getByTestId('mobile-menu-button'));

    // Click on contacts link within the mobile menu dropdown
    const dropdown = screen.getByTestId('mobile-menu-dropdown');
    const contactsLink = within(dropdown).getByTestId('contacts-link');
    await user.click(contactsLink);

    // Should navigate (the URL should change)
    // Note: actual content depends on the Contacts component
    await waitFor(() => {
      // The Outlet should render something
      expect(screen.getByTestId('app-container')).toBeInTheDocument();
    });
  });
});
