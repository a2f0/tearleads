import { ThemeProvider } from '@rapid/ui';
import { render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { describe, expect, it, vi } from 'vitest';
import packageJson from '../../package.json';
import { Settings } from './Settings';

vi.mock('@/hooks/useAppVersion', () => ({
  useAppVersion: vi.fn(() => packageJson.version)
}));

function renderSettings() {
  return render(
    <MemoryRouter>
      <ThemeProvider>
        <Settings />
      </ThemeProvider>
    </MemoryRouter>
  );
}

describe('Settings', () => {
  it('renders the settings title', () => {
    renderSettings();

    expect(screen.getByText('Settings')).toBeInTheDocument();
  });

  it('renders the dark mode toggle', () => {
    renderSettings();

    expect(screen.getByTestId('dark-mode-switch')).toBeInTheDocument();
  });

  it('renders the back link', () => {
    renderSettings();

    expect(screen.getByRole('link', { name: /go back/i })).toBeInTheDocument();
  });

  it('renders the version at the bottom', () => {
    renderSettings();

    expect(screen.getByTestId('app-version')).toHaveTextContent(
      `v${packageJson.version}`
    );
  });
});
