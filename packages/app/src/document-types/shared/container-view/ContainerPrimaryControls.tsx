import type {
  ContainerDocumentQueries,
  ContainerNode,
} from "@tearleads/client-sdk";
import {
  MiniAppButton,
  MiniAppStatus,
} from "../../../components/mini-app/MiniAppLayout";
import { ContainerPrimaryPicker } from "./ContainerPrimaryPicker";
import type { PrimaryDocumentSaveState } from "./primaryDocumentSaveMachine";

export function ContainerPrimaryControls({
  node,
  documentQueries,
  revision,
  canManage,
  saving,
  choosing,
  setChoosing,
  choose,
}: {
  node: ContainerNode;
  documentQueries: ContainerDocumentQueries;
  revision: number;
  canManage: boolean;
  saving: PrimaryDocumentSaveState;
  choosing: boolean;
  setChoosing: (choosing: boolean) => void;
  choose: (documentId: string | null) => Promise<void>;
}) {
  const busy = saving.status === "saving";
  return (
    <>
      {canManage ? (
        <div className="container-view-actions">
          <MiniAppButton disabled={busy} onClick={() => setChoosing(true)}>
            {node.primaryDocumentId
              ? "Change primary document"
              : "Set primary document"}
          </MiniAppButton>
          {node.primaryDocumentId ? (
            <MiniAppButton
              disabled={busy}
              onClick={() => {
                void choose(null);
              }}
            >
              Clear primary document
            </MiniAppButton>
          ) : null}
        </div>
      ) : null}
      {busy ? <MiniAppStatus>Saving container view…</MiniAppStatus> : null}
      {saving.status === "failed" ? (
        <div role="alert">{saving.error}</div>
      ) : null}
      {choosing && canManage ? (
        <ContainerPrimaryPicker
          containerId={node.id}
          documentQueries={documentQueries}
          revision={revision}
          busy={busy}
          onChoose={(id) => {
            void choose(id);
          }}
          onCancel={() => setChoosing(false)}
        />
      ) : null}
    </>
  );
}
