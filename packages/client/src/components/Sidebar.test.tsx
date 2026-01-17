import { render, screen } from '@testing-library/react';
import { I18nextProvider } from 'react-i18next';
import { MemoryRouter } from 'react-router-dom';
import { describe, expect, it, vi } from 'vitest';
import { WindowManagerProvider } from '@/contexts/WindowManagerContext';
import { i18n } from '@/i18n';
import { en } from '@/i18n/translations/en';
import { navItems, Sidebar } from './Sidebar';

describe('Sidebar', () => {
  const mockOnClose = vi.fn();

  const renderSidebar = (initialRoute = '/', isOpen = true) => {
    return render(
      <I18nextProvider i18n={i18n}>
        <MemoryRouter initialEntries={[initialRoute]}>
          <WindowManagerProvider>
            <Sidebar isOpen={isOpen} onClose={mockOnClose} />
          </WindowManagerProvider>
        </MemoryRouter>
      </I18nextProvider>
    );
  };

  it('renders all navigation items', () => {
    renderSidebar();

    for (const item of navItems) {
      const label = en.menu[item.labelKey];
      expect(screen.getByText(label)).toBeInTheDocument();
    }
  });

  it('renders navigation buttons with correct test ids', () => {
    renderSidebar();

    for (const item of navItems) {
      const label = en.menu[item.labelKey];
      const button = screen.getByRole('button', { name: label });
      expect(button).toHaveAttribute('data-testid', item.testId);
    }
  });

  it('renders icons for each navigation item', () => {
    renderSidebar();

    // Each nav item should have an svg icon
    const buttons = screen.getAllByRole('button');
    for (const button of buttons) {
      const svg = button.querySelector('svg');
      expect(svg).toBeInTheDocument();
    }
  });

  it('applies active styles to the current route', () => {
    renderSidebar('/contacts');

    const contactsButton = screen.getByRole('button', { name: 'Contacts' });
    expect(contactsButton).toHaveClass('bg-accent');
  });

  it('applies inactive styles to non-current routes', () => {
    renderSidebar('/contacts');

    const homeButton = screen.getByRole('button', { name: 'Home' });
    expect(homeButton).toHaveClass('text-muted-foreground');
    expect(homeButton).not.toHaveClass('bg-accent');
  });

  it('uses end matching for the root route', () => {
    renderSidebar('/contacts');

    // When on /contacts, the Home button (/) should not be active
    const homeButton = screen.getByRole('button', { name: 'Home' });
    expect(homeButton).not.toHaveClass('bg-accent');
  });

  it('renders as an aside element', () => {
    const { container } = renderSidebar();

    const aside = container.querySelector('aside');
    expect(aside).toBeInTheDocument();
  });

  it('hides the sidebar when closed', () => {
    const { container } = renderSidebar('/', false);
    const aside = container.querySelector('aside');
    expect(aside).toHaveClass('lg:hidden');
  });

  it('contains a nav element', () => {
    renderSidebar();

    expect(screen.getByRole('navigation')).toBeInTheDocument();
  });

  it('renders an unordered list of navigation items', () => {
    renderSidebar();

    expect(screen.getByRole('list')).toBeInTheDocument();
    const listItems = screen.getAllByRole('listitem');
    expect(listItems).toHaveLength(navItems.length);
  });
});

describe('navItems', () => {
  it('exports navItems array', () => {
    expect(Array.isArray(navItems)).toBe(true);
    expect(navItems.length).toBeGreaterThan(0);
  });

  it('each nav item has required properties', () => {
    for (const item of navItems) {
      expect(item).toHaveProperty('path');
      expect(item).toHaveProperty('icon');
      expect(item).toHaveProperty('labelKey');
      expect(typeof item.path).toBe('string');
      expect(typeof item.labelKey).toBe('string');
      // Lucide icons are React components (objects with render function)
      expect(item.icon).toBeDefined();
    }
  });

  it('includes expected navigation destinations', () => {
    const paths = navItems.map((item) => item.path);

    expect(paths).toContain('/');
    expect(paths).toContain('/contacts');
    expect(paths).toContain('/photos');
    expect(paths).toContain('/settings');
  });

  it('has unique paths', () => {
    const paths = navItems.map((item) => item.path);
    const uniquePaths = new Set(paths);

    expect(uniquePaths.size).toBe(paths.length);
  });

  it('has unique labelKeys', () => {
    const labelKeys = navItems.map((item) => item.labelKey);
    const uniqueLabelKeys = new Set(labelKeys);

    expect(uniqueLabelKeys.size).toBe(labelKeys.length);
  });
});
