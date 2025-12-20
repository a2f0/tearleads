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

  it('renders the settings link', () => {
    renderApp();

    expect(screen.getByRole('link', { name: /settings/i })).toBeInTheDocument();
  });

  it('renders the logo', () => {
    renderApp();

    expect(screen.getByAltText('Tearleads')).toBeInTheDocument();
  });
});
