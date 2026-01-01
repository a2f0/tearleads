import { render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { describe, expect, it } from 'vitest';
import { navItems, Sidebar } from './Sidebar';

describe('Sidebar', () => {
  const renderSidebar = (initialRoute = '/') => {
    return render(
      <MemoryRouter initialEntries={[initialRoute]}>
        <Sidebar />
      </MemoryRouter>
    );
  };

  it('renders all navigation items', () => {
    renderSidebar();

    for (const item of navItems) {
      expect(screen.getByText(item.label)).toBeInTheDocument();
    }
  });

  it('renders navigation links with correct paths', () => {
    renderSidebar();

    for (const item of navItems) {
      const link = screen.getByRole('link', { name: item.label });
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

    const filesLink = screen.getByRole('link', { name: 'Files' });
    expect(filesLink).toHaveClass('text-muted-foreground');
    expect(filesLink).not.toHaveClass('bg-accent');
  });

  it('uses end matching for the root route', () => {
    renderSidebar('/contacts');

    // When on /contacts, the Files link (/) should not be active
    const filesLink = screen.getByRole('link', { name: 'Files' });
    expect(filesLink).not.toHaveClass('bg-accent');
  });

  it('renders as an aside element', () => {
    const { container } = renderSidebar();

    const aside = container.querySelector('aside');
    expect(aside).toBeInTheDocument();
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
      expect(item).toHaveProperty('label');
      expect(typeof item.path).toBe('string');
      expect(typeof item.label).toBe('string');
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

  it('has unique labels', () => {
    const labels = navItems.map((item) => item.label);
    const uniqueLabels = new Set(labels);

    expect(uniqueLabels.size).toBe(labels.length);
  });
});
