import { fireEvent, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import { VfsTreePanel } from './VfsTreePanel';

describe('VfsTreePanel', () => {
  const defaultProps = {
    width: 240,
    onWidthChange: vi.fn(),
    selectedFolderId: null,
    onFolderSelect: vi.fn()
  };

  it('renders header with Folders title', () => {
    render(<VfsTreePanel {...defaultProps} />);
    expect(screen.getByText('Folders')).toBeInTheDocument();
  });

  it('renders mock folders', () => {
    render(<VfsTreePanel {...defaultProps} />);
    expect(screen.getByText('My Documents')).toBeInTheDocument();
    expect(screen.getByText('Shared With Me')).toBeInTheDocument();
  });

  it('calls onFolderSelect when folder is clicked', async () => {
    const user = userEvent.setup();
    const onFolderSelect = vi.fn();
    render(<VfsTreePanel {...defaultProps} onFolderSelect={onFolderSelect} />);

    await user.click(screen.getByText('My Documents'));
    expect(onFolderSelect).toHaveBeenCalledWith('root-1');
  });

  it('expands folder to show children when chevron is double-clicked', async () => {
    const user = userEvent.setup();
    render(<VfsTreePanel {...defaultProps} />);

    expect(screen.queryByText('Work')).not.toBeInTheDocument();

    const myDocuments = screen.getByText('My Documents');
    await user.dblClick(myDocuments);

    expect(screen.getByText('Work')).toBeInTheDocument();
    expect(screen.getByText('Personal')).toBeInTheDocument();
  });

  it('collapses folder when double-clicked again', async () => {
    const user = userEvent.setup();
    render(<VfsTreePanel {...defaultProps} />);

    const myDocuments = screen.getByText('My Documents');
    await user.dblClick(myDocuments);
    expect(screen.getByText('Work')).toBeInTheDocument();

    await user.dblClick(myDocuments);
    expect(screen.queryByText('Work')).not.toBeInTheDocument();
  });

  it('applies selected style to selected folder', () => {
    const { rerender } = render(
      <VfsTreePanel {...defaultProps} selectedFolderId={null} />
    );

    const myDocsButton = screen.getByText('My Documents').closest('button');
    expect(myDocsButton).not.toHaveClass('bg-accent');

    rerender(<VfsTreePanel {...defaultProps} selectedFolderId="root-1" />);
    expect(myDocsButton).toHaveClass('bg-accent');
  });

  it('applies custom width', () => {
    const { container } = render(
      <VfsTreePanel {...defaultProps} width={300} />
    );
    const panel = container.firstChild;
    expect(panel).toHaveStyle({ width: '300px' });
  });

  it('has resize handle', () => {
    const { container } = render(<VfsTreePanel {...defaultProps} />);
    const resizeHandle = container.querySelector(
      '[class*="cursor-col-resize"]'
    );
    expect(resizeHandle).toBeInTheDocument();
  });

  it('handles resize drag on document', () => {
    const onWidthChange = vi.fn();
    const { container } = render(
      <VfsTreePanel {...defaultProps} onWidthChange={onWidthChange} />
    );

    const resizeHandle = container.querySelector(
      '[class*="cursor-col-resize"]'
    );
    if (!resizeHandle) {
      throw new Error('Resize handle not found');
    }

    fireEvent.mouseDown(resizeHandle, { clientX: 240 });
    fireEvent.mouseMove(document, { clientX: 300 });
    fireEvent.mouseUp(document);

    expect(onWidthChange).toHaveBeenCalled();
  });

  it('constrains resize within bounds', () => {
    const onWidthChange = vi.fn();
    const { container } = render(
      <VfsTreePanel {...defaultProps} onWidthChange={onWidthChange} />
    );

    const resizeHandle = container.querySelector(
      '[class*="cursor-col-resize"]'
    );
    if (!resizeHandle) {
      throw new Error('Resize handle not found');
    }

    fireEvent.mouseDown(resizeHandle, { clientX: 240 });
    fireEvent.mouseMove(document, { clientX: 50 });
    fireEvent.mouseUp(document);

    expect(onWidthChange).toHaveBeenCalled();
    const lastCall =
      onWidthChange.mock.calls[onWidthChange.mock.calls.length - 1];
    expect(lastCall?.[0]).toBeGreaterThanOrEqual(150);
  });

  it('expands folder via chevron keyboard enter', async () => {
    const user = userEvent.setup();
    render(<VfsTreePanel {...defaultProps} />);

    expect(screen.queryByText('Work')).not.toBeInTheDocument();

    const chevrons = document.querySelectorAll('[role="button"]');
    const myDocsChevron = chevrons.item(0);

    if (myDocsChevron instanceof HTMLElement) {
      myDocsChevron.focus();
      await user.keyboard('{Enter}');
    }

    expect(screen.getByText('Work')).toBeInTheDocument();
  });

  it('expands folder via chevron keyboard space', async () => {
    const user = userEvent.setup();
    render(<VfsTreePanel {...defaultProps} />);

    expect(screen.queryByText('Work')).not.toBeInTheDocument();

    const chevrons = document.querySelectorAll('[role="button"]');
    const myDocsChevron = chevrons.item(0);

    if (myDocsChevron instanceof HTMLElement) {
      myDocsChevron.focus();
      await user.keyboard(' ');
    }

    expect(screen.getByText('Work')).toBeInTheDocument();
  });
});
