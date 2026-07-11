import { useOptionalWorkspace } from "./WorkspaceProvider";
import "./WorkspaceSwitcher.css";

// Lives in the single bottom bar (the pane footer). Switches the active
// workspace; renders nothing when a profile mounts only one workspace (e.g. the
// demo) or when the pane is shown standalone (no WorkspaceProvider).
export function WorkspaceSwitcher() {
  const workspace = useOptionalWorkspace();

  if (!workspace || workspace.workspaceIds.length <= 1) {
    return null;
  }

  const { activeWorkspace, setActiveWorkspace, workspaceIds } = workspace;

  return (
    <div className="workspace-switcher">
      {workspaceIds.map((id) => (
        <button
          key={id}
          type="button"
          className={`tearleads-action-button tearleads-action-button--icon workspace-button${activeWorkspace === id ? " workspace-button--active" : ""}`}
          onClick={() => setActiveWorkspace(id)}
        >
          {id}
        </button>
      ))}
    </div>
  );
}
