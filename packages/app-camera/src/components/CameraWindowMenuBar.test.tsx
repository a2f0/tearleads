import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { CameraWindowMenuBar } from './CameraWindowMenuBar';

vi.mock('@tearleads/app-camera/package.json', () => ({
  default: { version: '1.2.3' }
}));

describe('CameraWindowMenuBar', () => {
  it('renders File and Help menu triggers', () => {
    render(<CameraWindowMenuBar onClose={vi.fn()} />);

    expect(screen.getByRole('button', { name: 'File' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Help' })).toBeInTheDocument();
  });

  it('calls onClose when Close is clicked', async () => {
    const onClose = vi.fn();
    render(<CameraWindowMenuBar onClose={onClose} />);

    fireEvent.click(screen.getByRole('button', { name: 'File' }));
    fireEvent.click(screen.getByRole('menuitem', { name: 'Close' }));

    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it('opens About dialog with package version', async () => {
    render(<CameraWindowMenuBar onClose={vi.fn()} />);

    fireEvent.click(screen.getByRole('button', { name: 'Help' }));
    fireEvent.click(screen.getByRole('menuitem', { name: 'About' }));

    expect(await screen.findByText('About Camera')).toBeInTheDocument();
    expect(screen.getByTestId('about-version')).toHaveTextContent('1.2.3');
    expect(screen.getByRole('button', { name: 'Close' })).toBeInTheDocument();
  });
});
