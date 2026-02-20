import { useCallback, useMemo } from 'react';
import { UNTAGGED_TAG_NAME } from '../lib/constants';
import { ClassicMenuBar } from './ClassicMenuBar';
import { type ClassicAppProps, useClassicAppState } from './classicAppState';
import { NotesPane } from './NotesPane';
import { TagSidebar } from './TagSidebar';

// Re-export props type for backwards compatibility
export type { ClassicAppProps } from './classicAppState';

export function ClassicApp({
  initialState,
  autoFocusSearch,
  tagSortOrder,
  entrySortOrder,
  onTagSortOrderChange,
  onEntrySortOrderChange,
  showSortControls = true,
  onStateChange,
  onCreateTag,
  onDeleteTag,
  onRestoreTag,
  onRenameTag,
  onCreateNote,
  onUpdateNote,
  contextMenuComponents
}: ClassicAppProps) {
  const {
    state,
    tagSearch,
    setTagSearch,
    entrySearch,
    setEntrySearch,
    editingTagId,
    setEditingTagId,
    editingNoteId,
    setEditingNoteId,
    tagSearchInputRef,
    entrySearchInputRef,
    resolvedTagSortOrder,
    resolvedEntrySortOrder,
    handleTagSortOrderChange,
    handleEntrySortOrderChange,
    filteredTags,
    filteredNoteIds,
    untaggedNoteIds,
    noteCountByTagId,
    handleSelectTag,
    handleDeleteTag,
    handleRestoreTag,
    handleTagNote,
    handleMoveTag,
    handleReorderTag,
    handleMoveNote,
    handleReorderNote,
    handleCreateTag,
    handleRenameTag,
    handleCancelEditTag,
    handleCreateNote,
    handleUpdateNote,
    handleCancelEditNote
  } = useClassicAppState({
    initialState,
    tagSortOrder,
    entrySortOrder,
    onTagSortOrderChange,
    onEntrySortOrderChange,
    onStateChange,
    onCreateTag,
    onDeleteTag,
    onRestoreTag,
    onRenameTag,
    onCreateNote,
    onUpdateNote
  });

  const activeTagName = useMemo(() => {
    if (state.activeTagId === null) {
      return 'All Entries';
    }
    if (state.activeTagId === '__untagged__') {
      return UNTAGGED_TAG_NAME;
    }
    return state.tags.find((tag) => tag.id === state.activeTagId)?.name ?? null;
  }, [state.activeTagId, state.tags]);

  const handleTagSearchKeyDown = useCallback(
    (event: React.KeyboardEvent<HTMLInputElement>) => {
      if (event.key !== 'Tab') {
        return;
      }
      event.preventDefault();
      entrySearchInputRef.current?.focus();
      entrySearchInputRef.current?.select();
    },
    [entrySearchInputRef]
  );

  const handleEntrySearchKeyDown = useCallback(
    (event: React.KeyboardEvent<HTMLInputElement>) => {
      if (event.key !== 'Tab') {
        return;
      }
      event.preventDefault();
      tagSearchInputRef.current?.focus();
      tagSearchInputRef.current?.select();
    },
    [tagSearchInputRef]
  );

  return (
    <div className="flex h-full min-h-[420px] w-full flex-col overflow-hidden bg-white">
      {showSortControls && (
        <ClassicMenuBar
          tagSortOrder={resolvedTagSortOrder}
          entrySortOrder={resolvedEntrySortOrder}
          onTagSortOrderChange={handleTagSortOrderChange}
          onEntrySortOrderChange={handleEntrySortOrderChange}
        />
      )}
      <div className="flex min-h-0 flex-1">
        <TagSidebar
          tags={filteredTags}
          deletedTags={state.deletedTags}
          activeTagId={state.activeTagId}
          editingTagId={editingTagId}
          {...(autoFocusSearch !== undefined ? { autoFocusSearch } : {})}
          untaggedCount={untaggedNoteIds.length}
          noteCountByTagId={noteCountByTagId}
          onSelectTag={handleSelectTag}
          onMoveTag={handleMoveTag}
          onReorderTag={handleReorderTag}
          onCreateTag={handleCreateTag}
          onStartEditTag={setEditingTagId}
          onRenameTag={handleRenameTag}
          onCancelEditTag={handleCancelEditTag}
          onDeleteTag={handleDeleteTag}
          onRestoreTag={handleRestoreTag}
          onTagNote={handleTagNote}
          searchValue={tagSearch}
          onSearchChange={setTagSearch}
          onSearchKeyDown={handleTagSearchKeyDown}
          searchInputRef={tagSearchInputRef}
          contextMenuComponents={contextMenuComponents}
        />
        <NotesPane
          activeTagName={activeTagName}
          noteIds={filteredNoteIds}
          notesById={state.notesById}
          editingNoteId={editingNoteId}
          onMoveNote={handleMoveNote}
          onReorderNote={handleReorderNote}
          onCreateNote={handleCreateNote}
          onStartEditNote={setEditingNoteId}
          onUpdateNote={handleUpdateNote}
          onCancelEditNote={handleCancelEditNote}
          onTagNote={handleTagNote}
          searchValue={entrySearch}
          onSearchChange={setEntrySearch}
          onSearchKeyDown={handleEntrySearchKeyDown}
          searchInputRef={entrySearchInputRef}
          contextMenuComponents={contextMenuComponents}
        />
      </div>
    </div>
  );
}
