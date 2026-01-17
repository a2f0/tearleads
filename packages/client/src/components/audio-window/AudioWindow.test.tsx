import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import { AudioWindow } from './AudioWindow';

vi.mock('@/components/floating-window', () => ({
  FloatingWindow: ({
    children,
    title,
    onClose
  }: {
    children: React.ReactNode;
    title: string;
    onClose: () => void;
  }) => (
    <div data-testid="floating-window">
      <div data-testid="window-title">{title}</div>
      <button type="button" onClick={onClose} data-testid="close-window">
        Close
      </button>
      {children}
    </div>
  )
}));

vi.mock('./AudioWindowList', () => ({
  AudioWindowList: () => <div data-testid="audio-list">Audio List</div>
}));

vi.mock('./AudioWindowMenuBar', () => ({
  AudioWindowMenuBar: ({ onClose }: { onClose: () => void }) => (
    <div data-testid="menu-bar">
      <button type="button" onClick={onClose} data-testid="menu-close">
        Close
      </button>
    </div>
  )
}));

describe('AudioWindow', () => {
  const defaultProps = {
    id: 'test-window',
    onClose: vi.fn(),
    onMinimize: vi.fn(),
    onFocus: vi.fn(),
    zIndex: 100
  };

  it('renders in FloatingWindow', () => {
    render(<AudioWindow {...defaultProps} />);
    expect(screen.getByTestId('floating-window')).toBeInTheDocument();
  });

  it('shows Audio as title', () => {
    render(<AudioWindow {...defaultProps} />);
    expect(screen.getByTestId('window-title')).toHaveTextContent('Audio');
  });

  it('renders menu bar', () => {
    render(<AudioWindow {...defaultProps} />);
    expect(screen.getByTestId('menu-bar')).toBeInTheDocument();
  });

  it('renders audio list', () => {
    render(<AudioWindow {...defaultProps} />);
    expect(screen.getByTestId('audio-list')).toBeInTheDocument();
  });

  it('calls onClose when close button is clicked', async () => {
    const user = userEvent.setup();
    const onClose = vi.fn();
    render(<AudioWindow {...defaultProps} onClose={onClose} />);

    await user.click(screen.getByTestId('close-window'));
    expect(onClose).toHaveBeenCalled();
  });

  it('passes initialDimensions to FloatingWindow when provided', () => {
    render(
      <AudioWindow
        {...defaultProps}
        initialDimensions={{ x: 100, y: 200, width: 500, height: 450 }}
      />
    );
    expect(screen.getByTestId('floating-window')).toBeInTheDocument();
  });
});
