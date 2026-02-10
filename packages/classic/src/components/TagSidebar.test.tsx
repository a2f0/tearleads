import { fireEvent, render, screen } from '@testing-library/react';
import { TagSidebar } from './TagSidebar';

describe('TagSidebar', () => {
  it('renders empty state', () => {
    render(
      <TagSidebar
        tags={[]}
        activeTagId={null}
        onSelectTag={() => {}}
        onMoveTag={() => {}}
        onReorderTag={() => {}}
        searchValue=""
        onSearchChange={() => {}}
      />
    );

    expect(screen.getByText('No tags found.')).toBeInTheDocument();
  });

  it('renders tags and emits events', () => {
    const onSelectTag = vi.fn();
    const onMoveTag = vi.fn();

    render(
      <TagSidebar
        tags={[
          { id: 'tag-1', name: 'Work' },
          { id: 'tag-2', name: 'Personal' }
        ]}
        activeTagId="tag-2"
        onSelectTag={onSelectTag}
        onMoveTag={onMoveTag}
        onReorderTag={() => {}}
        searchValue=""
        onSearchChange={() => {}}
      />
    );

    fireEvent.click(screen.getByLabelText('Select tag Work'));
    expect(onSelectTag).toHaveBeenCalledWith('tag-1');

    fireEvent.contextMenu(screen.getByLabelText('Select tag Work'));
    fireEvent.click(screen.getByLabelText('Move tag Work down'));
    expect(onMoveTag).toHaveBeenCalledWith('tag-1', 'down');

    fireEvent.contextMenu(screen.getByLabelText('Select tag Personal'));
    fireEvent.click(screen.getByLabelText('Move tag Personal up'));
    expect(onMoveTag).toHaveBeenCalledWith('tag-2', 'up');

    fireEvent.contextMenu(screen.getByLabelText('Select tag Work'));
    expect(screen.queryByLabelText('Move tag Work up')).not.toBeInTheDocument();
    fireEvent.contextMenu(screen.getByLabelText('Select tag Personal'));
    expect(
      screen.queryByLabelText('Move tag Personal down')
    ).not.toBeInTheDocument();
  });

  it('renders left-side drag handles for tags', () => {
    render(
      <TagSidebar
        tags={[
          { id: 'tag-1', name: 'Work' },
          { id: 'tag-2', name: 'Personal' }
        ]}
        activeTagId={null}
        onSelectTag={() => {}}
        onMoveTag={() => {}}
        onReorderTag={() => {}}
        searchValue=""
        onSearchChange={() => {}}
      />
    );

    expect(screen.getAllByTitle('Drag tag')).toHaveLength(2);
  });

  it('renders search input and calls onSearchChange', () => {
    const onSearchChange = vi.fn();

    render(
      <TagSidebar
        tags={[{ id: 'tag-1', name: 'Work' }]}
        activeTagId={null}
        onSelectTag={() => {}}
        onMoveTag={() => {}}
        onReorderTag={() => {}}
        searchValue="test"
        onSearchChange={onSearchChange}
      />
    );

    expect(screen.getByDisplayValue('test')).toBeInTheDocument();

    fireEvent.change(screen.getByLabelText('Search tags'), {
      target: { value: 'work' }
    });

    expect(onSearchChange).toHaveBeenCalledWith('work');
  });

  it('reorders tags while hovering dragged tag over a target', () => {
    const onReorderTag = vi.fn();
    const dataTransfer = {
      effectAllowed: 'move',
      setData: vi.fn()
    } as unknown as DataTransfer;

    render(
      <TagSidebar
        tags={[
          { id: 'tag-1', name: 'Work' },
          { id: 'tag-2', name: 'Personal' }
        ]}
        activeTagId={null}
        onSelectTag={() => {}}
        onMoveTag={() => {}}
        onReorderTag={onReorderTag}
        searchValue=""
        onSearchChange={() => {}}
      />
    );

    const [firstHandle] = screen.getAllByTitle('Drag tag');
    if (!firstHandle) {
      throw new Error('Expected first tag drag handle');
    }
    fireEvent.mouseDown(firstHandle);
    fireEvent.dragStart(firstHandle, { dataTransfer });

    const personalItem = screen
      .getByLabelText('Select tag Personal')
      .closest('li');
    if (!personalItem) {
      throw new Error('Expected personal tag list item');
    }
    fireEvent.dragOver(personalItem);

    expect(onReorderTag).toHaveBeenCalledWith('tag-1', 'tag-2');
  });

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

    fireEvent.contextMenu(screen.getByText('No tags found.'));
    fireEvent.click(screen.getByLabelText('Create new tag'));
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

  it('does not render untagged items when untaggedCount is 0', () => {
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

    expect(screen.queryByText(/Untagged Items/)).not.toBeInTheDocument();
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
  });
});
