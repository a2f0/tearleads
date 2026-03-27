import {
  createContext,
  type PropsWithChildren,
  useContext,
  useMemo,
  useState,
} from "react";

interface WorkspaceContextValue {
  activeWorkspace: number;
  setActiveWorkspace: (workspace: number) => void;
}

const WorkspaceContext = createContext<WorkspaceContextValue | null>(null);

export function WorkspaceProvider({ children }: PropsWithChildren) {
  const [activeWorkspace, setActiveWorkspace] = useState(1);

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
