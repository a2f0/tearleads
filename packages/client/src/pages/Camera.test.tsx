import { render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { describe, expect, it, vi } from 'vitest';

vi.mock('@tearleads/camera', () => ({
  CameraCapture: () => <div data-testid="camera-capture" />
}));

import { Camera } from './Camera';

describe('Camera', () => {
  it('renders camera page content', () => {
    render(
      <MemoryRouter>
        <Camera />
      </MemoryRouter>
    );

    expect(screen.getByRole('heading', { name: 'Camera' })).toBeInTheDocument();
    expect(screen.getByTestId('camera-capture')).toBeInTheDocument();
  });
});
