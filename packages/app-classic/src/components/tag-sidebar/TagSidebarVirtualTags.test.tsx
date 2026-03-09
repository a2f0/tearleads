import { fireEvent, render, screen } from '@testing-library/react';
import { TagSidebarVirtualTags } from './TagSidebarVirtualTags';

describe('TagSidebarVirtualTags', () => {
  it('renders all and untagged entries with counts', () => {
    const onSelectTag = vi.fn();

    render(
      <TagSidebarVirtualTags
        activeTagId={null}
        totalNoteCount={8}
        untaggedCount={3}
        onSelectTag={onSelectTag}
      />
    );

    expect(screen.getByText('allItems (8)')).toBeInTheDocument();
    expect(screen.getByText('Untagged Items (3)')).toBeInTheDocument();

    fireEvent.click(screen.getByLabelText('Select All Items'));
    fireEvent.click(screen.getByLabelText('Select Untagged Items'));

    expect(onSelectTag).toHaveBeenNthCalledWith(1, '__all__');
    expect(onSelectTag).toHaveBeenNthCalledWith(2, '__untagged__');
  });

  it('marks the active virtual tag as pressed', () => {
    render(
      <TagSidebarVirtualTags
        activeTagId="__untagged__"
        totalNoteCount={0}
        untaggedCount={0}
        onSelectTag={() => {}}
      />
    );

    expect(screen.getByLabelText('Select Untagged Items')).toHaveAttribute(
      'aria-pressed',
      'true'
    );
  });
});
