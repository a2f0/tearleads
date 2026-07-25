import {
  createContext,
  type PropsWithChildren,
  useContext,
  useEffect,
  useMemo,
  useState,
} from "react";

export const WORKSPACE_IDS = [1, 2] as const;

// Profiles that run a single environment (e.g. the demo's side-by-side peers)
// mount just one workspace, so the switcher has nothing to switch and hides.
export const SINGLE_WORKSPACE_IDS = [WORKSPACE_IDS[0]] as const;

type WorkspaceId = (typeof WORKSPACE_IDS)[number];

export function localIdentityNamespaceForWorkspace(
  baseNamespace: string | undefined,
  workspaceId: WorkspaceId,
): string {
  // Workspaces are mounted concurrently even when hidden, so each workspace
  // needs its own namespace before PaneProvider appends `.left` / `.right`;
  // otherwise hidden panes can restore the same identity and race the visible
  // pane for the same persistent SQLite database. Routed mode reuses this so a
  // session established in windowed mode survives the mode toggle.
  return `${baseNamespace ?? "tearleads.pane"}.workspace-${workspaceId}`;
}

interface WorkspaceContextValue {
  activeWorkspace: WorkspaceId;
  setActiveWorkspace: (workspace: WorkspaceId) => void;
  workspaceIds: readonly WorkspaceId[];
}

const WorkspaceContext = createContext<WorkspaceContextValue | null>(null);

export function WorkspaceProvider({
  children,
  workspaceIds = WORKSPACE_IDS,
}: PropsWithChildren<{ workspaceIds?: readonly WorkspaceId[] }>) {
  const [activeWorkspace, setActiveWorkspace] = useState<WorkspaceId>(
    workspaceIds[0] ?? WORKSPACE_IDS[0],
  );

  useEffect(() => {
    if (!workspaceIds.includes(activeWorkspace)) {
      setActiveWorkspace(workspaceIds[0] ?? WORKSPACE_IDS[0]);
    }
  }, [activeWorkspace, workspaceIds]);

  const value = useMemo(
    () => ({ activeWorkspace, setActiveWorkspace, workspaceIds }),
    [activeWorkspace, workspaceIds],
  );

  return (
    <WorkspaceContext.Provider value={value}>
      {children}
    </WorkspaceContext.Provider>
  );
}

// Non-throwing accessor for chrome (e.g. the workspace switcher) that can render
// inside a pane shown standalone — outside any WorkspaceProvider — in tests.
export function useOptionalWorkspace(): WorkspaceContextValue | null {
  return useContext(WorkspaceContext);
}

export function useWorkspace(): WorkspaceContextValue {
  const ctx = useOptionalWorkspace();
  if (!ctx) {
    throw new Error("useWorkspace must be used within a WorkspaceProvider.");
  }
  return ctx;
}
