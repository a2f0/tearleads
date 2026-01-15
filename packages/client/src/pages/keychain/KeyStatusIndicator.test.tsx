import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { KeyStatusIndicator } from './KeyStatusIndicator';

describe('KeyStatusIndicator', () => {
  it('renders label text', () => {
    render(<KeyStatusIndicator exists={true} label="Salt" />);
    expect(screen.getByText('Salt')).toBeInTheDocument();
  });

  it('renders check icon when exists is true', () => {
    const { container } = render(
      <KeyStatusIndicator exists={true} label="Salt" />
    );
    const checkIcon = container.querySelector('.text-green-500');
    expect(checkIcon).toBeInTheDocument();
  });

  it('renders X icon when exists is false', () => {
    const { container } = render(
      <KeyStatusIndicator exists={false} label="Salt" />
    );
    const xIcon = container.querySelector('.text-muted-foreground');
    expect(xIcon).toBeInTheDocument();
  });

  it('displays tooltip when provided', () => {
    render(
      <KeyStatusIndicator
        exists={true}
        label="Salt"
        tooltip="Random value used for key derivation"
      />
    );
    const container = screen.getByText('Salt').closest('div');
    expect(container).toHaveAttribute(
      'title',
      'Random value used for key derivation'
    );
  });

  it('does not have title attribute when tooltip is not provided', () => {
    render(<KeyStatusIndicator exists={true} label="Salt" />);
    const container = screen.getByText('Salt').closest('div');
    expect(container).not.toHaveAttribute('title');
  });
});
