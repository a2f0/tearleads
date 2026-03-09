import { fireEvent, render, screen } from '@testing-library/react';
import { ClassicMenuBar } from './ClassicMenuBar';

describe('ClassicMenuBar', () => {
  it('renders selected sort options and emits changes', () => {
    const onTagSortOrderChange = vi.fn();
    const onEntrySortOrderChange = vi.fn();

    render(
      <ClassicMenuBar
        tagSortOrder="user-defined"
        entrySortOrder="user-defined"
        onTagSortOrderChange={onTagSortOrderChange}
        onEntrySortOrderChange={onEntrySortOrderChange}
      />
    );

    const tagSort = screen.getByLabelText('Sort tags');
    const entrySort = screen.getByLabelText('Sort entries');

    fireEvent.change(tagSort, { target: { value: 'name-desc' } });
    fireEvent.change(entrySort, { target: { value: 'tag-count-asc' } });

    expect(onTagSortOrderChange).toHaveBeenCalledWith('name-desc');
    expect(onEntrySortOrderChange).toHaveBeenCalledWith('tag-count-asc');
  });

  it('ignores unsupported sort values', () => {
    const onTagSortOrderChange = vi.fn();
    const onEntrySortOrderChange = vi.fn();

    render(
      <ClassicMenuBar
        tagSortOrder="user-defined"
        entrySortOrder="user-defined"
        onTagSortOrderChange={onTagSortOrderChange}
        onEntrySortOrderChange={onEntrySortOrderChange}
      />
    );

    fireEvent.change(screen.getByLabelText('Sort tags'), {
      target: { value: 'invalid-tag-sort' }
    });
    fireEvent.change(screen.getByLabelText('Sort entries'), {
      target: { value: 'invalid-entry-sort' }
    });

    expect(onTagSortOrderChange).not.toHaveBeenCalled();
    expect(onEntrySortOrderChange).not.toHaveBeenCalled();
  });
});
