import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { createRef } from 'react';
import { describe, expect, it, vi } from 'vitest';
import { Input, inputVariants } from './input';

describe('Input', () => {
  it('renders input, forwards props, and handles typing', async () => {
    const user = userEvent.setup();
    const onChange = vi.fn();
    render(
      <Input
        data-testid="input"
        placeholder="Enter text"
        onChange={onChange}
        aria-label="Field"
      />
    );

    await user.type(screen.getByTestId('input'), 'abc');

    expect(screen.getByPlaceholderText('Enter text')).toBeInTheDocument();
    expect(onChange).toHaveBeenCalled();
    expect(screen.getByTestId('input')).toHaveAttribute('data-slot', 'input');
  });

  it('supports disabled state, refs, and explicit input type', () => {
    const ref = createRef<HTMLInputElement>();
    render(<Input ref={ref} data-testid="input" disabled type="email" />);

    expect(screen.getByTestId('input')).toBeDisabled();
    expect(screen.getByTestId('input')).toHaveAttribute('type', 'email');
    expect(ref.current).toBeInstanceOf(HTMLInputElement);
  });

  it('applies size and custom class names', () => {
    render(<Input data-testid="input" size="lg" className="custom-class" />);

    expect(screen.getByTestId('input')).toHaveClass(
      'h-11',
      'px-4',
      'custom-class'
    );
  });

  it('exports inputVariants helper', () => {
    const classes = inputVariants({ size: 'sm' });
    expect(classes).toContain('h-8');
    expect(classes).toContain('px-2');
  });
});
