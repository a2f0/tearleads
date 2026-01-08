import { render, screen } from '@testing-library/react';
import { createRef } from 'react';
import { describe, expect, it } from 'vitest';
import { CardDescription } from './CardDescription';

describe('CardDescription', () => {
  it('renders with default classes', () => {
    render(<CardDescription data-testid="desc">Description</CardDescription>);

    const desc = screen.getByTestId('desc');
    expect(desc).toBeInTheDocument();
    expect(desc).toHaveAttribute('data-slot', 'card-description');
    expect(desc.className).toContain('text-muted-foreground');
    expect(desc.className).toContain('text-sm');
  });

  it('applies custom className', () => {
    render(
      <CardDescription data-testid="desc" className="custom-desc">
        Description
      </CardDescription>
    );

    expect(screen.getByTestId('desc').className).toContain('custom-desc');
  });

  it('forwards ref', () => {
    const ref = createRef<HTMLParagraphElement>();
    render(<CardDescription ref={ref}>Description</CardDescription>);

    expect(ref.current).toBeInstanceOf(HTMLParagraphElement);
  });
});
