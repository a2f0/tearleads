import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { Footer } from './footer';

describe('Footer', () => {
  it('renders with default copyright text', () => {
    render(<Footer version={undefined} />);

    const currentYear = new Date().getFullYear();
    expect(
      screen.getByText(`© ${currentYear} All rights reserved.`)
    ).toBeInTheDocument();
  });

  it('renders with custom copyright text', () => {
    render(<Footer version={undefined} copyrightText="Custom Copyright" />);

    expect(screen.getByText('Custom Copyright')).toBeInTheDocument();
  });

  it('renders with children', () => {
    render(
      <Footer version={undefined}>
        <span>Custom Footer Content</span>
      </Footer>
    );

    expect(screen.getByText('Custom Footer Content')).toBeInTheDocument();
  });

  it('renders version when provided', () => {
    render(<Footer version="1.2.3" />);

    const versionElements = screen.getAllByText('1.2.3');
    expect(versionElements).toHaveLength(2);
  });

  it('does not render version when undefined', () => {
    render(<Footer version={undefined} />);

    expect(screen.queryByText('1.2.3')).not.toBeInTheDocument();
  });

  it('renders with version and children', () => {
    render(
      <Footer version="2.0.0">
        <p>Footer with version</p>
      </Footer>
    );

    const versionElements = screen.getAllByText('2.0.0');
    expect(versionElements.length).toBeGreaterThan(0);
    expect(screen.getByText('Footer with version')).toBeInTheDocument();
  });

  it('has the footer data-slot attribute', () => {
    render(<Footer version={undefined} />);

    expect(screen.getByRole('contentinfo')).toHaveAttribute(
      'data-slot',
      'footer'
    );
  });

  it('applies custom className', () => {
    render(<Footer version={undefined} className="custom-class" />);

    expect(screen.getByRole('contentinfo')).toHaveClass('custom-class');
  });

  it('renders connection indicator when provided', () => {
    render(
      <Footer
        version="1.0.0"
        connectionIndicator={<span data-testid="indicator">Status</span>}
      />
    );

    expect(screen.getByTestId('indicator')).toBeInTheDocument();
  });

  it('does not render connection indicator when not provided', () => {
    render(<Footer version="1.0.0" />);

    expect(screen.queryByTestId('indicator')).not.toBeInTheDocument();
  });

  it('renders version and connection indicator together', () => {
    render(
      <Footer
        version="1.0.0"
        connectionIndicator={<span data-testid="indicator">Connected</span>}
      />
    );

    const versionElements = screen.getAllByText('1.0.0');
    expect(versionElements.length).toBeGreaterThan(0);
    expect(screen.getByTestId('indicator')).toBeInTheDocument();
  });
});
