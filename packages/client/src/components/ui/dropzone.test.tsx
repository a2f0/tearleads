import { fireEvent, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { Dropzone } from './dropzone';

vi.mock('@/lib/utils', async () => {
  const actual = await vi.importActual('@/lib/utils');
  return {
    ...actual,
    detectPlatform: vi.fn(() => 'web')
  };
});

import { detectPlatform } from '@/lib/utils';

describe('Dropzone', () => {
  const mockOnFilesSelected = vi.fn();

  beforeEach(() => {
    vi.resetAllMocks();
    vi.mocked(detectPlatform).mockReturnValue('web');
  });

  describe('Web/Electron version', () => {
    it('renders the dropzone with drag and drop text', () => {
      render(<Dropzone onFilesSelected={mockOnFilesSelected} />);

      expect(screen.getByText('Drag and drop files here')).toBeInTheDocument();
      expect(screen.getByText('or click to browse')).toBeInTheDocument();
    });

    it('uses custom label in drag and drop text', () => {
      render(<Dropzone onFilesSelected={mockOnFilesSelected} label="photos" />);

      expect(screen.getByText('Drag and drop photos here')).toBeInTheDocument();
    });

    it('has the correct data-testid', () => {
      render(<Dropzone onFilesSelected={mockOnFilesSelected} />);

      expect(screen.getByTestId('dropzone')).toBeInTheDocument();
    });

    it('shows dragging state when files are dragged over', () => {
      render(<Dropzone onFilesSelected={mockOnFilesSelected} />);

      const dropzone = screen.getByTestId('dropzone');

      fireEvent.dragOver(dropzone);

      expect(dropzone).toHaveAttribute('data-dragging', 'true');
      expect(screen.getByText('Drop files here')).toBeInTheDocument();
    });

    it('removes dragging state when files are dragged away', () => {
      render(<Dropzone onFilesSelected={mockOnFilesSelected} />);

      const dropzone = screen.getByTestId('dropzone');

      fireEvent.dragOver(dropzone);
      expect(dropzone).toHaveAttribute('data-dragging', 'true');

      fireEvent.dragLeave(dropzone);
      expect(dropzone).toHaveAttribute('data-dragging', 'false');
    });

    it('calls onFilesSelected when files are dropped', () => {
      render(<Dropzone onFilesSelected={mockOnFilesSelected} />);

      const dropzone = screen.getByTestId('dropzone');
      const file = new File(['test content'], 'test.txt', {
        type: 'text/plain'
      });

      fireEvent.drop(dropzone, {
        dataTransfer: {
          files: [file]
        }
      });

      expect(mockOnFilesSelected).toHaveBeenCalledWith([file]);
    });

    it('calls onFilesSelected when files are selected via input', async () => {
      const user = userEvent.setup();
      render(<Dropzone onFilesSelected={mockOnFilesSelected} />);

      const file = new File(['test content'], 'test.txt', {
        type: 'text/plain'
      });
      const input = screen.getByTestId('dropzone-input');

      await user.upload(input, file);

      expect(mockOnFilesSelected).toHaveBeenCalledWith([file]);
    });

    it('supports multiple file selection by default', () => {
      render(<Dropzone onFilesSelected={mockOnFilesSelected} />);

      const input = screen.getByTestId('dropzone-input');

      expect(input).toHaveAttribute('multiple');
    });

    it('respects multiple=false prop', () => {
      render(
        <Dropzone onFilesSelected={mockOnFilesSelected} multiple={false} />
      );

      const input = screen.getByTestId('dropzone-input');

      expect(input).not.toHaveAttribute('multiple');
    });

    it('respects accept prop', () => {
      render(
        <Dropzone onFilesSelected={mockOnFilesSelected} accept="image/*" />
      );

      const input = screen.getByTestId('dropzone-input');

      expect(input).toHaveAttribute('accept', 'image/*');
    });

    it('does not call onFilesSelected when disabled and files are dropped', () => {
      render(
        <Dropzone onFilesSelected={mockOnFilesSelected} disabled={true} />
      );

      const dropzone = screen.getByTestId('dropzone');
      const file = new File(['test content'], 'test.txt', {
        type: 'text/plain'
      });

      fireEvent.drop(dropzone, {
        dataTransfer: {
          files: [file]
        }
      });

      expect(mockOnFilesSelected).not.toHaveBeenCalled();
    });

    it('shows disabled styling when disabled', () => {
      render(
        <Dropzone onFilesSelected={mockOnFilesSelected} disabled={true} />
      );

      const dropzone = screen.getByTestId('dropzone');

      expect(dropzone).toHaveClass('cursor-not-allowed');
      expect(dropzone).toHaveClass('opacity-50');
    });
  });

  describe.each([
    'ios',
    'android'
  ] as const)('Native version on %s', (platform) => {
    beforeEach(() => {
      vi.mocked(detectPlatform).mockReturnValue(platform);
    });

    it('renders the Choose files button', () => {
      render(<Dropzone onFilesSelected={mockOnFilesSelected} />);

      expect(screen.getByTestId('dropzone-choose-files')).toBeInTheDocument();
      expect(screen.getByText('Choose files')).toBeInTheDocument();
    });

    it('uses custom label in button text', () => {
      render(<Dropzone onFilesSelected={mockOnFilesSelected} label="photos" />);

      expect(screen.getByText('Choose photos')).toBeInTheDocument();
    });

    it('does not show drag and drop text', () => {
      render(<Dropzone onFilesSelected={mockOnFilesSelected} />);

      expect(
        screen.queryByText('Drag and drop files here')
      ).not.toBeInTheDocument();
    });

    it('has hidden file input', () => {
      render(<Dropzone onFilesSelected={mockOnFilesSelected} />);

      const input = screen.getByTestId('dropzone-input');

      expect(input).toHaveClass('hidden');
    });

    it('does not trigger file input when disabled', async () => {
      const user = userEvent.setup();
      render(
        <Dropzone onFilesSelected={mockOnFilesSelected} disabled={true} />
      );

      const button = screen.getByTestId('dropzone-choose-files');
      const input = screen.getByTestId('dropzone-input');
      const clickSpy = vi.spyOn(input, 'click');

      await user.click(button);

      expect(clickSpy).not.toHaveBeenCalled();
      clickSpy.mockRestore();
    });

    it('triggers file input when clicked and not disabled', async () => {
      const user = userEvent.setup();
      render(<Dropzone onFilesSelected={mockOnFilesSelected} />);

      const button = screen.getByTestId('dropzone-choose-files');
      const input = screen.getByTestId('dropzone-input');
      const clickSpy = vi.spyOn(input, 'click');

      await user.click(button);

      expect(clickSpy).toHaveBeenCalled();
      clickSpy.mockRestore();
    });
  });
});
