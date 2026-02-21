import { fireEvent, render, screen } from '@testing-library/react';
import { TagSidebar } from './TagSidebar';

describe('TagSidebar context menu', () => {
  it('opens empty-space context menu and creates a new tag', () => {
    const onCreateTag = vi.fn();

    render(
      <TagSidebar
        tags={[]}
        activeTagId={null}
        onSelectTag={() => {}}
        onMoveTag={() => {}}
        onReorderTag={() => {}}
        onCreateTag={onCreateTag}
        searchValue=""
        onSearchChange={() => {}}
      />
    );

    fireEvent.contextMenu(
      screen.getByLabelText('Tag list, press Shift+F10 for context menu')
    );
    fireEvent.click(screen.getByRole('menuitem', { name: 'Create new tag' }));
    expect(onCreateTag).toHaveBeenCalledTimes(1);
  });

  it('shows delete option in context menu and calls onDeleteTag', () => {
    const onDeleteTag = vi.fn();

    render(
      <TagSidebar
        tags={[{ id: 'tag-1', name: 'Work' }]}
        activeTagId={null}
        onSelectTag={() => {}}
        onMoveTag={() => {}}
        onReorderTag={() => {}}
        onDeleteTag={onDeleteTag}
        searchValue=""
        onSearchChange={() => {}}
      />
    );

    fireEvent.contextMenu(screen.getByLabelText('Select tag Work'));
    fireEvent.click(screen.getByLabelText('Delete tag Work'));
    expect(onDeleteTag).toHaveBeenCalledWith('tag-1');
  });
});
