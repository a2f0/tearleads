import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { PatternPreview } from './PatternPreview';

describe('PatternPreview', () => {
  const patterns: Array<'solid' | 'honeycomb' | 'isometric'> = [
    'solid',
    'honeycomb',
    'isometric'
  ];

  it.each(patterns)('renders %s pattern preview with label', (pattern) => {
    render(<PatternPreview pattern={pattern} />);
    const labels = {
      solid: 'Solid',
      honeycomb: 'Honeycomb',
      isometric: 'Isometric'
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

  it('renders no SVG for solid pattern', () => {
    const { container } = render(<PatternPreview pattern="solid" />);
    const svg = container.querySelector('svg');
    expect(svg).not.toBeInTheDocument();
  });
});
