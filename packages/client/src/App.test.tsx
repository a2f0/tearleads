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

    // All nav items have test IDs and appear in both mobile menu and sidebar
    for (const item of navItems) {
      if (item.testId) {
        expect(screen.getAllByTestId(item.testId)).toHaveLength(2);
      }
      expect(screen.getAllByText(item.label)).toHaveLength(2);
    }
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
