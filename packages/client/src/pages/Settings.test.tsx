import { ThemeProvider } from '@rapid/ui';
import { render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { beforeEach, describe, expect, it, vi } from 'vitest';
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
  beforeEach(() => {
    renderSettings();
  });

  it('renders the settings title', () => {
    expect(screen.getByText('Settings')).toBeInTheDocument();
  });

  it('renders the dark mode toggle', () => {
    expect(screen.getByTestId('dark-mode-switch')).toBeInTheDocument();
  });

  it('renders the version at the bottom', () => {
    expect(screen.getByTestId('app-version')).toHaveTextContent(
      `v${packageJson.version}`
    );
  });
});
