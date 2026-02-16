import { render } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { WindowControlDivider } from './WindowControlDivider.js';

describe('WindowControlDivider', () => {
  it('renders base styles', () => {
    const { container } = render(<WindowControlDivider />);

    expect(container.firstChild).toHaveClass(
      'mx-0.5',
      'h-3',
      'w-px',
      'bg-border/60'
    );
  });

  it('applies custom class', () => {
    const { container } = render(
      <WindowControlDivider className="custom-class" />
    );

    expect(container.firstChild).toHaveClass('custom-class');
  });
});
