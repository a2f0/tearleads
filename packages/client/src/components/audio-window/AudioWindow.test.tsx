import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import { AudioWindow } from './AudioWindow';

vi.mock('@/components/floating-window', () => ({
  FloatingWindow: (props: {
    children: React.ReactNode;
    title: string;
    onClose: () => void;
    initialDimensions?: { x: number; y: number; width: number; height: number };
  }) => (
    <div
      data-testid="floating-window"
      data-initial-dimensions={
        props.initialDimensions
          ? JSON.stringify(props.initialDimensions)
          : undefined
      }
    >
      <div data-testid="window-title">{props.title}</div>
      <button type="button" onClick={props.onClose} data-testid="close-window">
        Close
      </button>
      {props.children}
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
    const initialDimensions = { x: 100, y: 200, width: 500, height: 450 };
    render(
      <AudioWindow {...defaultProps} initialDimensions={initialDimensions} />
    );
    const window = screen.getByTestId('floating-window');
    expect(window).toBeInTheDocument();
    expect(window).toHaveAttribute(
      'data-initial-dimensions',
      JSON.stringify(initialDimensions)
    );
  });
});
