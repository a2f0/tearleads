import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import { ModelsWindow } from './ModelsWindow';

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

vi.mock('@/pages/models/ModelsContent', () => ({
  ModelsContent: ({
    showBackLink,
    viewMode
  }: {
    showBackLink?: boolean;
    viewMode?: string;
  }) => (
    <div
      data-testid="models-content"
      data-show-back-link={showBackLink ? 'true' : 'false'}
      data-view-mode={viewMode}
    >
      Models Content
    </div>
  )
}));

describe('ModelsWindow', () => {
  const defaultProps = {
    id: 'models-window',
    onClose: vi.fn(),
    onMinimize: vi.fn(),
    onFocus: vi.fn(),
    zIndex: 100
  };

  it('renders in FloatingWindow', () => {
    render(<ModelsWindow {...defaultProps} />);
    expect(screen.getByTestId('floating-window')).toBeInTheDocument();
  });

  it('shows the window title', () => {
    render(<ModelsWindow {...defaultProps} />);
    expect(screen.getByTestId('window-title')).toHaveTextContent('Models');
  });

  it('renders models content without a back link', () => {
    render(<ModelsWindow {...defaultProps} />);
    expect(screen.getByTestId('models-content')).toHaveAttribute(
      'data-show-back-link',
      'false'
    );
  });

  it('calls onClose when close button is clicked', async () => {
    const user = userEvent.setup();
    const onClose = vi.fn();
    render(<ModelsWindow {...defaultProps} onClose={onClose} />);

    await user.click(screen.getByTestId('close-window'));
    expect(onClose).toHaveBeenCalled();
  });
});
