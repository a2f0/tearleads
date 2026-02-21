import { fireEvent, render, screen } from '@testing-library/react';
import { TagSidebar } from './TagSidebar';

describe('TagSidebar drag and drop', () => {
  describe('tag reordering', () => {
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
  });

  describe('note dropping', () => {
    it('calls onTagNote when a note is dropped on a tag', () => {
      const onTagNote = vi.fn();
      const dataTransfer = {
        types: ['application/x-classic-note'],
        getData: vi.fn().mockReturnValue('note-1'),
        effectAllowed: 'move',
        setData: vi.fn()
      } as unknown as DataTransfer;

      render(
        <TagSidebar
          tags={[{ id: 'tag-1', name: 'Work' }]}
          activeTagId={null}
          onSelectTag={() => {}}
          onMoveTag={() => {}}
          onReorderTag={() => {}}
          onTagNote={onTagNote}
          searchValue=""
          onSearchChange={() => {}}
        />
      );

      const tagItem = screen.getByLabelText('Select tag Work').closest('li');
      if (!tagItem) throw new Error('Expected tag list item');

      fireEvent.dragOver(tagItem, { dataTransfer });
      fireEvent.drop(tagItem, { dataTransfer });

      expect(onTagNote).toHaveBeenCalledWith('tag-1', 'note-1');
    });

    it('highlights a tag while it is a valid note drop target', () => {
      const dataTransfer = {
        types: ['application/x-classic-note'],
        getData: vi.fn().mockReturnValue('note-1')
      } as unknown as DataTransfer;

      render(
        <TagSidebar
          tags={[{ id: 'tag-1', name: 'Work' }]}
          activeTagId={null}
          onSelectTag={() => {}}
          onMoveTag={() => {}}
          onReorderTag={() => {}}
          onTagNote={() => {}}
          searchValue=""
          onSearchChange={() => {}}
        />
      );

      const tagItem = screen.getByLabelText('Select tag Work').closest('li');
      if (!tagItem) throw new Error('Expected tag list item');

      fireEvent.dragEnter(tagItem, { dataTransfer });
      expect(tagItem).toHaveClass('bg-emerald-100');

      fireEvent.dragLeave(tagItem, { dataTransfer });
      expect(tagItem).not.toHaveClass('bg-emerald-100');
    });

    it('highlights and accepts plain-text fallback for note drops', () => {
      const onTagNote = vi.fn();
      const dataTransfer = {
        types: ['text/plain'],
        getData: vi.fn((key: string) => (key === 'text/plain' ? 'note-1' : ''))
      } as unknown as DataTransfer;

      render(
        <TagSidebar
          tags={[{ id: 'tag-1', name: 'Work' }]}
          activeTagId={null}
          onSelectTag={() => {}}
          onMoveTag={() => {}}
          onReorderTag={() => {}}
          onTagNote={onTagNote}
          searchValue=""
          onSearchChange={() => {}}
        />
      );

      const tagItem = screen.getByLabelText('Select tag Work').closest('li');
      if (!tagItem) throw new Error('Expected tag list item');

      fireEvent.dragEnter(tagItem, { dataTransfer });
      expect(tagItem).toHaveClass('bg-emerald-100');

      fireEvent.drop(tagItem, { dataTransfer });
      expect(onTagNote).toHaveBeenCalledWith('tag-1', 'note-1');
    });
  });
});
