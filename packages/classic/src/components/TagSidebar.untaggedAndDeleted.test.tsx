import { fireEvent, render, screen } from '@testing-library/react';
import { TagSidebar } from './TagSidebar';

describe('TagSidebar untagged items', () => {
  it('renders untagged items when untaggedCount > 0', () => {
    const onSelectTag = vi.fn();

    render(
      <TagSidebar
        tags={[{ id: 'tag-1', name: 'Work' }]}
        activeTagId={null}
        untaggedCount={5}
        onSelectTag={onSelectTag}
        onMoveTag={() => {}}
        onReorderTag={() => {}}
        searchValue=""
        onSearchChange={() => {}}
      />
    );

    expect(screen.getByText('Untagged Items (5)')).toBeInTheDocument();
    fireEvent.click(screen.getByLabelText('Select Untagged Items'));
    expect(onSelectTag).toHaveBeenCalledWith('__untagged__');
  });

  it('renders untagged items when untaggedCount is 0', () => {
    render(
      <TagSidebar
        tags={[{ id: 'tag-1', name: 'Work' }]}
        activeTagId={null}
        untaggedCount={0}
        onSelectTag={() => {}}
        onMoveTag={() => {}}
        onReorderTag={() => {}}
        searchValue=""
        onSearchChange={() => {}}
      />
    );

    expect(screen.getByText('Untagged Items (0)')).toBeInTheDocument();
  });

  it('highlights untagged items when active', () => {
    render(
      <TagSidebar
        tags={[]}
        activeTagId="__untagged__"
        untaggedCount={3}
        onSelectTag={() => {}}
        onMoveTag={() => {}}
        onReorderTag={() => {}}
        searchValue=""
        onSearchChange={() => {}}
      />
    );

    const button = screen.getByLabelText('Select Untagged Items');
    expect(button).toHaveAttribute('aria-pressed', 'true');
    const untaggedItem = button.closest('li');
    if (!untaggedItem) throw new Error('Expected untagged list item');
    expect(untaggedItem).toHaveStyle({ backgroundColor: '#e0f2fe' });
  });
});

describe('TagSidebar deleted tags', () => {
  it('renders deleted tags section under untagged items', () => {
    render(
      <TagSidebar
        tags={[{ id: 'tag-1', name: 'Work' }]}
        deletedTags={[{ id: 'tag-2', name: 'Old Tag' }]}
        activeTagId={null}
        untaggedCount={3}
        onSelectTag={() => {}}
        onMoveTag={() => {}}
        onReorderTag={() => {}}
        searchValue=""
        onSearchChange={() => {}}
      />
    );

    expect(screen.getByText('Untagged Items (3)')).toBeInTheDocument();
    expect(screen.getByText('Deleted Tags (1)')).toBeInTheDocument();
    expect(screen.getByText('Old Tag')).toBeInTheDocument();
  });

  it('restores deleted tag when restore is clicked', () => {
    const onRestoreTag = vi.fn();

    render(
      <TagSidebar
        tags={[]}
        deletedTags={[{ id: 'tag-2', name: 'Old Tag' }]}
        activeTagId={null}
        untaggedCount={0}
        onSelectTag={() => {}}
        onMoveTag={() => {}}
        onReorderTag={() => {}}
        onRestoreTag={onRestoreTag}
        searchValue=""
        onSearchChange={() => {}}
      />
    );

    fireEvent.click(screen.getByLabelText('Restore tag Old Tag'));
    expect(onRestoreTag).toHaveBeenCalledWith('tag-2');
  });
});
