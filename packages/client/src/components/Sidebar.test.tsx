import { render, screen } from '@testing-library/react';
import { I18nextProvider } from 'react-i18next';
import { MemoryRouter } from 'react-router-dom';
import { describe, expect, it } from 'vitest';
import { i18n } from '@/i18n';
import { en } from '@/i18n/translations/en';
import { navItems, Sidebar } from './Sidebar';

describe('Sidebar', () => {
  const renderSidebar = (initialRoute = '/', isOpen = true) => {
    return render(
      <I18nextProvider i18n={i18n}>
        <MemoryRouter initialEntries={[initialRoute]}>
          <Sidebar isOpen={isOpen} />
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

  it('renders navigation links with correct paths', () => {
    renderSidebar();

    for (const item of navItems) {
      const label = en.menu[item.labelKey];
      const link = screen.getByRole('link', { name: label });
      expect(link).toHaveAttribute('href', item.path);
    }
  });

  it('renders icons for each navigation item', () => {
    renderSidebar();

    // Each nav item should have an svg icon
    const links = screen.getAllByRole('link');
    for (const link of links) {
      const svg = link.querySelector('svg');
      expect(svg).toBeInTheDocument();
    }
  });

  it('applies active styles to the current route', () => {
    renderSidebar('/contacts');

    const contactsLink = screen.getByRole('link', { name: 'Contacts' });
    expect(contactsLink).toHaveClass('bg-accent');
  });

  it('applies inactive styles to non-current routes', () => {
    renderSidebar('/contacts');

    const homeLink = screen.getByRole('link', { name: 'Home' });
    expect(homeLink).toHaveClass('text-muted-foreground');
    expect(homeLink).not.toHaveClass('bg-accent');
  });

  it('uses end matching for the root route', () => {
    renderSidebar('/contacts');

    // When on /contacts, the Home link (/) should not be active
    const homeLink = screen.getByRole('link', { name: 'Home' });
    expect(homeLink).not.toHaveClass('bg-accent');
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
