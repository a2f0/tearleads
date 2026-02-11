import { useCallback, useMemo, useRef, useState } from 'react';
import {
  DEFAULT_CLASSIC_NOTE_TITLE,
  DEFAULT_CLASSIC_TAG_NAME,
  UNTAGGED_TAG_ID,
  UNTAGGED_TAG_NAME
} from '../lib/constants';
import {
  getActiveTagNoteIds,
  getNoteCountByTagId,
  getUntaggedNoteIds,
  reorderNoteInTag,
  reorderNoteInTagToTarget,
  reorderTags,
  reorderTagToTarget,
  restoreTag,
  selectTag,
  softDeleteTag,
  tagNote
} from '../lib/ordering';
import type { ClassicState } from '../lib/types';
import type { ClassicContextMenuComponents } from './ClassicContextMenu';
import { NotesPane } from './NotesPane';
import { TagSidebar } from './TagSidebar';

function generateId(): string {
  return crypto.randomUUID();
}

export interface ClassicAppProps {
  initialState: ClassicState;
  autoFocusSearch?: boolean;
  onStateChange?: ((state: ClassicState) => void) | undefined;
  onDeleteTag?: ((tagId: string) => void | Promise<void>) | undefined;
  onRestoreTag?: ((tagId: string) => void | Promise<void>) | undefined;
  contextMenuComponents?: ClassicContextMenuComponents | undefined;
}

