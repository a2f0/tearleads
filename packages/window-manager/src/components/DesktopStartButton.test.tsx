import { fireEvent, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { createRef } from 'react';
import { describe, expect, it, vi } from 'vitest';
import { DesktopStartButton } from './DesktopStartButton';

describe('DesktopStartButton', () => {
  const defaultProps = {
    logoSrc: '/logo.svg',
    isOpen: false,
    onClick: vi.fn()
  };

  it('renders the button with logo', () => {
    render(<DesktopStartButton {...defaultProps} />);

    const button = screen.getByTestId('start-button');
    expect(button).toBeInTheDocument();

    const logo = button.querySelector('img');
    expect(logo).toHaveAttribute('src', '/logo.svg');
  });

  it('calls onClick when clicked', async () => {
    const onClick = vi.fn();
    const user = userEvent.setup();

    render(<DesktopStartButton {...defaultProps} onClick={onClick} />);

    await user.click(screen.getByTestId('start-button'));

    expect(onClick).toHaveBeenCalledTimes(1);
  });

  it('calls onContextMenu when right-clicked', () => {
    const onContextMenu = vi.fn();

    render(
      <DesktopStartButton {...defaultProps} onContextMenu={onContextMenu} />
    );

    fireEvent.contextMenu(screen.getByTestId('start-button'));

    expect(onContextMenu).toHaveBeenCalledTimes(1);
  });

  it('sets aria-pressed based on isOpen prop', () => {
    const { rerender } = render(
      <DesktopStartButton {...defaultProps} isOpen={false} />
    );

    expect(screen.getByTestId('start-button')).toHaveAttribute(
      'aria-pressed',
      'false'
    );

    rerender(<DesktopStartButton {...defaultProps} isOpen={true} />);

    expect(screen.getByTestId('start-button')).toHaveAttribute(
      'aria-pressed',
      'true'
    );
  });

  it('has correct aria-label', () => {
    render(<DesktopStartButton {...defaultProps} />);

    expect(screen.getByTestId('start-button')).toHaveAttribute(
      'aria-label',
      'Toggle sidebar'
    );
  });

  it('has correct aria-controls', () => {
    render(<DesktopStartButton {...defaultProps} />);

    expect(screen.getByTestId('start-button')).toHaveAttribute(
      'aria-controls',
      'sidebar'
    );
  });

  it('applies custom className', () => {
    render(<DesktopStartButton {...defaultProps} className="custom-class" />);

    expect(screen.getByTestId('start-button')).toHaveClass('custom-class');
  });

  it('sets logo alt text when provided', () => {
    render(<DesktopStartButton {...defaultProps} logoAlt="Company Logo" />);

    const logo = screen.getByTestId('start-button').querySelector('img');
    expect(logo).toHaveAttribute('alt', 'Company Logo');
  });

  it('forwards ref to button element', () => {
    const ref = createRef<HTMLButtonElement>();

    render(<DesktopStartButton {...defaultProps} ref={ref} />);

    expect(ref.current).toBe(screen.getByTestId('start-button'));
  });
});
