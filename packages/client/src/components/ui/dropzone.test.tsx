import { act, fireEvent, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { Dropzone } from './dropzone';

vi.mock('@/lib/utils', async () => {
  const actual = await vi.importActual('@/lib/utils');
  return { ...actual, detectPlatform: vi.fn(() => 'web') };
});

vi.mock('@/hooks/dnd', () => ({ useNativeFilePicker: vi.fn() }));

import { useNativeFilePicker } from '@/hooks/dnd';
import { detectPlatform } from '@/lib/utils';

describe('Dropzone Web/Electron', () => {
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

  it('renders drag and drop text and has correct testid', () => {
    render(<Dropzone onFilesSelected={mockOnFilesSelected} />);
    expect(screen.getByText('Drag and drop files here')).toBeInTheDocument();
    expect(screen.getByText('or click to browse')).toBeInTheDocument();
    expect(screen.getByTestId('dropzone')).toBeInTheDocument();
  });

  it('uses custom label in drag and drop text', () => {
    render(<Dropzone onFilesSelected={mockOnFilesSelected} label="photos" />);
    expect(screen.getByText('Drag and drop photos here')).toBeInTheDocument();
  });

  it('shows and removes dragging state', () => {
    render(<Dropzone onFilesSelected={mockOnFilesSelected} />);
    const dropzone = screen.getByTestId('dropzone');
    fireEvent.dragOver(dropzone);
    expect(dropzone).toHaveAttribute('data-dragging', 'true');
    expect(screen.getByText('Drop files here')).toBeInTheDocument();
    fireEvent.dragLeave(dropzone);
    expect(dropzone).toHaveAttribute('data-dragging', 'false');
  });

  it('calls onFilesSelected when files are dropped or selected via input', async () => {
    const user = userEvent.setup();
    render(<Dropzone onFilesSelected={mockOnFilesSelected} />);
    const dropzone = screen.getByTestId('dropzone');
    const file = new File(['test content'], 'test.txt', { type: 'text/plain' });
    fireEvent.drop(dropzone, { dataTransfer: { files: [file] } });
    expect(mockOnFilesSelected).toHaveBeenCalledWith([file]);
    mockOnFilesSelected.mockClear();
    const input = screen.getByTestId('dropzone-input');
    await user.upload(input, file);
    expect(mockOnFilesSelected).toHaveBeenCalledWith([file]);
  });

  it('supports multiple file selection by default and respects props', () => {
    render(<Dropzone onFilesSelected={mockOnFilesSelected} />);
    expect(screen.getByTestId('dropzone-input')).toHaveAttribute('multiple');
    const { unmount } = render(
      <Dropzone onFilesSelected={mockOnFilesSelected} multiple={false} />
    );
    unmount();
    render(<Dropzone onFilesSelected={mockOnFilesSelected} multiple={false} />);
    const inputs = screen.getAllByTestId('dropzone-input');
    expect(inputs[inputs.length - 1]).not.toHaveAttribute('multiple');
  });

  it('respects accept prop', () => {
    render(<Dropzone onFilesSelected={mockOnFilesSelected} accept="image/*" />);
    expect(screen.getByTestId('dropzone-input')).toHaveAttribute(
      'accept',
      'image/*'
    );
  });

  it('does not call onFilesSelected when disabled', () => {
    render(<Dropzone onFilesSelected={mockOnFilesSelected} disabled={true} />);
    const dropzone = screen.getByTestId('dropzone');
    fireEvent.drop(dropzone, {
      dataTransfer: {
        files: [new File(['test'], 'test.txt', { type: 'text/plain' })]
      }
    });
    expect(mockOnFilesSelected).not.toHaveBeenCalled();
    expect(dropzone).toHaveClass('cursor-not-allowed');
  });

  it('renders compact mode correctly', async () => {
    const user = userEvent.setup();
    render(
      <Dropzone
        onFilesSelected={mockOnFilesSelected}
        accept="image/*"
        compact
      />
    );
    const dropzone = screen.getByTestId('dropzone');
    expect(dropzone).toHaveClass('aspect-square');
    expect(
      screen.queryByText('Drag and drop files here')
    ).not.toBeInTheDocument();
    const file = new File(['test'], 'photo.jpg', { type: 'image/jpeg' });
    fireEvent.drop(dropzone, { dataTransfer: { files: [file] } });
    expect(mockOnFilesSelected).toHaveBeenCalledWith([file]);
    mockOnFilesSelected.mockClear();
    fireEvent.dragOver(dropzone);
    expect(dropzone).toHaveClass('ring-2');
    expect(dropzone).toHaveClass('ring-primary');
    fireEvent.dragLeave(dropzone);
    await user.upload(screen.getByTestId('dropzone-input'), file);
    expect(mockOnFilesSelected).toHaveBeenCalledWith([file]);
  });
});

describe('Dropzone Native iOS', () => {
  const mockOnFilesSelected = vi.fn();
  const mockPickFiles = vi.fn();

  beforeEach(() => {
    vi.resetAllMocks();
    vi.mocked(detectPlatform).mockReturnValue('ios');
    vi.mocked(useNativeFilePicker).mockReturnValue({
      pickFiles: mockPickFiles,
      isNativePicker: true
    });
  });

  it('renders Choose Files button and hides drag text', () => {
    render(<Dropzone onFilesSelected={mockOnFilesSelected} />);
    expect(screen.getByTestId('dropzone-choose-files')).toBeInTheDocument();
    expect(screen.getByText('Choose Files')).toBeInTheDocument();
    expect(
      screen.queryByText('Drag and drop files here')
    ).not.toBeInTheDocument();
    expect(screen.getByTestId('dropzone-input')).toHaveClass('hidden');
  });

  it('uses custom label with capitalized first letter', () => {
    render(<Dropzone onFilesSelected={mockOnFilesSelected} label="photos" />);
    expect(screen.getByText('Choose Photos')).toBeInTheDocument();
  });

  it('does not trigger picker when disabled', async () => {
    const user = userEvent.setup();
    render(<Dropzone onFilesSelected={mockOnFilesSelected} disabled={true} />);
    const button = screen.getByTestId('dropzone-choose-files');
    const input = screen.getByTestId('dropzone-input');
    const clickSpy = vi.spyOn(input, 'click');
    await user.click(button);
    expect(clickSpy).not.toHaveBeenCalled();
    expect(mockPickFiles).not.toHaveBeenCalled();
    clickSpy.mockRestore();
  });

  it('uses native file picker when clicked', async () => {
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
    await user.click(screen.getByTestId('dropzone-choose-files'));
    expect(mockPickFiles).toHaveBeenCalledWith({
      accept: 'audio/*',
      multiple: false,
      source: undefined
    });
    expect(mockOnFilesSelected).toHaveBeenCalledWith([testFile]);
  });

  it('handles empty picker result and cancellation', async () => {
    const user = userEvent.setup();
    mockPickFiles.mockResolvedValue([]);
    render(<Dropzone onFilesSelected={mockOnFilesSelected} />);
    await user.click(screen.getByTestId('dropzone-choose-files'));
    expect(mockOnFilesSelected).not.toHaveBeenCalled();
    const debugSpy = vi.spyOn(console, 'debug').mockImplementation(() => {});
    mockPickFiles.mockRejectedValue(
      Object.assign(new Error('Cancelled'), { code: 'CANCELLED' })
    );
    await user.click(screen.getByTestId('dropzone-choose-files'));
    expect(debugSpy).toHaveBeenCalledWith(
      'Native file picker cancelled by user.'
    );
    debugSpy.mockRestore();
  });

  it('logs errors when picker fails', async () => {
    const user = userEvent.setup();
    const error = new Error('Picker failed');
    mockPickFiles.mockRejectedValue(error);
    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    render(<Dropzone onFilesSelected={mockOnFilesSelected} />);
    await user.click(screen.getByTestId('dropzone-choose-files'));
    expect(errorSpy).toHaveBeenCalledWith('Native file picker failed:', error);
    mockPickFiles.mockRejectedValue('String error');
    await user.click(screen.getByTestId('dropzone-choose-files'));
    expect(errorSpy).toHaveBeenCalledWith(
      'Native file picker failed:',
      'String error'
    );
    errorSpy.mockRestore();
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
    expect(button).not.toBeDisabled();
    user.click(button);
    await vi.waitFor(() => expect(button).toBeDisabled());
    await act(async () => {
      resolvePickFiles([]);
    });
  });

  it('passes source prop to picker', async () => {
    const user = userEvent.setup();
    const testFile = new File(['test'], 'photo.jpg', { type: 'image/jpeg' });
    let resolvePickFiles: (files: File[]) => void = () => {};
    mockPickFiles.mockImplementation(
      () =>
        new Promise<File[]>((resolve) => {
          resolvePickFiles = resolve;
        })
    );
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
    await vi.waitFor(() => expect(button).toBeDisabled());
    await act(async () => {
      resolvePickFiles([testFile]);
    });
    await vi.waitFor(() => {
      expect(mockOnFilesSelected).toHaveBeenCalledWith([testFile]);
      expect(button).not.toBeDisabled();
    });
  });

  it('renders compact mode and triggers picker', async () => {
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
    expect(dropzone).toHaveClass('aspect-square');
    expect(screen.queryByText('Choose Photos')).not.toBeInTheDocument();
    await user.click(dropzone);
    expect(mockPickFiles).toHaveBeenCalledWith({
      accept: 'image/*',
      multiple: true,
      source: 'photos'
    });
    expect(mockOnFilesSelected).toHaveBeenCalledWith([testFile]);
  });
});

describe('Dropzone Native Android', () => {
  const mockOnFilesSelected = vi.fn();
  const mockPickFiles = vi.fn();

  beforeEach(() => {
    vi.resetAllMocks();
    vi.mocked(detectPlatform).mockReturnValue('android');
    vi.mocked(useNativeFilePicker).mockReturnValue({
      pickFiles: mockPickFiles,
      isNativePicker: false
    });
  });

  it('renders Choose Files button and hides drag text', () => {
    render(<Dropzone onFilesSelected={mockOnFilesSelected} />);
    expect(screen.getByTestId('dropzone-choose-files')).toBeInTheDocument();
    expect(screen.getByText('Choose Files')).toBeInTheDocument();
    expect(
      screen.queryByText('Drag and drop files here')
    ).not.toBeInTheDocument();
    expect(screen.getByTestId('dropzone-input')).toHaveClass('hidden');
  });

  it('uses custom label with capitalized first letter', () => {
    render(<Dropzone onFilesSelected={mockOnFilesSelected} label="photos" />);
    expect(screen.getByText('Choose Photos')).toBeInTheDocument();
  });

  it('does not trigger file input when disabled', async () => {
    const user = userEvent.setup();
    render(<Dropzone onFilesSelected={mockOnFilesSelected} disabled={true} />);
    const input = screen.getByTestId('dropzone-input');
    const clickSpy = vi.spyOn(input, 'click');
    await user.click(screen.getByTestId('dropzone-choose-files'));
    expect(clickSpy).not.toHaveBeenCalled();
    clickSpy.mockRestore();
  });

  it('triggers file input when clicked', async () => {
    const user = userEvent.setup();
    render(<Dropzone onFilesSelected={mockOnFilesSelected} />);
    const input = screen.getByTestId('dropzone-input');
    const clickSpy = vi.spyOn(input, 'click');
    await user.click(screen.getByTestId('dropzone-choose-files'));
    expect(clickSpy).toHaveBeenCalled();
    clickSpy.mockRestore();
  });
});
