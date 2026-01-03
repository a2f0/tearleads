import { ThemeProvider } from '@rapid/ui';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
import { describe, expect, it, vi } from 'vitest';
import App from './App';
import { navItems } from './components/Sidebar';

vi.mock('@/lib/api', () => ({
  api: {
    health: {
      get: vi.fn()
    }
  }
}));

// Mock the database context for AccountSwitcher
vi.mock('@/db/hooks/useDatabase', () => ({
  useDatabaseContext: vi.fn(() => ({
    currentInstanceId: 'test-instance',
    currentInstanceName: 'Instance 1',
    instances: [
      {
        id: 'test-instance',
        name: 'Instance 1',
        createdAt: Date.now(),
        lastAccessedAt: Date.now()
      }
    ],
    createInstance: vi.fn(async () => 'new-instance'),
    switchInstance: vi.fn(async () => true),
    deleteInstance: vi.fn(async () => {}),
    refreshInstances: vi.fn(async () => {}),
    isLoading: false
  }))
}));

function renderApp() {
  return render(
    <MemoryRouter>
      <ThemeProvider>
        <App />
      </ThemeProvider>
    </MemoryRouter>
  );
}

describe('App', () => {
  it('renders the app container', () => {
    renderApp();

    expect(screen.getByTestId('app-container')).toBeInTheDocument();
  });

  it('renders the app title', () => {
    renderApp();

    expect(screen.getByText('Tearleads')).toBeInTheDocument();
  });

  it('renders the footer with copyright', () => {
    renderApp();

    const currentYear = new Date().getFullYear();
    expect(
      screen.getByText(`© ${currentYear} Tearleads. All rights reserved.`)
    ).toBeInTheDocument();
  });

  it('renders the mobile menu button in header', () => {
    renderApp();

    expect(screen.getByTestId('mobile-menu-button')).toBeInTheDocument();
  });

  it('renders the sidebar with navigation links', () => {
    renderApp();

    const sidebar = screen.getByRole('navigation');
    expect(sidebar).toBeInTheDocument();

    // Sidebar contains all navigation links
    const sidebarLinks = sidebar.querySelectorAll('a');
    expect(sidebarLinks).toHaveLength(navItems.length);
  });

  it('renders navigation in both mobile menu and sidebar', async () => {
    const user = userEvent.setup();
    renderApp();

    // Open mobile menu to access header nav links
    await user.click(screen.getByTestId('mobile-menu-button'));

    // Header nav links (with test IDs) inside mobile menu dropdown
    expect(screen.getByTestId('files-link')).toBeInTheDocument();
    expect(screen.getByTestId('contacts-link')).toBeInTheDocument();
    expect(screen.getByTestId('photos-link')).toBeInTheDocument();
    expect(screen.getByTestId('audio-link')).toBeInTheDocument();
    expect(screen.getByTestId('tables-link')).toBeInTheDocument();
    expect(screen.getByTestId('analytics-link')).toBeInTheDocument();
    expect(screen.getByTestId('sqlite-link')).toBeInTheDocument();
    expect(screen.getByTestId('debug-link')).toBeInTheDocument();
    expect(screen.getByTestId('opfs-link')).toBeInTheDocument();
    expect(screen.getByTestId('cache-storage-link')).toBeInTheDocument();
    expect(screen.getByTestId('local-storage-link')).toBeInTheDocument();
    expect(screen.getByTestId('chat-link')).toBeInTheDocument();
    expect(screen.getByTestId('models-link')).toBeInTheDocument();
    expect(screen.getByTestId('settings-link')).toBeInTheDocument();

    // All nav items appear in both mobile menu and sidebar (2 instances each)
    expect(screen.getAllByText('Files')).toHaveLength(2);
    expect(screen.getAllByText('Contacts')).toHaveLength(2);
    expect(screen.getAllByText('Photos')).toHaveLength(2);
    expect(screen.getAllByText('Audio')).toHaveLength(2);
    expect(screen.getAllByText('Tables')).toHaveLength(2);
    expect(screen.getAllByText('Analytics')).toHaveLength(2);
    expect(screen.getAllByText('SQLite')).toHaveLength(2);
    expect(screen.getAllByText('Debug')).toHaveLength(2);
    expect(screen.getAllByText('OPFS')).toHaveLength(2);
    expect(screen.getAllByText('Cache Storage')).toHaveLength(2);
    expect(screen.getAllByText('Local Storage')).toHaveLength(2);
    expect(screen.getAllByText('Chat')).toHaveLength(2);
    expect(screen.getAllByText('Models')).toHaveLength(2);
    expect(screen.getAllByText('Settings')).toHaveLength(2);
  });

  it('mobile menu has lg:hidden class for mobile-only display', () => {
    renderApp();

    const mobileMenuContainer =
      screen.getByTestId('mobile-menu-button').parentElement;
    expect(mobileMenuContainer).toHaveClass('lg:hidden');
  });

  it('sidebar has hidden lg:flex classes for desktop-only display', () => {
    renderApp();

    // The sidebar (aside element) itself has the hidden/lg:flex classes
    const sidebar = screen.getByRole('navigation').closest('aside');
    expect(sidebar).toHaveClass('hidden');
    expect(sidebar).toHaveClass('lg:flex');
  });

  it('renders the logo', () => {
    renderApp();

    expect(screen.getByAltText('Tearleads')).toBeInTheDocument();
  });
});
