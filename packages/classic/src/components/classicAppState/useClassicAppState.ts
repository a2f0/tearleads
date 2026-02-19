/**
 * Hook for ClassicApp state management.
 */

import { useCallback, useMemo, useRef, useState } from 'react';
import {
  DEFAULT_CLASSIC_NOTE_TITLE,
  DEFAULT_CLASSIC_TAG_NAME,
  UNTAGGED_TAG_ID
} from '../../lib/constants';
import {
  getActiveTagNoteIds,
  getAllNoteIds,
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
} from '../../lib/ordering';
import {
  type EntrySortOrder,
  sortNoteIds,
  sortTags,
  type TagSortOrder
} from '../../lib/sorting';
import type { ClassicState } from '../../lib/types';

function generateId(): string {
  return crypto.randomUUID();
}

interface UseClassicAppStateOptions {
  initialState: ClassicState;
  tagSortOrder?: TagSortOrder | undefined;
  entrySortOrder?: EntrySortOrder | undefined;
  onTagSortOrderChange?: ((nextSortOrder: TagSortOrder) => void) | undefined;
  onEntrySortOrderChange?:
    | ((nextSortOrder: EntrySortOrder) => void)
    | undefined;
  onStateChange?: ((state: ClassicState) => void) | undefined;
  onCreateTag?:
    | ((tagId: string, name: string) => void | Promise<void>)
    | undefined;
  onDeleteTag?: ((tagId: string) => void | Promise<void>) | undefined;
  onRestoreTag?: ((tagId: string) => void | Promise<void>) | undefined;
  onRenameTag?:
    | ((tagId: string, newName: string) => void | Promise<void>)
    | undefined;
  onCreateNote?:
    | ((
        noteId: string,
        tagId: string | null,
        title: string,
        body: string
      ) => void | Promise<void>)
    | undefined;
  onUpdateNote?:
    | ((noteId: string, title: string, body: string) => void | Promise<void>)
    | undefined;
}

