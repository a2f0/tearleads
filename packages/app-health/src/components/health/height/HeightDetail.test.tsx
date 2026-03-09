import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { HeightDetail } from './HeightDetail';

describe('HeightDetail', () => {
  it('renders placeholder content', () => {
    render(<HeightDetail />);

    expect(screen.getByTestId('height-detail-placeholder')).toBeInTheDocument();
    expect(screen.getByText('Height Tracking')).toBeInTheDocument();
    expect(screen.getByText(/coming soon/i)).toBeInTheDocument();
  });

  it('shows schema reference', () => {
    render(<HeightDetail />);

    expect(screen.getByText('health_height_readings')).toBeInTheDocument();
  });

  it('displays description', () => {
    render(<HeightDetail />);

    expect(
      screen.getByText(/track height measurements over time/i)
    ).toBeInTheDocument();
  });
});
