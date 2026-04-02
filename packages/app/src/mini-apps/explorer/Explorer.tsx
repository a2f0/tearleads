import { useCallback, useEffect, useState } from "react";
import { useWindowSidebar } from "../../components/window/WindowSidebarContext";
import { useExplorer } from "./ExplorerProvider";
import "./Explorer.css";

export function Explorer() {
  const { nodes, ready } = useExplorer();
  const { setSidebar } = useWindowSidebar();
  const [selectedId, setSelectedId] = useState<string | null>(null);

  const renderNodeLabel = useCallback((name: string) => {
    return (
      <>
        <span className="explorer-node-icon">{"\u25B6"}</span>
        {name}
      </>
    );
  }, []);

  useEffect(() => {
    setSidebar(
      <div className="explorer-sidebar">
        {!ready ? (
          <div className="explorer-hint">Loading...</div>
        ) : nodes.length === 0 ? (
          <div className="explorer-hint">No containers.</div>
        ) : (
          nodes.map((node) => (
            <button
              key={node.id}
              type="button"
              className={
                "explorer-sidebar-item" +
                (selectedId === node.id
                  ? " explorer-sidebar-item--selected"
                  : "")
              }
              onClick={() => setSelectedId(node.id)}
            >
              {renderNodeLabel(node.name)}
            </button>
          ))
        )}
      </div>,
    );
    return () => setSidebar(null);
  }, [setSidebar, nodes, ready, selectedId, renderNodeLabel]);

  const selectedNode = nodes.find((node) => node.id === selectedId);

  return (
    <div className="explorer">
      {selectedNode ? (
        <div className="explorer-detail" key={selectedNode.id}>
          <strong>{selectedNode.name}</strong>
          <span>ID: {selectedNode.id}</span>
          <span>Kind: {selectedNode.kind}</span>
          <span>Parent: {selectedNode.parentId ?? "(root)"}</span>
        </div>
      ) : (
        <div className="explorer-hint">
          {ready && nodes.length > 0
            ? "Select a container."
            : !ready
              ? "Loading..."
              : "No containers."}
        </div>
      )}
    </div>
  );
}
