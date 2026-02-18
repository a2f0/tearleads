import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { createRef } from 'react';
import { describe, expect, it, vi } from 'vitest';
import { Button, buttonVariants } from './button';

describe('Button', () => {
  it('renders button content and handles click', async () => {
    const user = userEvent.setup();
    const onClick = vi.fn();
    render(<Button onClick={onClick}>Click me</Button>);

    await user.click(screen.getByRole('button', { name: 'Click me' }));

    expect(onClick).toHaveBeenCalledTimes(1);
    expect(screen.getByRole('button')).toHaveAttribute('data-slot', 'button');
  });

  it('supports disabled state and forwarded refs', () => {
    const ref = createRef<HTMLButtonElement>();
    render(
      <Button ref={ref} disabled>
        Disabled
      </Button>
    );

    expect(screen.getByRole('button')).toBeDisabled();
    expect(ref.current).toBeInstanceOf(HTMLButtonElement);
  });

  it('applies variant and size classes', () => {
    render(
      <Button variant="destructive" size="sm" className="custom-class">
        Styled
      </Button>
    );

    expect(screen.getByRole('button')).toHaveClass(
      'bg-destructive',
      'h-8',
      'custom-class'
    );
  });

  it('renders as child slot when requested', () => {
    render(
      <Button asChild>
        <a href="/test">Link Button</a>
      </Button>
    );

    const link = screen.getByRole('link', { name: 'Link Button' });
    expect(link).toHaveAttribute('href', '/test');
    expect(link).toHaveClass('inline-flex');
  });

  it('exports buttonVariants helper', () => {
    const classes = buttonVariants({ variant: 'outline', size: 'lg' });
    expect(classes).toContain('border');
    expect(classes).toContain('h-10');
  });
});
