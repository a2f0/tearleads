import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { DesktopBackground } from './DesktopBackground';

describe('DesktopBackground', () => {
  it('renders nothing when pattern is solid', () => {
    const { container } = render(<DesktopBackground pattern="solid" />);
    expect(container.firstChild).toBeNull();
  });

  it('renders honeycomb SVG when pattern is honeycomb', () => {
    const { container } = render(<DesktopBackground pattern="honeycomb" />);

    const svg = container.querySelector('svg');
    expect(svg).toBeInTheDocument();

    const pattern = container.querySelector('pattern#honeycomb-bg');
    expect(pattern).toBeInTheDocument();
  });

  it('renders isometric SVG when pattern is isometric', () => {
    const { container } = render(<DesktopBackground pattern="isometric" />);

    const svg = container.querySelector('svg');
    expect(svg).toBeInTheDocument();

    const pattern = container.querySelector('pattern#isometric-bg');
    expect(pattern).toBeInTheDocument();
  });

  it('renders triangles SVG when pattern is triangles', () => {
    const { container } = render(<DesktopBackground pattern="triangles" />);

    const svg = container.querySelector('svg');
    expect(svg).toBeInTheDocument();

    const pattern = container.querySelector('pattern#triangles-bg');
    expect(pattern).toBeInTheDocument();
  });

  it('renders diamonds SVG when pattern is diamonds', () => {
    const { container } = render(<DesktopBackground pattern="diamonds" />);

    const svg = container.querySelector('svg');
    expect(svg).toBeInTheDocument();

    const pattern = container.querySelector('pattern#diamonds-bg');
    expect(pattern).toBeInTheDocument();
  });

  it('has aria-hidden attribute for accessibility', () => {
    render(<DesktopBackground pattern="honeycomb" />);

    const wrapper = screen.getByTestId('desktop-background');
    expect(wrapper).toHaveAttribute('aria-hidden', 'true');
  });

  it('has pointer-events-none class to allow click-through', () => {
    render(<DesktopBackground pattern="honeycomb" />);

    const wrapper = screen.getByTestId('desktop-background');
    expect(wrapper).toHaveClass('pointer-events-none');
  });

  it('has absolute positioning to cover parent', () => {
    render(<DesktopBackground pattern="isometric" />);

    const wrapper = screen.getByTestId('desktop-background');
    expect(wrapper).toHaveClass('absolute');
    expect(wrapper).toHaveClass('inset-0');
  });

  it('applies custom className', () => {
    render(<DesktopBackground pattern="honeycomb" className="custom-class" />);

    const wrapper = screen.getByTestId('desktop-background');
    expect(wrapper).toHaveClass('custom-class');
  });
});
