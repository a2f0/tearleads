import type { ClassicState } from './types';

export function moveItem<T>(
  items: readonly T[],
  from: number,
  to: number
): T[] {
  if (from < 0 || to < 0 || from >= items.length || to >= items.length) {
    return [...items];
  }
  if (from === to) {
    return [...items];
  }

  const next = [...items];
  const fromItem = next[from];
  if (fromItem === undefined) {
    return next;
  }

  next.splice(from, 1);
  next.splice(to, 0, fromItem);
  return next;
}

export function reorderTags(
  state: ClassicState,
  tagId: string,
  direction: 'up' | 'down'
): ClassicState {
  const fromIndex = state.tags.findIndex((tag) => tag.id === tagId);
  if (fromIndex === -1) {
    return state;
  }

  const toIndex = direction === 'up' ? fromIndex - 1 : fromIndex + 1;
  if (toIndex < 0 || toIndex >= state.tags.length) {
    return state;
  }

  return {
    ...state,
    tags: moveItem(state.tags, fromIndex, toIndex)
  };
}

export function reorderTagToTarget(
  state: ClassicState,
  tagId: string,
  targetTagId: string
): ClassicState {
  const fromIndex = state.tags.findIndex((tag) => tag.id === tagId);
  const toIndex = state.tags.findIndex((tag) => tag.id === targetTagId);
  if (fromIndex === -1 || toIndex === -1 || fromIndex === toIndex) {
    return state;
  }

  return {
    ...state,
    tags: moveItem(state.tags, fromIndex, toIndex)
  };
}

export function reorderNoteInTag(
  state: ClassicState,
  tagId: string,
  noteId: string,
  direction: 'up' | 'down'
): ClassicState {
  const noteOrder = state.noteOrderByTagId[tagId];
  if (!noteOrder) {
    return state;
  }

  const fromIndex = noteOrder.indexOf(noteId);
  if (fromIndex === -1) {
    return state;
  }

  const toIndex = direction === 'up' ? fromIndex - 1 : fromIndex + 1;
  if (toIndex < 0 || toIndex >= noteOrder.length) {
    return state;
  }

  return {
    ...state,
    noteOrderByTagId: {
      ...state.noteOrderByTagId,
      [tagId]: moveItem(noteOrder, fromIndex, toIndex)
    }
  };
}

export function reorderNoteInTagToTarget(
  state: ClassicState,
  tagId: string,
  noteId: string,
  targetNoteId: string
): ClassicState {
  const noteOrder = state.noteOrderByTagId[tagId];
  if (!noteOrder) {
    return state;
  }

  const fromIndex = noteOrder.indexOf(noteId);
  const toIndex = noteOrder.indexOf(targetNoteId);
  if (fromIndex === -1 || toIndex === -1 || fromIndex === toIndex) {
    return state;
  }

  return {
    ...state,
    noteOrderByTagId: {
      ...state.noteOrderByTagId,
      [tagId]: moveItem(noteOrder, fromIndex, toIndex)
    }
  };
}

export function getActiveTagNoteIds(state: ClassicState): string[] {
  if (!state.activeTagId) {
    return [];
  }
  return [...(state.noteOrderByTagId[state.activeTagId] ?? [])];
}

export function selectTag(state: ClassicState, tagId: string): ClassicState {
  const exists = state.tags.some((tag) => tag.id === tagId);
  if (!exists) {
    return state;
  }

  if (state.activeTagId === tagId) {
    return state;
  }

  return {
    ...state,
    activeTagId: tagId
  };
}
