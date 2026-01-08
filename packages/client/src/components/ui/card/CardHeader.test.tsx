import { render, screen } from '@testing-library/react';
import { createRef } from 'react';
import { describe, expect, it } from 'vitest';
import { CardHeader } from './CardHeader';

describe('CardHeader', () => {
  it('renders with default classes', () => {
    render(<CardHeader data-testid="header">Header</CardHeader>);

    const header = screen.getByTestId('header');
    expect(header).toBeInTheDocument();
    expect(header).toHaveAttribute('data-slot', 'card-header');
    expect(header.className).toContain('flex');
    expect(header.className).toContain('flex-col');
    expect(header.className).toContain('p-6');
  });

  it('applies custom className', () => {
    render(
      <CardHeader data-testid="header" className="custom-header">
        Header
      </CardHeader>
    );

    expect(screen.getByTestId('header').className).toContain('custom-header');
  });

  it('forwards ref', () => {
    const ref = createRef<HTMLDivElement>();
    render(<CardHeader ref={ref}>Header</CardHeader>);

    expect(ref.current).toBeInstanceOf(HTMLDivElement);
  });
});
