import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { createRef } from 'react';
import { describe, expect, it, vi } from 'vitest';
import { Textarea } from './textarea';

describe('Textarea', () => {
  it('renders a textarea element', () => {
    render(<Textarea data-testid="textarea" />);

    expect(screen.getByTestId('textarea')).toBeInTheDocument();
    expect(screen.getByTestId('textarea').tagName).toBe('TEXTAREA');
  });

  it('renders with placeholder', () => {
    render(<Textarea placeholder="Enter text..." />);

    expect(screen.getByPlaceholderText('Enter text...')).toBeInTheDocument();
  });

  it('handles change events', async () => {
    const user = userEvent.setup();
    const onChange = vi.fn();

    render(<Textarea onChange={onChange} data-testid="textarea" />);

    await user.type(screen.getByTestId('textarea'), 'hello');

    expect(onChange).toHaveBeenCalled();
  });

  it('displays the value', () => {
    render(<Textarea value="test value" readOnly data-testid="textarea" />);

    expect(screen.getByTestId('textarea')).toHaveValue('test value');
  });

  it('can be disabled', () => {
    render(<Textarea disabled data-testid="textarea" />);

    expect(screen.getByTestId('textarea')).toBeDisabled();
  });

  it('forwards ref to textarea element', () => {
    const ref = createRef<HTMLTextAreaElement>();

    render(<Textarea ref={ref} data-testid="textarea" />);

    expect(ref.current).toBeInstanceOf(HTMLTextAreaElement);
  });

  it('accepts and applies className', () => {
    render(<Textarea className="custom-class" data-testid="textarea" />);

    expect(screen.getByTestId('textarea')).toHaveClass('custom-class');
  });

  it('has data-slot attribute', () => {
    render(<Textarea data-testid="textarea" />);

    expect(screen.getByTestId('textarea')).toHaveAttribute(
      'data-slot',
      'textarea'
    );
  });

  it('uses text-base for iOS compatibility (16px minimum)', () => {
    render(<Textarea data-testid="textarea" />);

    expect(screen.getByTestId('textarea')).toHaveClass('text-base');
  });

  describe('accessibility', () => {
    it('can have aria-label', () => {
      render(<Textarea aria-label="Description" data-testid="textarea" />);

      expect(screen.getByTestId('textarea')).toHaveAttribute(
        'aria-label',
        'Description'
      );
    });

    it('can have aria-describedby', () => {
      render(
        <>
          <Textarea aria-describedby="desc" data-testid="textarea" />
          <p id="desc">Enter a detailed description</p>
        </>
      );

      expect(screen.getByTestId('textarea')).toHaveAttribute(
        'aria-describedby',
        'desc'
      );
    });

    it('supports required attribute', () => {
      render(<Textarea required data-testid="textarea" />);

      expect(screen.getByTestId('textarea')).toBeRequired();
    });
  });
});
