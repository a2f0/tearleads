import { paneSideContext } from "./context";

export const usePaneSide = paneSideContext.useRequired;

// Non-throwing variant for code that runs in BOTH pane policies: the shared
// (regular app) policy mounts its runtime above the workspaces, outside any
// PaneSideProvider, so callers there must tolerate the absence rather than
// crash. Returns null when there is no surrounding PaneSideProvider.
export const usePaneSideOptional = paneSideContext.useOptional;
