import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { WindowMenuBar } from './WindowMenuBar.js';

describe('WindowMenuBar', () => {
  it('renders children inside the menu bar', () => {
    render(
      <WindowMenuBar>
        <span>Menu</span>
      </WindowMenuBar>
    );

    expect(screen.getByText('Menu')).toBeInTheDocument();
  });

  it('accepts additional class names', () => {
    const { container } = render(
      <WindowMenuBar className="gap-2 py-0.5">
        <span>Menu</span>
      </WindowMenuBar>
    );

    expect(container.firstChild).toHaveClass('gap-2', 'py-0.5');
  });
});
