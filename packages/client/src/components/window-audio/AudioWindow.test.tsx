import { render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

vi.mock('@tearleads/audio', () => ({
  AudioWindow: ({
    id,
    openAudioId,
    openPlaylistId
  }: {
    id: string;
    openAudioId?: string;
    openPlaylistId?: string;
  }) => (
    <div data-testid="audio-window-base" data-id={id}>
      {openAudioId && <span>Audio: {openAudioId}</span>}
      {openPlaylistId && <span>Playlist: {openPlaylistId}</span>}
    </div>
  )
}));

vi.mock('@/contexts/ClientAudioProvider', () => ({
  ClientAudioProvider: ({ children }: { children: React.ReactNode }) => (
    <div data-testid="client-audio-provider">{children}</div>
  )
}));

vi.mock('@/contexts/WindowManagerContext', () => ({
  useWindowOpenRequest: () => ({
    audioId: 'audio-123',
    playlistId: 'playlist-456',
    requestId: '1'
  })
}));

import { AudioWindow } from './index';

describe('AudioWindow', () => {
  const defaultProps = {
    id: 'audio-window-1',
    onClose: vi.fn(),
    onMinimize: vi.fn(),
    onFocus: vi.fn(),
    zIndex: 100
  };

  it('renders AudioWindowBase wrapped with ClientAudioProvider', () => {
    render(<AudioWindow {...defaultProps} />);

    expect(screen.getByTestId('client-audio-provider')).toBeInTheDocument();
    expect(screen.getByTestId('audio-window-base')).toBeInTheDocument();
  });

  it('passes openRequest params to AudioWindowBase', () => {
    render(<AudioWindow {...defaultProps} />);

    expect(screen.getByText('Audio: audio-123')).toBeInTheDocument();
    expect(screen.getByText('Playlist: playlist-456')).toBeInTheDocument();
  });
});
