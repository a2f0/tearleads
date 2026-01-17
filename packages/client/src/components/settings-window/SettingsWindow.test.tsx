import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import { SettingsWindow } from './SettingsWindow';

// Mock FloatingWindow
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

// Mock Settings component
vi.mock('@/pages/Settings', () => ({
  Settings: () => <div data-testid="settings-content">Settings Content</div>
}));

describe('SettingsWindow', () => {
  const defaultProps = {
    id: 'test-window',
    onClose: vi.fn(),
    onMinimize: vi.fn(),
    onFocus: vi.fn(),
    zIndex: 100
  };

  it('renders in FloatingWindow', () => {
    render(<SettingsWindow {...defaultProps} />);
    expect(screen.getByTestId('floating-window')).toBeInTheDocument();
  });

  it('shows Settings as title', () => {
    render(<SettingsWindow {...defaultProps} />);
    expect(screen.getByTestId('window-title')).toHaveTextContent('Settings');
  });

  it('renders the settings content', () => {
    render(<SettingsWindow {...defaultProps} />);
    expect(screen.getByTestId('settings-content')).toBeInTheDocument();
  });

  it('calls onClose when close button is clicked', async () => {
    const user = userEvent.setup();
    const onClose = vi.fn();
    render(<SettingsWindow {...defaultProps} onClose={onClose} />);

    await user.click(screen.getByTestId('close-window'));
    expect(onClose).toHaveBeenCalled();
  });

  it('renders with initialDimensions when provided', () => {
    const initialDimensions = {
      width: 600,
      height: 700,
      x: 100,
      y: 100
    };
    render(
      <SettingsWindow {...defaultProps} initialDimensions={initialDimensions} />
    );
    expect(screen.getByTestId('floating-window')).toBeInTheDocument();
  });
});
