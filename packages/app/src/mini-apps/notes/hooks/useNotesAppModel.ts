import { useCallback } from "react";
import { useMiniAppRouteSegments } from "../../../navigation/AppNavigationProvider";
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
  createNote: () => void;
  ready: boolean;
}

function useNotesRouteState(props: NotesAppProps) {
  const appRoute = useMiniAppRouteSegments("notes");
  const propSelection = useExplicitNoteSelection(props);
  const routeSelection = appRoute.isRouted
    ? parseNotesRouteSegments(appRoute.pathSegments).selection
    : propSelection;
  const selectNoteRoute = useCallback(
    (
      selection: ActiveNoteSelection,
      options: { replace?: boolean | undefined } = {},
    ) => {
      if (appRoute.isRouted) {
        appRoute.setPathSegments(formatNotesRouteSegments(selection), options);
      }
    },
    [appRoute],
  );

  return { explicitSelection: routeSelection, selectNoteRoute };
}

export function useNotesAppModel(
  props: NotesAppProps,
  setSidebar: NotesSetSidebar,
): NotesAppModel {
  const { explicitSelection, selectNoteRoute } = useNotesRouteState(props);
  const { createNote, notes, ready, selectedNoteId, selectNote } =
    useNotesDirectory({ explicitSelection, selectNoteRoute });
  const activeSelection = useActiveNoteSelection({
    explicitSelection,
    notes,
    selectedNoteId,
  });

  useNotesSidebarPanel({
    notes,
    ready,
    selectNote,
    selectedNoteId,
    setSidebar,
  });

  return { activeSelection, createNote, ready };
}
