import { render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { describe, expect, it } from 'vitest';
import { MediaPageWithSidebar } from './MediaPageWithSidebar';

describe('MediaPageWithSidebar', () => {
  it('renders sidebar and content when sidebar is enabled', () => {
    render(
      <MemoryRouter>
        <MediaPageWithSidebar
          showSidebar={true}
          sidebar={<div data-testid="sidebar">Sidebar</div>}
          content={<div data-testid="content">Content</div>}
        />
      </MemoryRouter>
    );

    expect(screen.getByTestId('sidebar')).toBeInTheDocument();
    expect(screen.getByTestId('content')).toBeInTheDocument();
    expect(screen.getByText('Back to Home')).toBeInTheDocument();
  });

  it('hides sidebar container when sidebar is disabled', () => {
    render(
      <MemoryRouter>
        <MediaPageWithSidebar
          showSidebar={false}
          sidebar={<div data-testid="sidebar">Sidebar</div>}
          content={<div data-testid="content">Content</div>}
        />
      </MemoryRouter>
    );

    expect(screen.queryByTestId('sidebar')).not.toBeInTheDocument();
    expect(screen.getByTestId('content')).toBeInTheDocument();
  });
});
