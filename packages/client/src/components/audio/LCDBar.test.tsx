import { render } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { LCDBar } from './LCDBar';
import { SEGMENT_COUNT } from './visualizer.utils';

describe('LCDBar', () => {
  it('renders all segments', () => {
    const { container } = render(<LCDBar normalizedHeight={0.5} />);
    const segments = container.querySelectorAll('.h-1');
    expect(segments).toHaveLength(SEGMENT_COUNT);
  });

  it('renders no active segments when normalizedHeight is 0', () => {
    const { container } = render(<LCDBar normalizedHeight={0} />);
    const activeSegments = container.querySelectorAll('.bg-primary');
    expect(activeSegments).toHaveLength(0);
  });

  it('renders all segments active when normalizedHeight is 1', () => {
    const { container } = render(<LCDBar normalizedHeight={1} />);
    // Should have primary (low), accent (mid), and destructive (high) segments
    const primarySegments = container.querySelectorAll('.bg-primary');
    const accentSegments = container.querySelectorAll(
      '.bg-accent-foreground, .dark\\:bg-accent'
    );
    const destructiveSegments = container.querySelectorAll('.bg-destructive');

    // All segments should be active
    expect(
      primarySegments.length +
        accentSegments.length +
        destructiveSegments.length
    ).toBe(SEGMENT_COUNT);
  });

  it('renders partial active segments for mid-level height', () => {
    const { container } = render(<LCDBar normalizedHeight={0.5} />);
    const segments = container.querySelectorAll('.h-1');
    expect(segments).toHaveLength(SEGMENT_COUNT);

    // Approximately half should be inactive (has /20 opacity)
    const inactiveSegments = container.querySelectorAll('[class*="/20"]');
    expect(inactiveSegments.length).toBeGreaterThan(0);
  });

  it('applies transition classes to all segments', () => {
    const { container } = render(<LCDBar normalizedHeight={0.5} />);
    const segments = container.querySelectorAll('.transition-colors');
    expect(segments).toHaveLength(SEGMENT_COUNT);
  });
});
