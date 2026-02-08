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

  const activeTag = useMemo(
    () => state.tags.find((tag) => tag.id === state.activeTagId) ?? null,
    [state.activeTagId, state.tags]
  );

  const noteIds = useMemo(() => getActiveTagNoteIds(state), [state]);

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
    updateState(reorderNoteInTag(state, String(state.activeTagId), noteId, direction));
  };

  return (
    <div className="flex h-full min-h-[420px] w-full overflow-hidden rounded border bg-white">
      <TagSidebar
        tags={state.tags}
        activeTagId={state.activeTagId}
        onSelectTag={handleSelectTag}
        onMoveTag={handleMoveTag}
      />
      <NotesPane
        activeTagName={activeTag?.name ?? null}
        noteIds={noteIds}
        notesById={state.notesById}
        onMoveNote={handleMoveNote}
      />
    </div>
  );
}
