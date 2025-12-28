import { ThemeProvider } from '@rapid/ui';
import { render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { describe, expect, it, vi } from 'vitest';
import App from './App';

vi.mock('@/lib/api', () => ({
  api: {
    health: {
      get: vi.fn()
    }
  }
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

  it('renders the settings link in header', () => {
    renderApp();

    expect(screen.getByTestId('settings-link')).toBeInTheDocument();
  });

  it('renders the sidebar with navigation links', () => {
    renderApp();

    const sidebar = screen.getByRole('navigation');
    expect(sidebar).toBeInTheDocument();

    // Sidebar contains all navigation links
    const sidebarLinks = sidebar.querySelectorAll('a');
    expect(sidebarLinks).toHaveLength(6);
  });

  it('renders navigation in both header and sidebar', () => {
    renderApp();

    // Header nav links (with test IDs)
    expect(screen.getByTestId('contacts-link')).toBeInTheDocument();
    expect(screen.getByTestId('tables-link')).toBeInTheDocument();
    expect(screen.getByTestId('debug-link')).toBeInTheDocument();
    expect(screen.getByTestId('settings-link')).toBeInTheDocument();

    // Sidebar nav links (by text)
    expect(screen.getByText('Files')).toBeInTheDocument();
    expect(screen.getByText('Contacts')).toBeInTheDocument();
    expect(screen.getByText('Tables')).toBeInTheDocument();
    expect(screen.getByText('Debug')).toBeInTheDocument();
    expect(screen.getByText('Models')).toBeInTheDocument();
    expect(screen.getByText('Settings')).toBeInTheDocument();
  });

  it('header nav has lg:hidden class for mobile-only display', () => {
    renderApp();

    const headerNavContainer =
      screen.getByTestId('settings-link').parentElement;
    expect(headerNavContainer).toHaveClass('lg:hidden');
  });

  it('sidebar has hidden lg:flex classes for desktop-only display', () => {
    renderApp();

    const sidebar = screen.getByRole('navigation').parentElement;
    expect(sidebar).toHaveClass('hidden');
    expect(sidebar).toHaveClass('lg:flex');
  });

  it('renders the logo', () => {
    renderApp();

    expect(screen.getByAltText('Tearleads')).toBeInTheDocument();
  });
});
