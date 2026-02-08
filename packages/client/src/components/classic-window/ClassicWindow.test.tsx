import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { ReactNode } from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { ClassicWindow } from './index';

vi.mock('@/components/floating-window', () => ({
  FloatingWindow: ({
    children,
    title,
    onClose
  }: {
    children: ReactNode;
    title: string;
    onClose: () => void;
  }) => (
    <div data-testid="floating-window">
      <div data-testid="window-title">{title}</div>
      <button type="button" data-testid="close-window" onClick={onClose}>
        Close
      </button>
      {children}
    </div>
  )
}));

vi.mock('@rapid/classic', () => ({
  ClassicApp: () => <div data-testid="classic-app">Classic App</div>
}));

vi.mock('@/lib/classicState', () => ({
  CLASSIC_INITIAL_STATE: {
    tags: [],
    notesById: {},
    noteOrderByTagId: {},
    activeTagId: null
  }
}));

describe('ClassicWindow', () => {
  const defaultProps = {
    id: 'classic-window-1',
    onClose: vi.fn(),
    onMinimize: vi.fn(),
    onFocus: vi.fn(),
    zIndex: 100
  };

  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('renders in FloatingWindow with title', () => {
    render(<ClassicWindow {...defaultProps} />);

    expect(screen.getByTestId('floating-window')).toBeInTheDocument();
    expect(screen.getByTestId('window-title')).toHaveTextContent('Classic');
  });

  it('renders ClassicApp content', () => {
    render(<ClassicWindow {...defaultProps} />);

    expect(screen.getByTestId('classic-app')).toBeInTheDocument();
  });

  it('calls onClose when window close is clicked', async () => {
    const user = userEvent.setup();
    const onClose = vi.fn();

    render(<ClassicWindow {...defaultProps} onClose={onClose} />);
    await user.click(screen.getByTestId('close-window'));

    expect(onClose).toHaveBeenCalled();
  });
});
