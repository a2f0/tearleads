import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { NewFolderDialog } from './NewFolderDialog';

// Mock the useCreateVfsFolder hook
const mockCreateFolder = vi.fn();
vi.mock('@/hooks/useCreateVfsFolder', () => ({
  useCreateVfsFolder: () => ({
    createFolder: mockCreateFolder,
    isCreating: false,
    error: null
  })
}));

describe('NewFolderDialog', () => {
  const mockOnOpenChange = vi.fn();
  const mockOnFolderCreated = vi.fn();

  beforeEach(() => {
    vi.clearAllMocks();
    mockCreateFolder.mockResolvedValue({ id: 'test-id', name: 'Test' });
  });

  it('renders when open', () => {
    render(
      <NewFolderDialog
        open={true}
        onOpenChange={mockOnOpenChange}
        onFolderCreated={mockOnFolderCreated}
      />
    );

    expect(screen.getByText('New Folder')).toBeInTheDocument();
    expect(screen.getByTestId('new-folder-name-input')).toBeInTheDocument();
    expect(screen.getByTestId('new-folder-dialog-cancel')).toBeInTheDocument();
    expect(screen.getByTestId('new-folder-dialog-create')).toBeInTheDocument();
  });

  it('does not render when closed', () => {
    render(
      <NewFolderDialog
        open={false}
        onOpenChange={mockOnOpenChange}
        onFolderCreated={mockOnFolderCreated}
      />
    );

    expect(screen.queryByText('New Folder')).not.toBeInTheDocument();
  });

  it('calls onOpenChange when cancel is clicked', async () => {
    const user = userEvent.setup();

    render(
      <NewFolderDialog
        open={true}
        onOpenChange={mockOnOpenChange}
        onFolderCreated={mockOnFolderCreated}
      />
    );

    await user.click(screen.getByTestId('new-folder-dialog-cancel'));

    expect(mockOnOpenChange).toHaveBeenCalledWith(false);
  });

  it('calls onOpenChange when backdrop is clicked', async () => {
    const user = userEvent.setup();

    render(
      <NewFolderDialog
        open={true}
        onOpenChange={mockOnOpenChange}
        onFolderCreated={mockOnFolderCreated}
      />
    );

    await user.click(screen.getByTestId('new-folder-dialog-backdrop'));

    expect(mockOnOpenChange).toHaveBeenCalledWith(false);
  });

  it('calls onOpenChange when Escape is pressed', () => {
    render(
      <NewFolderDialog
        open={true}
        onOpenChange={mockOnOpenChange}
        onFolderCreated={mockOnFolderCreated}
      />
    );

    fireEvent.keyDown(screen.getByTestId('new-folder-dialog'), {
      key: 'Escape'
    });

    expect(mockOnOpenChange).toHaveBeenCalledWith(false);
  });

  it('creates folder when form is submitted', async () => {
    const user = userEvent.setup();

    render(
      <NewFolderDialog
        open={true}
        onOpenChange={mockOnOpenChange}
        parentFolderId="parent-123"
        onFolderCreated={mockOnFolderCreated}
      />
    );

    await user.type(screen.getByTestId('new-folder-name-input'), 'My Folder');
    await user.click(screen.getByTestId('new-folder-dialog-create'));

    await waitFor(() => {
      expect(mockCreateFolder).toHaveBeenCalledWith('My Folder', 'parent-123');
    });

    expect(mockOnFolderCreated).toHaveBeenCalledWith('test-id', 'Test');
    expect(mockOnOpenChange).toHaveBeenCalledWith(false);
  });

  it('disables create button when input is empty', () => {
    render(
      <NewFolderDialog
        open={true}
        onOpenChange={mockOnOpenChange}
        onFolderCreated={mockOnFolderCreated}
      />
    );

    const createButton = screen.getByTestId('new-folder-dialog-create');
    expect(createButton).toBeDisabled();
  });

  it('enables create button when input has value', async () => {
    const user = userEvent.setup();

    render(
      <NewFolderDialog
        open={true}
        onOpenChange={mockOnOpenChange}
        onFolderCreated={mockOnFolderCreated}
      />
    );

    await user.type(screen.getByTestId('new-folder-name-input'), 'Test');

    const createButton = screen.getByTestId('new-folder-dialog-create');
    expect(createButton).not.toBeDisabled();
  });

  it('creates folder when Enter is pressed', async () => {
    const user = userEvent.setup();

    render(
      <NewFolderDialog
        open={true}
        onOpenChange={mockOnOpenChange}
        onFolderCreated={mockOnFolderCreated}
      />
    );

    const input = screen.getByTestId('new-folder-name-input');
    await user.type(input, 'My Folder{Enter}');

    await waitFor(() => {
      expect(mockCreateFolder).toHaveBeenCalledWith('My Folder', undefined);
    });
  });

  it('traps focus on Tab key (forward)', () => {
    render(
      <NewFolderDialog
        open={true}
        onOpenChange={mockOnOpenChange}
        onFolderCreated={mockOnFolderCreated}
      />
    );

    const dialog = screen.getByTestId('new-folder-dialog');
    const cancelButton = screen.getByTestId('new-folder-dialog-cancel');

    // Focus the cancel button (last non-disabled element)
    cancelButton.focus();
    expect(document.activeElement).toBe(cancelButton);

    // Tab should wrap to first element
    fireEvent.keyDown(dialog, { key: 'Tab', shiftKey: false });

    // First focusable element is the input
    const input = screen.getByTestId('new-folder-name-input');
    expect(document.activeElement).toBe(input);
  });

  it('traps focus on Shift+Tab key (backward)', () => {
    render(
      <NewFolderDialog
        open={true}
        onOpenChange={mockOnOpenChange}
        onFolderCreated={mockOnFolderCreated}
      />
    );

    const dialog = screen.getByTestId('new-folder-dialog');
    const input = screen.getByTestId('new-folder-name-input');

    // Focus the input (first element)
    input.focus();
    expect(document.activeElement).toBe(input);

    // Shift+Tab should wrap to last element
    fireEvent.keyDown(dialog, { key: 'Tab', shiftKey: true });

    // Last focusable (non-disabled) element is the cancel button
    const cancelButton = screen.getByTestId('new-folder-dialog-cancel');
    expect(document.activeElement).toBe(cancelButton);
  });

  it('handles create folder error gracefully', async () => {
    mockCreateFolder.mockRejectedValueOnce(new Error('Creation failed'));

    const user = userEvent.setup();

    render(
      <NewFolderDialog
        open={true}
        onOpenChange={mockOnOpenChange}
        onFolderCreated={mockOnFolderCreated}
      />
    );

    await user.type(screen.getByTestId('new-folder-name-input'), 'Test Folder');
    await user.click(screen.getByTestId('new-folder-dialog-create'));

    await waitFor(() => {
      expect(mockCreateFolder).toHaveBeenCalled();
    });

    // Should not have called the success callbacks
    expect(mockOnFolderCreated).not.toHaveBeenCalled();
    expect(mockOnOpenChange).not.toHaveBeenCalledWith(false);
  });

  it('does not submit with empty or whitespace-only name', async () => {
    const user = userEvent.setup();

    render(
      <NewFolderDialog
        open={true}
        onOpenChange={mockOnOpenChange}
        onFolderCreated={mockOnFolderCreated}
      />
    );

    // Type only spaces
    await user.type(screen.getByTestId('new-folder-name-input'), '   ');

    // Button should still be disabled due to trim check
    const createButton = screen.getByTestId('new-folder-dialog-create');
    expect(createButton).toBeDisabled();
  });

  it('restores focus to previously active element on close', async () => {
    // Create a button to focus before opening dialog
    const buttonToRestore = document.createElement('button');
    buttonToRestore.textContent = 'Before Dialog';
    document.body.appendChild(buttonToRestore);
    buttonToRestore.focus();

    const { rerender } = render(
      <NewFolderDialog
        open={true}
        onOpenChange={mockOnOpenChange}
        onFolderCreated={mockOnFolderCreated}
      />
    );

    // Close the dialog
    rerender(
      <NewFolderDialog
        open={false}
        onOpenChange={mockOnOpenChange}
        onFolderCreated={mockOnFolderCreated}
      />
    );

    // Focus should be restored
    expect(document.activeElement).toBe(buttonToRestore);

    // Cleanup
    document.body.removeChild(buttonToRestore);
  });

  it('clears input when reopened', async () => {
    const user = userEvent.setup();

    const { rerender } = render(
      <NewFolderDialog
        open={true}
        onOpenChange={mockOnOpenChange}
        onFolderCreated={mockOnFolderCreated}
      />
    );

    await user.type(screen.getByTestId('new-folder-name-input'), 'Some text');

    // Close and reopen
    rerender(
      <NewFolderDialog
        open={false}
        onOpenChange={mockOnOpenChange}
        onFolderCreated={mockOnFolderCreated}
      />
    );

    rerender(
      <NewFolderDialog
        open={true}
        onOpenChange={mockOnOpenChange}
        onFolderCreated={mockOnFolderCreated}
      />
    );

    const input = screen.getByTestId('new-folder-name-input');
    expect(input).toHaveValue('');
  });
});
