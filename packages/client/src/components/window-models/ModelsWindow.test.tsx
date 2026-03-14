import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import { ModelsWindow } from './ModelsWindow';

vi.mock('@tearleads/window-manager', async (importOriginal) => {
  const actual =
    await importOriginal<typeof import('@tearleads/window-manager')>();

  return {
    ...actual,
    DesktopFloatingWindow: ({
      children,
      title,
      onClose,
      initialDimensions
    }: {
      children: React.ReactNode;
      title: string;
      onClose: () => void;
      initialDimensions?: {
        width: number;
        height: number;
        x: number;
        y: number;
      };
    }) => (
      <div
        data-testid="floating-window"
        data-initial-dimensions={
          initialDimensions ? JSON.stringify(initialDimensions) : undefined
        }
      >
        <div data-testid="window-title">{title}</div>
        <button type="button" onClick={onClose} data-testid="close-window">
          Close
        </button>
        {children}
      </div>
    )
  };
});

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

  it('passes initialDimensions to FloatingWindow when provided', () => {
    const initialDimensions = {
      width: 720,
      height: 600,
      x: 100,
      y: 200
    };

    render(
      <ModelsWindow {...defaultProps} initialDimensions={initialDimensions} />
    );

    expect(screen.getByTestId('floating-window')).toHaveAttribute(
      'data-initial-dimensions',
      JSON.stringify(initialDimensions)
    );
  });
});
