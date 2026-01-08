import { ThemeProvider } from '@rapid/ui';
import { fireEvent, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
import { describe, expect, it } from 'vitest';
import { MobileMenu } from './MobileMenu';
import { navItems } from './Sidebar';

function renderMobileMenu(initialRoute = '/') {
  return render(
    <MemoryRouter initialEntries={[initialRoute]}>
      <ThemeProvider>
        <MobileMenu />
      </ThemeProvider>
    </MemoryRouter>
  );
}

describe('MobileMenu', () => {
  it('renders the menu button', () => {
    renderMobileMenu();

    expect(screen.getByTestId('mobile-menu-button')).toBeInTheDocument();
  });

  it('has correct aria attributes when closed', () => {
    renderMobileMenu();

    const button = screen.getByTestId('mobile-menu-button');
    expect(button).toHaveAttribute('aria-label', 'Navigation menu');
    expect(button).toHaveAttribute('aria-expanded', 'false');
    expect(button).toHaveAttribute('aria-haspopup', 'true');
  });

  it('has lg:hidden class for mobile-only display', () => {
    renderMobileMenu();

    const container = screen.getByTestId('mobile-menu-button').parentElement;
    expect(container).toHaveClass('lg:hidden');
  });

  it('opens dropdown when button is clicked', async () => {
    const user = userEvent.setup();
    renderMobileMenu();

    const button = screen.getByTestId('mobile-menu-button');
    await user.click(button);

    expect(screen.getByTestId('mobile-menu-dropdown')).toBeInTheDocument();
    expect(button).toHaveAttribute('aria-expanded', 'true');
  });

  it('renders all navigation links in dropdown', async () => {
    const user = userEvent.setup();
    renderMobileMenu();

    await user.click(screen.getByTestId('mobile-menu-button'));

    for (const item of navItems.filter((i) => i.inMobileMenu)) {
      if (item.testId) {
        expect(screen.getByTestId(item.testId)).toBeInTheDocument();
      }
    }
  });

  it('renders links with correct text and href', async () => {
    const user = userEvent.setup();
    renderMobileMenu();

    await user.click(screen.getByTestId('mobile-menu-button'));

    const contactsLink = screen.getByTestId('contacts-link');
    expect(contactsLink).toHaveTextContent('Contacts');
    expect(contactsLink).toHaveAttribute('href', '/contacts');

    const tablesLink = screen.getByTestId('tables-link');
    expect(tablesLink).toHaveTextContent('Tables');
    expect(tablesLink).toHaveAttribute('href', '/tables');

    const sqliteLink = screen.getByTestId('sqlite-link');
    expect(sqliteLink).toHaveTextContent('SQLite');
    expect(sqliteLink).toHaveAttribute('href', '/sqlite');

    const debugLink = screen.getByTestId('debug-link');
    expect(debugLink).toHaveTextContent('Debug');
    expect(debugLink).toHaveAttribute('href', '/debug');

    const settingsLink = screen.getByTestId('settings-link');
    expect(settingsLink).toHaveTextContent('Settings');
    expect(settingsLink).toHaveAttribute('href', '/settings');
  });

  it('closes dropdown when clicking outside', async () => {
    const user = userEvent.setup();
    renderMobileMenu();

    await user.click(screen.getByTestId('mobile-menu-button'));
    expect(screen.getByTestId('mobile-menu-dropdown')).toBeInTheDocument();

    // Click the backdrop (close button)
    const backdrop = screen.getByLabelText('Close navigation menu');
    await user.click(backdrop);

    expect(
      screen.queryByTestId('mobile-menu-dropdown')
    ).not.toBeInTheDocument();
  });

  it('closes dropdown when pressing Escape', async () => {
    const user = userEvent.setup();
    renderMobileMenu();

    await user.click(screen.getByTestId('mobile-menu-button'));
    expect(screen.getByTestId('mobile-menu-dropdown')).toBeInTheDocument();

    fireEvent.keyDown(document, { key: 'Escape' });

    expect(
      screen.queryByTestId('mobile-menu-dropdown')
    ).not.toBeInTheDocument();
  });

  it('closes dropdown when a link is clicked', async () => {
    const user = userEvent.setup();
    renderMobileMenu();

    await user.click(screen.getByTestId('mobile-menu-button'));
    expect(screen.getByTestId('mobile-menu-dropdown')).toBeInTheDocument();

    await user.click(screen.getByTestId('contacts-link'));

    expect(
      screen.queryByTestId('mobile-menu-dropdown')
    ).not.toBeInTheDocument();
  });

  it('applies active styling to current route', async () => {
    const user = userEvent.setup();
    renderMobileMenu('/contacts');

    await user.click(screen.getByTestId('mobile-menu-button'));

    const contactsLink = screen.getByTestId('contacts-link');
    expect(contactsLink).toHaveClass('bg-accent/50');
    expect(contactsLink).toHaveClass('font-medium');

    // Other links should not have active styling
    const tablesLink = screen.getByTestId('tables-link');
    expect(tablesLink).not.toHaveClass('bg-accent/50');
  });

  it('toggles dropdown on repeated clicks', async () => {
    const user = userEvent.setup();
    renderMobileMenu();

    const button = screen.getByTestId('mobile-menu-button');

    // Open
    await user.click(button);
    expect(screen.getByTestId('mobile-menu-dropdown')).toBeInTheDocument();

    // Close
    await user.click(button);
    expect(
      screen.queryByTestId('mobile-menu-dropdown')
    ).not.toBeInTheDocument();

    // Open again
    await user.click(button);
    expect(screen.getByTestId('mobile-menu-dropdown')).toBeInTheDocument();
  });

  it('dropdown has correct role attribute', async () => {
    const user = userEvent.setup();
    renderMobileMenu();

    await user.click(screen.getByTestId('mobile-menu-button'));

    const dropdown = screen.getByTestId('mobile-menu-dropdown');
    expect(dropdown).toHaveAttribute('role', 'menu');
  });

  it('links have menuitem role', async () => {
    const user = userEvent.setup();
    renderMobileMenu();

    await user.click(screen.getByTestId('mobile-menu-button'));

    const menuItems = screen.getAllByRole('menuitem');
    expect(menuItems).toHaveLength(17);
  });

  it('closes dropdown on window resize', async () => {
    const user = userEvent.setup();
    renderMobileMenu();

    await user.click(screen.getByTestId('mobile-menu-button'));
    expect(screen.getByTestId('mobile-menu-dropdown')).toBeInTheDocument();

    fireEvent(window, new Event('resize'));

    expect(
      screen.queryByTestId('mobile-menu-dropdown')
    ).not.toBeInTheDocument();
  });
});
