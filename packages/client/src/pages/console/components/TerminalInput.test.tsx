import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import { TerminalInput } from './TerminalInput';

describe('TerminalInput', () => {
  const defaultProps = {
    value: '',
    prompt: 'tearleads> ',
    mode: 'command' as const,
    onChange: vi.fn(),
    onSubmit: vi.fn()
  };

  it('renders the prompt', () => {
    render(<TerminalInput {...defaultProps} />);
    expect(screen.getByTestId('terminal-prompt')).toHaveTextContent(
      'tearleads>'
    );
  });

  it('renders the input with value', () => {
    render(<TerminalInput {...defaultProps} value="status" />);
    expect(screen.getByTestId('terminal-input')).toHaveValue('status');
  });

  it('calls onChange when typing', async () => {
    const onChange = vi.fn();
    const user = userEvent.setup();
    render(<TerminalInput {...defaultProps} onChange={onChange} />);

    await user.type(screen.getByTestId('terminal-input'), 's');

    expect(onChange).toHaveBeenCalledWith('s');
  });

  it('calls onSubmit when Enter is pressed', async () => {
    const onSubmit = vi.fn();
    const user = userEvent.setup();
    render(
      <TerminalInput {...defaultProps} value="status" onSubmit={onSubmit} />
    );

    await user.type(screen.getByTestId('terminal-input'), '{Enter}');

    expect(onSubmit).toHaveBeenCalledTimes(1);
  });

  it('does not call onSubmit when disabled', async () => {
    const onSubmit = vi.fn();
    const user = userEvent.setup();
    render(
      <TerminalInput
        {...defaultProps}
        value="status"
        onSubmit={onSubmit}
        disabled
      />
    );

    await user.type(screen.getByTestId('terminal-input'), '{Enter}');

    expect(onSubmit).not.toHaveBeenCalled();
  });

  it('uses password type in password mode', () => {
    render(<TerminalInput {...defaultProps} mode="password" />);
    expect(screen.getByTestId('terminal-input')).toHaveAttribute(
      'type',
      'password'
    );
  });

  it('uses text type in command mode', () => {
    render(<TerminalInput {...defaultProps} mode="command" />);
    expect(screen.getByTestId('terminal-input')).toHaveAttribute(
      'type',
      'text'
    );
  });

  it('uses text type in confirm mode', () => {
    render(<TerminalInput {...defaultProps} mode="confirm" />);
    expect(screen.getByTestId('terminal-input')).toHaveAttribute(
      'type',
      'text'
    );
  });

  it('calls onKeyDown handler', async () => {
    const onKeyDown = vi.fn();
    const user = userEvent.setup();
    render(<TerminalInput {...defaultProps} onKeyDown={onKeyDown} />);

    await user.type(screen.getByTestId('terminal-input'), '{ArrowUp}');

    expect(onKeyDown).toHaveBeenCalledWith(
      expect.objectContaining({ key: 'ArrowUp' })
    );
  });

  it('has proper aria-label in command mode', () => {
    render(<TerminalInput {...defaultProps} mode="command" />);
    expect(screen.getByTestId('terminal-input')).toHaveAttribute(
      'aria-label',
      'Command input'
    );
  });

  it('has proper aria-label in password mode', () => {
    render(<TerminalInput {...defaultProps} mode="password" />);
    expect(screen.getByTestId('terminal-input')).toHaveAttribute(
      'aria-label',
      'Password input'
    );
  });

  it('applies custom className', () => {
    const { container } = render(
      <TerminalInput {...defaultProps} className="custom-class" />
    );
    expect(container.firstChild).toHaveClass('custom-class');
  });

  it('disables input when disabled prop is true', () => {
    render(<TerminalInput {...defaultProps} disabled />);
    expect(screen.getByTestId('terminal-input')).toBeDisabled();
  });

  it('has correct autocomplete for password mode', () => {
    render(<TerminalInput {...defaultProps} mode="password" />);
    expect(screen.getByTestId('terminal-input')).toHaveAttribute(
      'autocomplete',
      'current-password'
    );
  });

  it('has autocomplete off for command mode', () => {
    render(<TerminalInput {...defaultProps} mode="command" />);
    expect(screen.getByTestId('terminal-input')).toHaveAttribute(
      'autocomplete',
      'off'
    );
  });
});
