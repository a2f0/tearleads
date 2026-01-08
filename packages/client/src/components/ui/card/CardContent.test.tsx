import { render, screen } from '@testing-library/react';
import { createRef } from 'react';
import { describe, expect, it } from 'vitest';
import { CardContent } from './CardContent';

describe('CardContent', () => {
  it('renders with default classes', () => {
    render(<CardContent data-testid="content">Content</CardContent>);

    const content = screen.getByTestId('content');
    expect(content).toBeInTheDocument();
    expect(content).toHaveAttribute('data-slot', 'card-content');
    expect(content.className).toContain('p-6');
    expect(content.className).toContain('pt-0');
  });

  it('applies custom className', () => {
    render(
      <CardContent data-testid="content" className="custom-content">
        Content
      </CardContent>
    );

    expect(screen.getByTestId('content').className).toContain('custom-content');
  });

  it('forwards ref', () => {
    const ref = createRef<HTMLDivElement>();
    render(<CardContent ref={ref}>Content</CardContent>);

    expect(ref.current).toBeInstanceOf(HTMLDivElement);
  });
});
