import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { createRef } from 'react';
import { describe, expect, it, vi } from 'vitest';
import { Button, buttonVariants } from './button';

describe('Button', () => {
  it('renders a button element', () => {
    render(<Button>Click me</Button>);

    expect(
      screen.getByRole('button', { name: 'Click me' })
    ).toBeInTheDocument();
  });

  it('renders children', () => {
    render(<Button>Button Text</Button>);

    expect(screen.getByText('Button Text')).toBeInTheDocument();
  });

  it('handles click events', async () => {
    const user = userEvent.setup();
    const onClick = vi.fn();

    render(<Button onClick={onClick}>Click me</Button>);

    await user.click(screen.getByRole('button'));

    expect(onClick).toHaveBeenCalledTimes(1);
  });

  it('can be disabled', () => {
    render(<Button disabled>Disabled</Button>);

    expect(screen.getByRole('button')).toBeDisabled();
  });

  it('does not fire click when disabled', async () => {
    const user = userEvent.setup();
    const onClick = vi.fn();

    render(
      <Button disabled onClick={onClick}>
        Disabled
      </Button>
    );

    await user.click(screen.getByRole('button'));

    expect(onClick).not.toHaveBeenCalled();
  });

  it('forwards ref to button element', () => {
    const ref = createRef<HTMLButtonElement>();

    render(<Button ref={ref}>With Ref</Button>);

    expect(ref.current).toBeInstanceOf(HTMLButtonElement);
    expect(ref.current?.textContent).toBe('With Ref');
  });

  it('accepts and applies className', () => {
    render(<Button className="custom-class">Custom</Button>);

    expect(screen.getByRole('button')).toHaveClass('custom-class');
  });

  it('has data-slot attribute', () => {
    render(<Button>Slot</Button>);

    expect(screen.getByRole('button')).toHaveAttribute('data-slot', 'button');
  });

  describe('variants', () => {
    it('applies default variant by default', () => {
      render(<Button>Default</Button>);

      const button = screen.getByRole('button');
      expect(button).toHaveClass('bg-primary');
    });

    it('applies destructive variant', () => {
      render(<Button variant="destructive">Destructive</Button>);

      const button = screen.getByRole('button');
      expect(button).toHaveClass('bg-destructive');
    });

    it('applies outline variant', () => {
      render(<Button variant="outline">Outline</Button>);

      const button = screen.getByRole('button');
      expect(button).toHaveClass('border');
      expect(button).toHaveClass('bg-background');
    });

    it('applies secondary variant', () => {
      render(<Button variant="secondary">Secondary</Button>);

      const button = screen.getByRole('button');
      expect(button).toHaveClass('bg-secondary');
    });

    it('applies ghost variant', () => {
      render(<Button variant="ghost">Ghost</Button>);

      const button = screen.getByRole('button');
      expect(button).toHaveClass('hover:bg-accent');
      expect(button).not.toHaveClass('bg-primary');
      expect(button).not.toHaveClass('border');
    });

    it('applies link variant', () => {
      render(<Button variant="link">Link</Button>);

      const button = screen.getByRole('button');
      expect(button).toHaveClass('underline-offset-4');
    });
  });

  describe('sizes', () => {
    it('applies default size by default', () => {
      render(<Button>Default Size</Button>);

      const button = screen.getByRole('button');
      expect(button).toHaveClass('h-9');
      expect(button).toHaveClass('px-4');
    });

    it('applies sm size', () => {
      render(<Button size="sm">Small</Button>);

      const button = screen.getByRole('button');
      expect(button).toHaveClass('h-8');
      expect(button).toHaveClass('px-3');
    });

    it('applies lg size', () => {
      render(<Button size="lg">Large</Button>);

      const button = screen.getByRole('button');
      expect(button).toHaveClass('h-10');
      expect(button).toHaveClass('px-8');
    });

    it('applies icon size', () => {
      render(<Button size="icon">Icon</Button>);

      const button = screen.getByRole('button');
      expect(button).toHaveClass('h-9');
      expect(button).toHaveClass('w-9');
    });
  });

  describe('asChild', () => {
    it('renders as a Slot when asChild is true', () => {
      render(
        <Button asChild>
          <a href="/test">Link Button</a>
        </Button>
      );

      const link = screen.getByRole('link', { name: 'Link Button' });
      expect(link).toBeInTheDocument();
      expect(link).toHaveAttribute('href', '/test');
    });

    it('applies button styles to child element when asChild', () => {
      render(
        <Button asChild variant="destructive">
          <a href="/test">Styled Link</a>
        </Button>
      );

      const link = screen.getByRole('link');
      expect(link).toHaveClass('bg-destructive');
    });
  });

  describe('buttonVariants', () => {
    it('exports buttonVariants function', () => {
      expect(typeof buttonVariants).toBe('function');
    });

    it('generates variant class strings', () => {
      const defaultClasses = buttonVariants();
      expect(defaultClasses).toContain('inline-flex');
      expect(defaultClasses).toContain('bg-primary');
    });

    it('generates variant-specific classes', () => {
      const destructiveClasses = buttonVariants({ variant: 'destructive' });
      expect(destructiveClasses).toContain('bg-destructive');
    });

    it('generates size-specific classes', () => {
      const lgClasses = buttonVariants({ size: 'lg' });
      expect(lgClasses).toContain('h-10');
      expect(lgClasses).toContain('px-8');
    });

    it('combines variant and size', () => {
      const classes = buttonVariants({ variant: 'outline', size: 'sm' });
      expect(classes).toContain('border');
      expect(classes).toContain('h-8');
    });

    it('allows custom className', () => {
      const classes = buttonVariants({ className: 'my-custom-class' });
      expect(classes).toContain('my-custom-class');
    });
  });

  describe('accessibility', () => {
    it('can have aria-label', () => {
      render(<Button aria-label="Close dialog">X</Button>);

      expect(
        screen.getByRole('button', { name: 'Close dialog' })
      ).toBeInTheDocument();
    });

    it('can have aria-describedby', () => {
      render(
        <>
          <Button aria-describedby="desc">Action</Button>
          <p id="desc">This action is permanent</p>
        </>
      );

      expect(screen.getByRole('button')).toHaveAttribute(
        'aria-describedby',
        'desc'
      );
    });

    it('supports type attribute', () => {
      render(<Button type="submit">Submit</Button>);

      expect(screen.getByRole('button')).toHaveAttribute('type', 'submit');
    });
  });

  describe('icon support', () => {
    it('renders with icon', () => {
      render(
        <Button>
          <svg data-testid="icon" />
          With Icon
        </Button>
      );

      expect(screen.getByTestId('icon')).toBeInTheDocument();
      expect(screen.getByText('With Icon')).toBeInTheDocument();
    });

    it('applies svg styling classes', () => {
      const { container } = render(
        <Button>
          <svg data-testid="icon" />
          Icon Button
        </Button>
      );

      const button = container.querySelector('button');
      // The button has [&_svg] styles
      expect(button?.className).toContain('[&_svg]');
    });
  });
});
