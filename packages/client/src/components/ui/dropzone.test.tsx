import { act, fireEvent, render, screen } from '@testing-library/react';
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

vi.mock('@/hooks/useNativeFilePicker', () => ({
  useNativeFilePicker: vi.fn()
}));

import { useNativeFilePicker } from '@/hooks/useNativeFilePicker';
import { detectPlatform } from '@/lib/utils';

describe('Dropzone', () => {
  const mockOnFilesSelected = vi.fn();
  const mockPickFiles = vi.fn();

  beforeEach(() => {
    vi.resetAllMocks();
    vi.mocked(detectPlatform).mockReturnValue('web');
    vi.mocked(useNativeFilePicker).mockReturnValue({
      pickFiles: mockPickFiles,
      isNativePicker: false
    });
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

  describe('Native version on ios', () => {
    beforeEach(() => {
      vi.mocked(detectPlatform).mockReturnValue('ios');
      vi.mocked(useNativeFilePicker).mockReturnValue({
        pickFiles: mockPickFiles,
        isNativePicker: true
      });
    });

    it('renders the Choose Files button', () => {
      render(<Dropzone onFilesSelected={mockOnFilesSelected} />);

      expect(screen.getByTestId('dropzone-choose-files')).toBeInTheDocument();
      expect(screen.getByText('Choose Files')).toBeInTheDocument();
    });

    it('uses custom label in button text with capitalized first letter', () => {
      render(<Dropzone onFilesSelected={mockOnFilesSelected} label="photos" />);

      expect(screen.getByText('Choose Photos')).toBeInTheDocument();
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

    it('does not trigger file input or native picker when disabled', async () => {
      const user = userEvent.setup();
      render(
        <Dropzone onFilesSelected={mockOnFilesSelected} disabled={true} />
      );

      const button = screen.getByTestId('dropzone-choose-files');
      const input = screen.getByTestId('dropzone-input');
      const clickSpy = vi.spyOn(input, 'click');

      await user.click(button);

      expect(clickSpy).not.toHaveBeenCalled();
      expect(mockPickFiles).not.toHaveBeenCalled();
      clickSpy.mockRestore();
    });

    it('uses native file picker when clicked and not disabled', async () => {
      const user = userEvent.setup();
      const testFile = new File(['test'], 'test.mp3', { type: 'audio/mpeg' });
      mockPickFiles.mockResolvedValue([testFile]);

      render(
        <Dropzone
          onFilesSelected={mockOnFilesSelected}
          accept="audio/*"
          multiple={false}
        />
      );

      const button = screen.getByTestId('dropzone-choose-files');
      const input = screen.getByTestId('dropzone-input');
      const clickSpy = vi.spyOn(input, 'click');

      await user.click(button);

      expect(mockPickFiles).toHaveBeenCalledWith({
        accept: 'audio/*',
        multiple: false,
        source: undefined
      });
      expect(clickSpy).not.toHaveBeenCalled();
      expect(mockOnFilesSelected).toHaveBeenCalledWith([testFile]);
      clickSpy.mockRestore();
    });

    it('does not call onFilesSelected when picker returns empty', async () => {
      const user = userEvent.setup();
      mockPickFiles.mockResolvedValue([]);

      render(<Dropzone onFilesSelected={mockOnFilesSelected} />);

      const button = screen.getByTestId('dropzone-choose-files');
      await user.click(button);

      expect(mockOnFilesSelected).not.toHaveBeenCalled();
    });

    it('logs cancellation when native picker is cancelled', async () => {
      const user = userEvent.setup();
      const error = Object.assign(new Error('Cancelled'), {
        code: 'CANCELLED'
      });
      mockPickFiles.mockRejectedValue(error);
      const debugSpy = vi.spyOn(console, 'debug').mockImplementation(() => {});

      render(<Dropzone onFilesSelected={mockOnFilesSelected} />);

      const button = screen.getByTestId('dropzone-choose-files');
      await user.click(button);

      expect(debugSpy).toHaveBeenCalledWith(
        'Native file picker cancelled by user.'
      );

      debugSpy.mockRestore();
    });

    it('disables button while picker is open', async () => {
      const user = userEvent.setup();
      let resolvePickFiles: (files: File[]) => void = () => {};
      mockPickFiles.mockImplementation(
        () =>
          new Promise<File[]>((resolve) => {
            resolvePickFiles = resolve;
          })
      );

      render(<Dropzone onFilesSelected={mockOnFilesSelected} />);

      const button = screen.getByTestId('dropzone-choose-files');

      // Button should initially be enabled
      expect(button).not.toBeDisabled();

      // Click the button to open picker
      user.click(button);

      // Wait for the button to become disabled
      await vi.waitFor(() => {
        expect(button).toBeDisabled();
      });

      // Resolve the picker to clean up
      await act(async () => {
        resolvePickFiles([]);
      });
    });

    it('passes source prop to native picker', async () => {
      const user = userEvent.setup();
      const testFile = new File(['test'], 'photo.jpg', { type: 'image/jpeg' });
      mockPickFiles.mockResolvedValue([testFile]);

      render(
        <Dropzone
          onFilesSelected={mockOnFilesSelected}
          accept="image/*"
          source="photos"
        />
      );

      const button = screen.getByTestId('dropzone-choose-files');
      await user.click(button);

      expect(mockPickFiles).toHaveBeenCalledWith({
        accept: 'image/*',
        multiple: true,
        source: 'photos'
      });

      // Wait for all async state updates after picker resolves
      // (onFilesSelected callback + setIsPickerOpen(false) in finally block)
      await vi.waitFor(() => {
        expect(mockOnFilesSelected).toHaveBeenCalledWith([testFile]);
        expect(button).not.toBeDisabled();
      });
    });

    it('renders compact mode as square icon button', () => {
      render(
        <Dropzone
          onFilesSelected={mockOnFilesSelected}
          accept="image/*"
          source="photos"
          compact
        />
      );

      const dropzone = screen.getByTestId('dropzone-native');
      expect(dropzone).toHaveClass('aspect-square');
      expect(screen.queryByText('Choose Photos')).not.toBeInTheDocument();
    });

    it('compact mode triggers native picker when clicked', async () => {
      const user = userEvent.setup();
      const testFile = new File(['test'], 'photo.jpg', { type: 'image/jpeg' });
      mockPickFiles.mockResolvedValue([testFile]);

      render(
        <Dropzone
          onFilesSelected={mockOnFilesSelected}
          accept="image/*"
          source="photos"
          compact
        />
      );

      const dropzone = screen.getByTestId('dropzone-native');
      await user.click(dropzone);

      expect(mockPickFiles).toHaveBeenCalledWith({
        accept: 'image/*',
        multiple: true,
        source: 'photos'
      });
      expect(mockOnFilesSelected).toHaveBeenCalledWith([testFile]);
    });
  });

  describe('Native version on android', () => {
    beforeEach(() => {
      vi.mocked(detectPlatform).mockReturnValue('android');
      vi.mocked(useNativeFilePicker).mockReturnValue({
        pickFiles: mockPickFiles,
        isNativePicker: false
      });
    });

    it('renders the Choose Files button', () => {
      render(<Dropzone onFilesSelected={mockOnFilesSelected} />);

      expect(screen.getByTestId('dropzone-choose-files')).toBeInTheDocument();
      expect(screen.getByText('Choose Files')).toBeInTheDocument();
    });

    it('uses custom label in button text with capitalized first letter', () => {
      render(<Dropzone onFilesSelected={mockOnFilesSelected} label="photos" />);

      expect(screen.getByText('Choose Photos')).toBeInTheDocument();
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
