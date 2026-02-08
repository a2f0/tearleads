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
      />
    );

    fireEvent.click(screen.getByLabelText('Select tag Work'));
    expect(onSelectTag).toHaveBeenCalledWith('tag-1');

    fireEvent.click(screen.getByLabelText('Move tag Work down'));
    expect(onMoveTag).toHaveBeenCalledWith('tag-1', 'down');
    fireEvent.click(screen.getByLabelText('Move tag Personal up'));
    expect(onMoveTag).toHaveBeenCalledWith('tag-2', 'up');

    expect(screen.getByLabelText('Move tag Work up')).toBeDisabled();
    expect(screen.getByLabelText('Move tag Personal down')).toBeDisabled();
  });
});
