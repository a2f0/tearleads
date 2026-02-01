import { render, screen } from '@testing-library/react';
import type { ReactNode } from 'react';
import { describe, expect, it, vi } from 'vitest';
import { AudioProvider } from '../../context/AudioContext';
import { createWrapper } from '../../test/testUtils';
import { AudioWindow } from './AudioWindow';

vi.mock('@rapid/window-manager', () => ({
  FloatingWindow: ({ children }: { children: ReactNode }) => (
    <div data-testid="floating-window">{children}</div>
  )
}));

vi.mock('@tanstack/react-virtual', () => ({
  useVirtualizer: () => ({
    getVirtualItems: () => [],
    getTotalSize: () => 0,
    measureElement: vi.fn()
  })
}));

vi.mock('./AudioPlaylistsSidebar', () => ({
  ALL_AUDIO_ID: '__all__',
  AudioPlaylistsSidebar: () => (
    <div data-testid="audio-playlists-sidebar">Playlists Sidebar</div>
  )
}));

describe('AudioWindow', () => {
  function renderWithProviders(
    options: Parameters<typeof createWrapper>[0] = {}
  ) {
    const Wrapper = createWrapper(options);
    return render(
      <Wrapper>
        <AudioProvider>
          <AudioWindow
            id="test-audio-window"
            onClose={vi.fn()}
            onMinimize={vi.fn()}
            onFocus={vi.fn()}
            zIndex={100}
          />
        </AudioProvider>
      </Wrapper>
    );
  }

  it('renders the floating window', () => {
    renderWithProviders();
    expect(screen.getByTestId('floating-window')).toBeInTheDocument();
  });

  it('shows unlock prompt when database is locked', () => {
    renderWithProviders({
      databaseState: { isUnlocked: false, isLoading: false }
    });
    expect(screen.getByTestId('inline-unlock')).toBeInTheDocument();
  });

  it('shows loading state when database is loading', () => {
    renderWithProviders({
      databaseState: {
        isUnlocked: false,
        isLoading: true,
        currentInstanceId: null
      }
    });
    expect(screen.getByText('Loading database...')).toBeInTheDocument();
  });

  it('renders the File dropdown menu', () => {
    renderWithProviders();
    expect(screen.getByTestId('dropdown-file')).toBeInTheDocument();
  });

  it('renders the View dropdown menu', () => {
    renderWithProviders();
    expect(screen.getByTestId('dropdown-view')).toBeInTheDocument();
  });

  it('renders without error when database is unlocked', () => {
    renderWithProviders({
      databaseState: { isUnlocked: true }
    });

    // Should render the floating window when database is unlocked
    expect(screen.getByTestId('floating-window')).toBeInTheDocument();
  });

  it('shows sidebar when database is unlocked', () => {
    renderWithProviders({
      databaseState: { isUnlocked: true }
    });
    expect(screen.getByTestId('audio-playlists-sidebar')).toBeInTheDocument();
  });

  it('hides sidebar when database is locked', () => {
    renderWithProviders({
      databaseState: { isUnlocked: false, isLoading: false }
    });
    expect(
      screen.queryByTestId('audio-playlists-sidebar')
    ).not.toBeInTheDocument();
  });
});
