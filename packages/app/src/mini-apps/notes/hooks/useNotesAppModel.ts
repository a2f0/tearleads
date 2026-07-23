import type { DocumentSummary } from "@tearleads/client-sdk";
import { useCallback } from "react";
import { useMiniAppRouteSegments } from "../../../navigation/AppNavigationProvider";
import { useCompactRoutedMode } from "../../../navigation/useCompactRoutedMode";
import {
  type NotesContextMenuModel,
  useNotesContextMenu,
} from "../context-menu/NotesContextMenu";
import { useNotesSidebarPanel } from "../NotesSidebar";
import { formatNotesRouteSegments, parseNotesRouteSegments } from "../routes";
import type {
  ActiveNoteSelection,
  NotesAppProps,
  NotesSetSidebar,
} from "../types";
import { useActiveNoteSelection } from "./useActiveNoteSelection";
import { useExplicitNoteSelection } from "./useExplicitNoteSelection";
import { useNotesDirectory } from "./useNotesDirectory";

interface NotesAppModel {
  activeSelection: ActiveNoteSelection | null;
  contextMenu: NotesContextMenuModel;
  createNote: () => void;
  isContainerTrashed: (containerId: string | null | undefined) => boolean;
  notes: ReadonlyArray<DocumentSummary>;
  ready: boolean;
  selectedNoteId: string | null;
  selectNote: (noteId: string) => void;
  showCompactListHome: boolean;
}

function useNotesRouteState(props: NotesAppProps) {
  const appRoute = useMiniAppRouteSegments("notes");
  const { isRouted, pathSegments, setPathSegments } = appRoute;
  const propSelection = useExplicitNoteSelection(props);
  const routeSelection = isRouted
    ? parseNotesRouteSegments(pathSegments).selection
    : propSelection;
  const selectNoteRoute = useCallback(
    (
      selection: ActiveNoteSelection,
      options: { replace?: boolean | undefined } = {},
    ) => {
      if (isRouted) {
        setPathSegments(formatNotesRouteSegments(selection), options);
      }
    },
    [isRouted, setPathSegments],
  );

  return { explicitSelection: routeSelection, selectNoteRoute };
}

export function useNotesAppModel(
  props: NotesAppProps,
  setSidebar: NotesSetSidebar,
): NotesAppModel {
  const compactRoutedMode = useCompactRoutedMode();
  const { explicitSelection, selectNoteRoute } = useNotesRouteState(props);
  const {
    createNote,
    deleteNote,
    isContainerTrashed,
    notes,
    ready,
    selectedNoteId,
    selectNote,
  } = useNotesDirectory({
    autoSelectInitialNote: !compactRoutedMode || explicitSelection !== null,
    explicitSelection,
    selectNoteRoute,
  });
  const activeSelection = useActiveNoteSelection({
    explicitSelection,
    notes,
    selectedNoteId,
  });
  const contextMenu = useNotesContextMenu({ deleteNote });

  useNotesSidebarPanel({
    createNote,
    handleAreaContextMenu: contextMenu.handleAreaContextMenu,
    handleNoteContextMenu: contextMenu.handleNoteContextMenu,
    notes,
    ready,
    selectNote,
    selectedNoteId,
    setSidebar,
  });

  return {
    activeSelection,
    contextMenu,
    createNote,
    isContainerTrashed,
    notes,
    ready,
    selectedNoteId,
    selectNote,
    showCompactListHome: compactRoutedMode && explicitSelection === null,
  };
}