export function ClassicApp({
  initialState,
  autoFocusSearch,
  onStateChange,
  onDeleteTag,
  onRestoreTag,
  contextMenuComponents
}: ClassicAppProps) {
  const [state, setState] = useState<ClassicState>(initialState);
  const [tagSearch, setTagSearch] = useState('');
  const [entrySearch, setEntrySearch] = useState('');
  const [editingTagId, setEditingTagId] = useState<string | null>(null);
  const [editingNoteId, setEditingNoteId] = useState<string | null>(null);
  const tagSearchInputRef = useRef<HTMLInputElement>(null);
  const entrySearchInputRef = useRef<HTMLInputElement>(null);

  const activeTagName = useMemo(() => {
    if (state.activeTagId === UNTAGGED_TAG_ID) {
      return UNTAGGED_TAG_NAME;
    }
    return state.tags.find((tag) => tag.id === state.activeTagId)?.name ?? null;
  }, [state.activeTagId, state.tags]);

  const filteredTags = useMemo(() => {
    if (!tagSearch.trim()) {
      return state.tags;
    }
    const searchLower = tagSearch.toLowerCase();
    return state.tags.filter((tag) =>
      tag.name.toLowerCase().includes(searchLower)
    );
  }, [state.tags, tagSearch]);

  const untaggedNoteIds = useMemo(() => getUntaggedNoteIds(state), [state]);

  const noteCountByTagId = useMemo(() => getNoteCountByTagId(state), [state]);

  const noteIds = useMemo(() => {
    if (state.activeTagId === UNTAGGED_TAG_ID) {
      return untaggedNoteIds;
    }
    return getActiveTagNoteIds(state);
  }, [state, untaggedNoteIds]);

  const filteredNoteIds = useMemo(() => {
    if (!entrySearch.trim()) {
      return noteIds;
    }
    const searchLower = entrySearch.toLowerCase();
    return noteIds.filter((noteId) => {
      const note = state.notesById[noteId];
      if (!note) return false;
      return (
        note.title.toLowerCase().includes(searchLower) ||
        note.body.toLowerCase().includes(searchLower)
      );
    });
  }, [noteIds, entrySearch, state.notesById]);

  const updateState = useCallback(
    (next: ClassicState) => {
      setState(next);
      onStateChange?.(next);
    },
    [onStateChange]
  );

  const handleSelectTag = useCallback(
    (tagId: string) => {
      if (tagId === UNTAGGED_TAG_ID) {
        updateState({ ...state, activeTagId: UNTAGGED_TAG_ID });
        return;
      }
      updateState(selectTag(state, tagId));
    },
    [state, updateState]
  );

  const handleDeleteTag = useCallback(
    (tagId: string) => {
      updateState(softDeleteTag(state, tagId));
      if (onDeleteTag) {
        void Promise.resolve(onDeleteTag(tagId)).catch((err) => {
          console.error('Failed to delete tag:', err);
        });
      }
    },
    [state, updateState, onDeleteTag]
  );

  const handleRestoreTag = useCallback(
    (tagId: string) => {
      updateState(restoreTag(state, tagId));
      if (onRestoreTag) {
        void Promise.resolve(onRestoreTag(tagId)).catch((err) => {
          console.error('Failed to restore tag:', err);
        });
      }
    },
    [state, updateState, onRestoreTag]
  );

  const handleTagNote = useCallback(
    (tagId: string, noteId: string) => {
      updateState(tagNote(state, tagId, noteId));
    },
    [state, updateState]
  );

  const handleMoveTag = (tagId: string, direction: 'up' | 'down') => {
    updateState(reorderTags(state, tagId, direction));
  };

  const handleReorderTag = (tagId: string, targetTagId: string) => {
    updateState(reorderTagToTarget(state, tagId, targetTagId));
  };

  const handleMoveNote = (noteId: string, direction: 'up' | 'down') => {
    if (!state.activeTagId) {
      return;
    }
    updateState(reorderNoteInTag(state, state.activeTagId, noteId, direction));
  };

  const handleReorderNote = (noteId: string, targetNoteId: string) => {
    if (!state.activeTagId) {
      return;
    }
    updateState(
      reorderNoteInTagToTarget(state, state.activeTagId, noteId, targetNoteId)
    );
  };

  const handleCreateTag = useCallback(() => {
    const newTagId = generateId();
    const newTag = { id: newTagId, name: DEFAULT_CLASSIC_TAG_NAME };
    const nextState: ClassicState = {
      ...state,
      tags: [...state.tags, newTag],
      activeTagId: newTagId,
      noteOrderByTagId: {
        ...state.noteOrderByTagId,
        [newTagId]: []
      }
    };
    updateState(nextState);
    setEditingTagId(newTagId);
  }, [state, updateState]);

  const handleRenameTag = useCallback(
    (tagId: string, newName: string) => {
      const nextState: ClassicState = {
        ...state,
        tags: state.tags.map((tag) =>
          tag.id === tagId ? { ...tag, name: newName } : tag
        )
      };
      updateState(nextState);
      setEditingTagId(null);
    },
    [state, updateState]
  );

  const handleCancelEditTag = useCallback(() => {
    if (editingTagId) {
      const tag = state.tags.find((t) => t.id === editingTagId);
      if (tag && tag.name === DEFAULT_CLASSIC_TAG_NAME) {
        const { [editingTagId]: _removed, ...nextNoteOrderByTagId } =
          state.noteOrderByTagId;
        const nextState: ClassicState = {
          ...state,
          tags: state.tags.filter((t) => t.id !== editingTagId),
          activeTagId:
            state.activeTagId === editingTagId ? null : state.activeTagId,
          noteOrderByTagId: nextNoteOrderByTagId
        };
        updateState(nextState);
      }
    }
    setEditingTagId(null);
  }, [editingTagId, state, updateState]);

  const handleCreateNote = useCallback(() => {
    if (!state.activeTagId) return;

    const newNoteId = generateId();
    const newNote = {
      id: newNoteId,
      title: DEFAULT_CLASSIC_NOTE_TITLE,
      body: ''
    };
    const currentNoteOrder = state.noteOrderByTagId[state.activeTagId] ?? [];
    const nextState: ClassicState = {
      ...state,
      notesById: {
        ...state.notesById,
        [newNoteId]: newNote
      },
      noteOrderByTagId: {
        ...state.noteOrderByTagId,
        [state.activeTagId]: [...currentNoteOrder, newNoteId]
      }
    };
    updateState(nextState);
    setEditingNoteId(newNoteId);
  }, [state, updateState]);

  const handleUpdateNote = useCallback(
    (noteId: string, title: string, body: string) => {
      const nextState: ClassicState = {
        ...state,
        notesById: {
          ...state.notesById,
          [noteId]: { id: noteId, title, body }
        }
      };
      updateState(nextState);
      setEditingNoteId(null);
    },
    [state, updateState]
  );

  const handleCancelEditNote = useCallback(() => {
    if (editingNoteId) {
      const note = state.notesById[editingNoteId];
      if (
        note &&
        note.title === DEFAULT_CLASSIC_NOTE_TITLE &&
        note.body === ''
      ) {
        const { [editingNoteId]: _removed, ...nextNotesById } = state.notesById;
        const nextState: ClassicState = {
          ...state,
          notesById: nextNotesById,
          noteOrderByTagId: Object.fromEntries(
            Object.entries(state.noteOrderByTagId).map(([tagId, noteIds]) => [
              tagId,
              noteIds.filter((id) => id !== editingNoteId)
            ])
          )
        };
        updateState(nextState);
      }
    }
    setEditingNoteId(null);
  }, [editingNoteId, state, updateState]);

  const handleTagSearchKeyDown = useCallback(
    (event: React.KeyboardEvent<HTMLInputElement>) => {
      if (event.key !== 'Tab') {
        return;
      }
      event.preventDefault();
      entrySearchInputRef.current?.focus();
      entrySearchInputRef.current?.select();
    },
    []
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
    []
  );

  return (
    <div className="flex h-full min-h-[420px] w-full overflow-hidden bg-white">
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
  );
}
