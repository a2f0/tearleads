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
    expect(screen.getByLabelText('Move tag Work up')).toBeDisabled();
    fireEvent.contextMenu(screen.getByLabelText('Select tag Personal'));
    expect(screen.getByLabelText('Move tag Personal down')).toBeDisabled();
  });

  it('renders search input and calls onSearchChange', () => {
    const onSearchChange = vi.fn();

    render(
      <TagSidebar
        tags={[{ id: 'tag-1', name: 'Work' }]}
        activeTagId={null}
        onSelectTag={() => {}}
        onMoveTag={() => {}}
        searchValue="test"
        onSearchChange={onSearchChange}
      />
    );

    expect(screen.getByDisplayValue('test')).toBeInTheDocument();

    fireEvent.change(screen.getByPlaceholderText('Search tags...'), {
      target: { value: 'work' }
    });

    expect(onSearchChange).toHaveBeenCalledWith('work');
  });
});
