import {
  createContext,
  type PropsWithChildren,
  useContext,
  useMemo,
  useState,
} from "react";

export const WORKSPACE_IDS = [1, 2] as const;

type WorkspaceId = (typeof WORKSPACE_IDS)[number];

interface WorkspaceContextValue {
  activeWorkspace: WorkspaceId;
  setActiveWorkspace: (workspace: WorkspaceId) => void;
}

const WorkspaceContext = createContext<WorkspaceContextValue | null>(null);

export function WorkspaceProvider({ children }: PropsWithChildren) {
  const [activeWorkspace, setActiveWorkspace] = useState<WorkspaceId>(
    WORKSPACE_IDS[0],
  );

  const value = useMemo(
    () => ({ activeWorkspace, setActiveWorkspace }),
    [activeWorkspace],
  );

  return (
    <WorkspaceContext.Provider value={value}>
      {children}
    </WorkspaceContext.Provider>
  );
}

export function useWorkspace(): WorkspaceContextValue {
  const ctx = useContext(WorkspaceContext);
  if (!ctx) {
    throw new Error("useWorkspace must be used within a WorkspaceProvider.");
  }
  return ctx;
}
