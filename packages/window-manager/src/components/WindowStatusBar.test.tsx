import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { WindowStatusBar } from './WindowStatusBar.js';

describe('WindowStatusBar', () => {
  it('renders children', () => {
    render(<WindowStatusBar>1 item</WindowStatusBar>);

    expect(screen.getByText('1 item')).toBeInTheDocument();
  });

  it('applies error tone styles', () => {
    const { container } = render(
      <WindowStatusBar tone="error">Error message</WindowStatusBar>
    );

    expect(container.firstChild).toHaveClass(
      'bg-destructive/10',
      'text-destructive'
    );
  });

  it('uses muted tone for info', () => {
    const { container } = render(
      <WindowStatusBar tone="info">Info message</WindowStatusBar>
    );

    expect(container.firstChild).toHaveClass(
      'bg-muted/30',
      'text-muted-foreground'
    );
  });
});
