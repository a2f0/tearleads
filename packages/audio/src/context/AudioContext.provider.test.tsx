import { render, screen } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { AudioProvider } from './AudioContext';

// Mock HTMLAudioElement methods
const mockPlay = vi.fn().mockResolvedValue(undefined);
const mockPause = vi.fn();

beforeEach(() => {
  vi.clearAllMocks();
  vi.spyOn(window.HTMLMediaElement.prototype, 'play').mockImplementation(
    mockPlay
  );
  vi.spyOn(window.HTMLMediaElement.prototype, 'pause').mockImplementation(
    mockPause
  );
  vi.spyOn(URL, 'createObjectURL').mockImplementation(() => 'blob:test-url');
  vi.spyOn(URL, 'revokeObjectURL').mockImplementation(() => {});
});

describe('AudioProvider', () => {
  it('renders children', () => {
    render(
      <AudioProvider>
        <div data-testid="child">Test Child</div>
      </AudioProvider>
    );

    expect(screen.getByTestId('child')).toBeInTheDocument();
  });

  it('renders a hidden audio element', () => {
    render(
      <AudioProvider>
        <div>Test</div>
      </AudioProvider>
    );

    const audio = document.querySelector('audio');
    expect(audio).toBeInTheDocument();
    expect(audio).toHaveClass('hidden');
  });
});
