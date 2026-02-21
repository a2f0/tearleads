import { fireEvent, render, screen } from '@testing-library/react';
import { TagSidebar } from './TagSidebar';

describe('TagSidebar editing', () => {
  it('shows Save and Cancel buttons when editing a tag', () => {
    render(
      <TagSidebar
        tags={[{ id: 'tag-1', name: 'Work' }]}
        activeTagId={null}
        editingTagId="tag-1"
        onSelectTag={() => {}}
        onMoveTag={() => {}}
        onReorderTag={() => {}}
        onRenameTag={() => {}}
        onCancelEditTag={() => {}}
        searchValue=""
        onSearchChange={() => {}}
      />
    );

    expect(screen.getByLabelText('Save tag name')).toBeInTheDocument();
    expect(screen.getByLabelText('Cancel editing')).toBeInTheDocument();
  });

  it('calls onRenameTag when Save button is clicked', () => {
    const onRenameTag = vi.fn();

    render(
      <TagSidebar
        tags={[{ id: 'tag-1', name: 'Work' }]}
        activeTagId={null}
        editingTagId="tag-1"
        onSelectTag={() => {}}
        onMoveTag={() => {}}
        onReorderTag={() => {}}
        onRenameTag={onRenameTag}
        onCancelEditTag={() => {}}
        searchValue=""
        onSearchChange={() => {}}
      />
    );

    const editInput = screen.getByLabelText('Edit tag Work');
    fireEvent.change(editInput, { target: { value: 'Updated Work' } });
    fireEvent.click(screen.getByLabelText('Save tag name'));

    expect(onRenameTag).toHaveBeenCalledWith('tag-1', 'Updated Work');
  });

  it('calls onCancelEditTag when Cancel button is clicked', () => {
    const onCancelEditTag = vi.fn();

    render(
      <TagSidebar
        tags={[{ id: 'tag-1', name: 'Work' }]}
        activeTagId={null}
        editingTagId="tag-1"
        onSelectTag={() => {}}
        onMoveTag={() => {}}
        onReorderTag={() => {}}
        onRenameTag={() => {}}
        onCancelEditTag={onCancelEditTag}
        searchValue=""
        onSearchChange={() => {}}
      />
    );

    fireEvent.click(screen.getByLabelText('Cancel editing'));

    expect(onCancelEditTag).toHaveBeenCalledTimes(1);
  });

  it('does not auto-commit when clicking Save button (blur should not trigger)', async () => {
    const onRenameTag = vi.fn();

    render(
      <TagSidebar
        tags={[{ id: 'tag-1', name: 'Work' }]}
        activeTagId={null}
        editingTagId="tag-1"
        onSelectTag={() => {}}
        onMoveTag={() => {}}
        onReorderTag={() => {}}
        onRenameTag={onRenameTag}
        onCancelEditTag={() => {}}
        searchValue=""
        onSearchChange={() => {}}
      />
    );

    const editInput = screen.getByLabelText('Edit tag Work');
    fireEvent.change(editInput, { target: { value: 'Updated' } });
    fireEvent.click(screen.getByLabelText('Save tag name'));

    await vi.waitFor(() => {
      expect(onRenameTag).toHaveBeenCalledTimes(1);
    });
  });
});
