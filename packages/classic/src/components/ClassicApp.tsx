import { useMemo, useState } from 'react';
import {
  getActiveTagNoteIds,
  reorderNoteInTag,
  reorderTags,
  selectTag
} from '../lib/ordering';
import type { ClassicState } from '../lib/types';
import { NotesPane } from './NotesPane';
import { TagSidebar } from './TagSidebar';

export interface ClassicAppProps {
  initialState: ClassicState;
  onStateChange?: ((state: ClassicState) => void) | undefined;
}

export function ClassicApp({ initialState, onStateChange }: ClassicAppProps) {
  const [state, setState] = useState<ClassicState>(initialState);
  const [tagSearch, setTagSearch] = useState('');
  const [entrySearch, setEntrySearch] = useState('');

  const activeTag = useMemo(
    () => state.tags.find((tag) => tag.id === state.activeTagId) ?? null,
    [state.activeTagId, state.tags]
  );

  const filteredTags = useMemo(() => {
    if (!tagSearch.trim()) {
      return state.tags;
    }
    const searchLower = tagSearch.toLowerCase();
    return state.tags.filter((tag) =>
      tag.name.toLowerCase().includes(searchLower)
    );
  }, [state.tags, tagSearch]);

  const noteIds = useMemo(() => getActiveTagNoteIds(state), [state]);

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

  const updateState = (next: ClassicState) => {
    setState(next);
    onStateChange?.(next);
  };

  const handleSelectTag = (tagId: string) => {
    updateState(selectTag(state, tagId));
  };

  const handleMoveTag = (tagId: string, direction: 'up' | 'down') => {
    updateState(reorderTags(state, tagId, direction));
  };

  const handleMoveNote = (noteId: string, direction: 'up' | 'down') => {
    if (!state.activeTagId) {
      return;
    }
    updateState(reorderNoteInTag(state, state.activeTagId, noteId, direction));
  };

  return (
    <div className="flex h-full min-h-[420px] w-full overflow-hidden rounded border bg-white">
      <TagSidebar
        tags={filteredTags}
        activeTagId={state.activeTagId}
        onSelectTag={handleSelectTag}
        onMoveTag={handleMoveTag}
        searchValue={tagSearch}
        onSearchChange={setTagSearch}
      />
      <NotesPane
        activeTagName={activeTag?.name ?? null}
        noteIds={filteredNoteIds}
        notesById={state.notesById}
        onMoveNote={handleMoveNote}
        searchValue={entrySearch}
        onSearchChange={setEntrySearch}
      />
    </div>
  );
}
