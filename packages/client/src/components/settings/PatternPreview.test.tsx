import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import type { DesktopPatternValue } from '@/db/user-settings';
import { PatternPreview } from './PatternPreview';

describe('PatternPreview', () => {
  const patterns: DesktopPatternValue[] = [
    'solid',
    'honeycomb',
    'isometric',
    'triangles',
    'diamonds'
  ];

  it.each(patterns)('renders %s pattern preview with label', (pattern) => {
    render(<PatternPreview pattern={pattern} />);
    const labels = {
      solid: 'Solid',
      honeycomb: 'Honeycomb',
      isometric: 'Isometric',
      triangles: 'Triangles',
      diamonds: 'Diamonds'
    };
    expect(screen.getByText(labels[pattern])).toBeInTheDocument();
  });

  it('renders SVG for honeycomb pattern', () => {
    const { container } = render(<PatternPreview pattern="honeycomb" />);
    const svg = container.querySelector('svg');
    expect(svg).toBeInTheDocument();
    const pattern = container.querySelector('pattern#honeycomb-preview');
    expect(pattern).toBeInTheDocument();
  });

  it('renders SVG for isometric pattern', () => {
    const { container } = render(<PatternPreview pattern="isometric" />);
    const svg = container.querySelector('svg');
    expect(svg).toBeInTheDocument();
    const pattern = container.querySelector('pattern#isometric-preview');
    expect(pattern).toBeInTheDocument();
  });

  it('renders SVG for triangles pattern', () => {
    const { container } = render(<PatternPreview pattern="triangles" />);
    const svg = container.querySelector('svg');
    expect(svg).toBeInTheDocument();
    const pattern = container.querySelector('pattern#triangles-preview');
    expect(pattern).toBeInTheDocument();
  });

  it('renders SVG for diamonds pattern', () => {
    const { container } = render(<PatternPreview pattern="diamonds" />);
    const svg = container.querySelector('svg');
    expect(svg).toBeInTheDocument();
    const pattern = container.querySelector('pattern#diamonds-preview');
    expect(pattern).toBeInTheDocument();
  });

  it('renders no SVG for solid pattern', () => {
    const { container } = render(<PatternPreview pattern="solid" />);
    const svg = container.querySelector('svg');
    expect(svg).not.toBeInTheDocument();
  });
});
