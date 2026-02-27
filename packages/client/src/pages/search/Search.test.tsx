import { ThemeProvider } from '@tearleads/ui';
import { render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { describe, expect, it, vi } from 'vitest';
import { Search } from './Search';

vi.mock('@/search', () => ({
  useSearch: () => ({
    search: vi.fn().mockResolvedValue({ hits: [], count: 0 }),
    isInitialized: true,
    isIndexing: false,
    documentCount: 10
  })
}));

vi.mock('@/db/hooks/useDatabaseContext', () => ({
  useDatabaseContext: () => ({ isUnlocked: true, isLoading: false })
}));

vi.mock('@/contexts/WindowManagerContext', () => ({
  useWindowManagerActions: () => ({
    openWindow: vi.fn(),
    requestWindowOpen: vi.fn()
  })
}));

function renderSearch() {
  return render(
    <MemoryRouter>
      <ThemeProvider>
        <Search />
      </ThemeProvider>
    </MemoryRouter>
  );
}

describe('Search', () => {
  it('renders the search title', () => {
    renderSearch();
    expect(screen.getByRole('heading', { name: 'Search' })).toBeInTheDocument();
  });

  it('renders the back link', () => {
    renderSearch();
    expect(screen.getByTestId('back-link')).toBeInTheDocument();
  });

  it('renders the search input', () => {
    renderSearch();
    expect(screen.getByPlaceholderText('Search...')).toBeInTheDocument();
  });

  it('renders filter tabs', () => {
    renderSearch();
    expect(screen.getByText('All')).toBeInTheDocument();
    expect(screen.getByText('Contacts')).toBeInTheDocument();
    expect(screen.getByText('Notes')).toBeInTheDocument();
    expect(screen.getByText('Emails')).toBeInTheDocument();
    expect(screen.getByText('Files')).toBeInTheDocument();
  });
});
