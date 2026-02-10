import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { KeyStatusIndicator } from './KeyStatusIndicator';

describe('KeyStatusIndicator', () => {
  it('renders label text', () => {
    render(<KeyStatusIndicator exists={true} label="Salt" />);
    expect(screen.getByText('Salt')).toBeInTheDocument();
  });

  it('renders check icon when exists is true', () => {
    render(<KeyStatusIndicator exists={true} label="Salt" />);
    expect(screen.getByTestId('check-icon')).toBeInTheDocument();
    expect(screen.queryByTestId('x-icon')).not.toBeInTheDocument();
  });

  it('renders X icon when exists is false', () => {
    render(<KeyStatusIndicator exists={false} label="Salt" />);
    expect(screen.getByTestId('x-icon')).toBeInTheDocument();
    expect(screen.queryByTestId('check-icon')).not.toBeInTheDocument();
  });

  it('displays tooltip when provided', () => {
    render(
      <KeyStatusIndicator
        exists={true}
        label="Salt"
        tooltip="Random value used for key derivation"
      />
    );
    const container = screen.getByTestId('key-status-indicator');
    expect(container).toHaveAttribute(
      'title',
      'Random value used for key derivation'
    );
  });

  it('does not have title attribute when tooltip is not provided', () => {
    render(<KeyStatusIndicator exists={true} label="Salt" />);
    const container = screen.getByTestId('key-status-indicator');
    expect(container).not.toHaveAttribute('title');
  });
});
