import { render, screen } from '@testing-library/react';
import { createRef } from 'react';
import { describe, expect, it } from 'vitest';
import { CardTitle } from './CardTitle';

describe('CardTitle', () => {
  it('renders as h3 with default classes', () => {
    render(<CardTitle>Title</CardTitle>);

    const title = screen.getByRole('heading', { level: 3 });
    expect(title).toBeInTheDocument();
    expect(title).toHaveAttribute('data-slot', 'card-title');
    expect(title.className).toContain('font-semibold');
    expect(title.className).toContain('tracking-tight');
  });

  it('applies custom className', () => {
    render(<CardTitle className="custom-title">Title</CardTitle>);

    const title = screen.getByRole('heading', { level: 3 });
    expect(title.className).toContain('custom-title');
  });

  it('forwards ref', () => {
    const ref = createRef<HTMLHeadingElement>();
    render(<CardTitle ref={ref}>Title</CardTitle>);

    expect(ref.current).toBeInstanceOf(HTMLHeadingElement);
  });
});
