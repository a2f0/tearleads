import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { DropZoneOverlay } from './DropZoneOverlay';

describe('DropZoneOverlay', () => {
  it('renders nothing when not visible', () => {
    render(<DropZoneOverlay isVisible={false} label="photos" />);

    expect(screen.queryByTestId('drop-zone-overlay')).not.toBeInTheDocument();
  });

  it('renders overlay when visible', () => {
    render(<DropZoneOverlay isVisible={true} label="photos" />);

    expect(screen.getByTestId('drop-zone-overlay')).toBeInTheDocument();
  });

  it('displays default message with label', () => {
    render(<DropZoneOverlay isVisible={true} label="photos" />);

    expect(screen.getByText('Drop photos here')).toBeInTheDocument();
  });

  it('displays custom message when provided', () => {
    render(
      <DropZoneOverlay
        isVisible={true}
        label="photos"
        message="Upload your images"
      />
    );

    expect(screen.getByText('Upload your images')).toBeInTheDocument();
    expect(screen.queryByText('Drop photos here')).not.toBeInTheDocument();
  });

  it('renders upload icon', () => {
    render(<DropZoneOverlay isVisible={true} label="documents" />);

    const overlay = screen.getByTestId('drop-zone-overlay');
    const svg = overlay.querySelector('svg');
    expect(svg).toBeInTheDocument();
  });

  it('applies custom className', () => {
    render(
      <DropZoneOverlay
        isVisible={true}
        label="files"
        className="custom-class"
      />
    );

    const overlay = screen.getByTestId('drop-zone-overlay');
    expect(overlay).toHaveClass('custom-class');
  });

  it('has pointer-events-none to allow clicks through', () => {
    render(<DropZoneOverlay isVisible={true} label="photos" />);

    const overlay = screen.getByTestId('drop-zone-overlay');
    expect(overlay).toHaveClass('pointer-events-none');
  });
});
