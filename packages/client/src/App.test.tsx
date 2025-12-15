import { render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { ThemeProvider } from '@rapid/ui';
import App from './App';
import packageJson from '../package.json';

vi.mock('@/hooks/useAppVersion', () => ({
  useAppVersion: vi.fn(() => packageJson.version)
}));

vi.mock('@/lib/api', () => ({
  api: {
    health: {
      get: vi.fn()
    }
  }
}));

function renderApp() {
  return render(
    <ThemeProvider>
      <App />
    </ThemeProvider>
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

  it('renders the footer with version', () => {
    renderApp();

    const versionElements = screen.getAllByText(packageJson.version);
    expect(versionElements.length).toBeGreaterThan(0);
  });

  it('renders the footer with copyright', () => {
    renderApp();

    const currentYear = new Date().getFullYear();
    expect(
      screen.getByText(`© ${currentYear} Tearleads. All rights reserved.`)
    ).toBeInTheDocument();
  });

  it('renders the theme switcher', () => {
    renderApp();

    expect(
      screen.getByRole('button', { name: /toggle theme/i })
    ).toBeInTheDocument();
  });

  it('renders the logo', () => {
    renderApp();

    expect(screen.getByAltText('Tearleads')).toBeInTheDocument();
  });
});
