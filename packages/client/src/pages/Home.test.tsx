import { render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { describe, expect, it } from 'vitest';
import { Home } from './Home';

describe('Home', () => {
  const renderHome = () => {
    return render(
      <MemoryRouter>
        <Home />
      </MemoryRouter>
    );
  };

  it('renders app icons for navigation items', () => {
    renderHome();

    // Should have links to the main app pages
    expect(screen.getByRole('link', { name: 'Files' })).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Contacts' })).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Photos' })).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Settings' })).toBeInTheDocument();
  });

  it('does not include Home link (self-reference)', () => {
    renderHome();

    // Should not have a link to Home since we're on Home
    const homeLinks = screen.queryAllByRole('link', { name: 'Home' });
    expect(homeLinks).toHaveLength(0);
  });

  it('renders links with correct href attributes', () => {
    renderHome();

    expect(screen.getByRole('link', { name: 'Files' })).toHaveAttribute(
      'href',
      '/files'
    );
    expect(screen.getByRole('link', { name: 'Contacts' })).toHaveAttribute(
      'href',
      '/contacts'
    );
    expect(screen.getByRole('link', { name: 'Photos' })).toHaveAttribute(
      'href',
      '/photos'
    );
    expect(screen.getByRole('link', { name: 'Settings' })).toHaveAttribute(
      'href',
      '/settings'
    );
  });

  it('renders icons for each app', () => {
    renderHome();

    // Each link should contain an SVG icon
    const links = screen.getAllByRole('link');
    for (const link of links) {
      const svg = link.querySelector('svg');
      expect(svg).toBeInTheDocument();
    }
  });

  it('renders with responsive grid layout', () => {
    const { container } = renderHome();

    // Should have a grid container with responsive classes
    const grid = container.querySelector('.grid');
    expect(grid).toBeInTheDocument();
    expect(grid).toHaveClass('grid-cols-4');
  });
});