export function useClassicAppState({
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
}: UseClassicAppStateOptions) {
  const [state, setState] = useState<ClassicState>(initialState);
  const [tagSearch, setTagSearch] = useState('');
  const [entrySearch, setEntrySearch] = useState('');
  const [editingTagId, setEditingTagId] = useState<string | null>(null);
  const [editingNoteId, setEditingNoteId] = useState<string | null>(null);
  const [internalTagSortOrder, setInternalTagSortOrder] =
    useState<TagSortOrder>('user-defined');
  const [internalEntrySortOrder, setInternalEntrySortOrder] =
    useState<EntrySortOrder>('user-defined');
  const tagSearchInputRef = useRef<HTMLInputElement>(null);
  const entrySearchInputRef = useRef<HTMLInputElement>(null);

  const resolvedTagSortOrder = tagSortOrder ?? internalTagSortOrder;
  const resolvedEntrySortOrder = entrySortOrder ?? internalEntrySortOrder;
  const handleTagSortOrderChange =
    onTagSortOrderChange ?? setInternalTagSortOrder;
  const handleEntrySortOrderChange =
    onEntrySortOrderChange ?? setInternalEntrySortOrder;

  const restoreFocusToTagSearch = useCallback(() => {
    setTimeout(() => {
      tagSearchInputRef.current?.focus();
    }, 0);
  }, []);

  const restoreFocusToEntrySearch = useCallback(() => {
    setTimeout(() => {
      entrySearchInputRef.current?.focus();
    }, 0);
  }, []);

  const noteCountByTagId = useMemo(() => getNoteCountByTagId(state), [state]);

  const sortedTags = useMemo(
    () =>
      sortTags({
        state,
        tags: state.tags,
        sortOrder: resolvedTagSortOrder,
        noteCountByTagId
      }),
    [noteCountByTagId, resolvedTagSortOrder, state]
  );

  const filteredTags = useMemo(() => {
    if (!tagSearch.trim()) {
      return sortedTags;
    }

    const searchLower = tagSearch.toLowerCase();
    const filtered = sortedTags.filter((tag) =>
      tag.name.toLowerCase().includes(searchLower)
    );

    if (editingTagId) {
      const editingTag = sortedTags.find((tag) => tag.id === editingTagId);
      if (editingTag && !filtered.some((tag) => tag.id === editingTagId)) {
        return [...filtered, editingTag];
      }
    }

    return filtered;
  }, [editingTagId, sortedTags, tagSearch]);

  const untaggedNoteIds = useMemo(() => getUntaggedNoteIds(state), [state]);

  const baseNoteIds = useMemo(() => {
    if (state.activeTagId === null) {
      return getAllNoteIds(state);
    }
    if (state.activeTagId === UNTAGGED_TAG_ID) {
      return untaggedNoteIds;
    }
    return getActiveTagNoteIds(state);
  }, [state, untaggedNoteIds]);

  const sortedNoteIds = useMemo(
    () =>
      sortNoteIds({
        state,
        noteIds: baseNoteIds,
        activeTagId: state.activeTagId,
        sortOrder: resolvedEntrySortOrder
      }),
    [baseNoteIds, resolvedEntrySortOrder, state]
  );

  const filteredNoteIds = useMemo(() => {
    if (!entrySearch.trim()) {
      return sortedNoteIds;
    }
    const searchLower = entrySearch.toLowerCase();
    const filtered = sortedNoteIds.filter((noteId) => {
      const note = state.notesById[noteId];
      if (!note) return false;
      return (
        note.title.toLowerCase().includes(searchLower) ||
        note.body.toLowerCase().includes(searchLower)
      );
    });

    if (editingNoteId && sortedNoteIds.includes(editingNoteId)) {
      const editingNote = state.notesById[editingNoteId];
      if (editingNote && !filtered.includes(editingNoteId)) {
        return [...filtered, editingNoteId];
      }
    }

    return filtered;
  }, [editingNoteId, entrySearch, sortedNoteIds, state.notesById]);

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
      const existingTag = state.tags.find((t) => t.id === tagId);
      const isNewTag = existingTag?.name === DEFAULT_CLASSIC_TAG_NAME;

      const nextState: ClassicState = {
        ...state,
        tags: state.tags.map((tag) =>
          tag.id === tagId ? { ...tag, name: newName } : tag
        )
      };
      updateState(nextState);

      if (isNewTag) {
        void onCreateTag?.(tagId, newName);
      } else {
        void onRenameTag?.(tagId, newName);
      }

      setEditingTagId(null);
      restoreFocusToTagSearch();
    },
    [onCreateTag, onRenameTag, restoreFocusToTagSearch, state, updateState]
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
    restoreFocusToTagSearch();
  }, [editingTagId, restoreFocusToTagSearch, state, updateState]);

  const handleCreateNote = useCallback(() => {
    const newNoteId = generateId();
    const newNote = {
      id: newNoteId,
      title: DEFAULT_CLASSIC_NOTE_TITLE,
      body: ''
    };

    if (!state.activeTagId || state.activeTagId === UNTAGGED_TAG_ID) {
      const nextState: ClassicState = {
        ...state,
        notesById: {
          ...state.notesById,
          [newNoteId]: newNote
        }
      };
      updateState(nextState);
      setEditingNoteId(newNoteId);
      return;
    }

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
      const existingNote = state.notesById[noteId];
      const isNewNote =
        existingNote?.title === DEFAULT_CLASSIC_NOTE_TITLE &&
        existingNote?.body === '';

      const nextState: ClassicState = {
        ...state,
        notesById: {
          ...state.notesById,
          [noteId]: { id: noteId, title, body }
        }
      };
      updateState(nextState);

      if (isNewNote) {
        let tagId: string | null = null;
        for (const [tid, noteIds] of Object.entries(state.noteOrderByTagId)) {
          if (noteIds.includes(noteId)) {
            tagId = tid;
            break;
          }
        }
        void onCreateNote?.(noteId, tagId, title, body);
      } else {
        void onUpdateNote?.(noteId, title, body);
      }

      setEditingNoteId(null);
      restoreFocusToEntrySearch();
    },
    [onCreateNote, onUpdateNote, restoreFocusToEntrySearch, state, updateState]
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
    restoreFocusToEntrySearch();
  }, [editingNoteId, restoreFocusToEntrySearch, state, updateState]);

  return {
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
  };
}
