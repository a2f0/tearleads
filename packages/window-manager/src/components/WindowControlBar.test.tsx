import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { WindowControlBar } from './WindowControlBar.js';

describe('WindowControlBar', () => {
  it('renders children', () => {
    render(
      <WindowControlBar>
        <span>Controls</span>
      </WindowControlBar>
    );

    expect(screen.getByText('Controls')).toBeInTheDocument();
  });

  it('applies base and custom classes', () => {
    const { container } = render(
      <WindowControlBar className="custom-class">
        <span>Controls</span>
      </WindowControlBar>
    );

    expect(container.firstChild).toHaveClass(
      'flex',
      'h-6',
      'border-b',
      'bg-muted/20',
      'custom-class'
    );
  });
});
