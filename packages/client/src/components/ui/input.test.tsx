import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { createRef } from 'react';
import { describe, expect, it, vi } from 'vitest';
import { Input, inputVariants } from './input';

describe('Input', () => {
  it('renders an input element', () => {
    render(<Input data-testid="input" />);

    expect(screen.getByTestId('input')).toBeInTheDocument();
    expect(screen.getByTestId('input').tagName).toBe('INPUT');
  });

  it('renders with placeholder', () => {
    render(<Input placeholder="Enter text..." />);

    expect(screen.getByPlaceholderText('Enter text...')).toBeInTheDocument();
  });

  it('handles change events', async () => {
    const user = userEvent.setup();
    const onChange = vi.fn();

    render(<Input onChange={onChange} data-testid="input" />);

    await user.type(screen.getByTestId('input'), 'hello');

    expect(onChange).toHaveBeenCalled();
  });

  it('displays the value', () => {
    render(<Input value="test value" readOnly data-testid="input" />);

    expect(screen.getByTestId('input')).toHaveValue('test value');
  });

  it('can be disabled', () => {
    render(<Input disabled data-testid="input" />);

    expect(screen.getByTestId('input')).toBeDisabled();
  });

  it('forwards ref to input element', () => {
    const ref = createRef<HTMLInputElement>();

    render(<Input ref={ref} data-testid="input" />);

    expect(ref.current).toBeInstanceOf(HTMLInputElement);
  });

  it('accepts and applies className', () => {
    render(<Input className="custom-class" data-testid="input" />);

    expect(screen.getByTestId('input')).toHaveClass('custom-class');
  });

  it('has data-slot attribute', () => {
    render(<Input data-testid="input" />);

    expect(screen.getByTestId('input')).toHaveAttribute('data-slot', 'input');
  });

  it('uses text-base for iOS compatibility (16px minimum)', () => {
    render(<Input data-testid="input" />);

    expect(screen.getByTestId('input')).toHaveClass('text-base');
  });

  describe('types', () => {
    it('renders text type by default', () => {
      render(<Input data-testid="input" />);

      expect(screen.getByTestId('input')).not.toHaveAttribute('type');
    });

    it('renders email type', () => {
      render(<Input type="email" data-testid="input" />);

      expect(screen.getByTestId('input')).toHaveAttribute('type', 'email');
    });

    it('renders password type', () => {
      render(<Input type="password" data-testid="input" />);

      expect(screen.getByTestId('input')).toHaveAttribute('type', 'password');
    });

    it('renders tel type', () => {
      render(<Input type="tel" data-testid="input" />);

      expect(screen.getByTestId('input')).toHaveAttribute('type', 'tel');
    });
  });

  describe('sizes', () => {
    it('applies default size by default', () => {
      render(<Input data-testid="input" />);

      const input = screen.getByTestId('input');
      expect(input).toHaveClass('h-9');
    });

    it('applies sm size', () => {
      render(<Input size="sm" data-testid="input" />);

      const input = screen.getByTestId('input');
      expect(input).toHaveClass('h-8');
      expect(input).toHaveClass('px-2');
    });

    it('applies lg size', () => {
      render(<Input size="lg" data-testid="input" />);

      const input = screen.getByTestId('input');
      expect(input).toHaveClass('h-11');
      expect(input).toHaveClass('px-4');
    });
  });

  describe('inputVariants', () => {
    it('exports inputVariants function', () => {
      expect(typeof inputVariants).toBe('function');
    });

    it('generates default class strings', () => {
      const defaultClasses = inputVariants();
      expect(defaultClasses).toContain('flex');
      expect(defaultClasses).toContain('text-base');
      expect(defaultClasses).toContain('rounded-md');
    });

    it('generates size-specific classes', () => {
      const lgClasses = inputVariants({ size: 'lg' });
      expect(lgClasses).toContain('h-11');
      expect(lgClasses).toContain('px-4');
    });

    it('allows custom className', () => {
      const classes = inputVariants({ className: 'my-custom-class' });
      expect(classes).toContain('my-custom-class');
    });
  });

  describe('accessibility', () => {
    it('can have aria-label', () => {
      render(<Input aria-label="Search" data-testid="input" />);

      expect(screen.getByTestId('input')).toHaveAttribute(
        'aria-label',
        'Search'
      );
    });

    it('can have aria-describedby', () => {
      render(
        <>
          <Input aria-describedby="desc" data-testid="input" />
          <p id="desc">Enter your email address</p>
        </>
      );

      expect(screen.getByTestId('input')).toHaveAttribute(
        'aria-describedby',
        'desc'
      );
    });

    it('supports required attribute', () => {
      render(<Input required data-testid="input" />);

      expect(screen.getByTestId('input')).toBeRequired();
    });
  });
});
