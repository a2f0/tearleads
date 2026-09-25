import type {
  ContainerDocumentQueries,
  ContainerNode,
  RecoveryFolder,
} from "@tearleads/client-sdk";
import { type MouseEvent, useEffect, useState } from "react";
import {
  MiniAppActions,
  MiniAppButton,
  MiniAppModalBackdrop,
  MiniAppModalForm,
  MiniAppModalPanel,
  MiniAppStatus,
} from "../../../../components/mini-app/MiniAppLayout";
import { listLocalOrphanFolders } from "../../../../stores/explorer/orphanedDocuments";

interface RecoveryFoldersProps {
  containerNodes: ReadonlyArray<ContainerNode>;
  currentOrganizationId: string | null;
  documentQueries: ContainerDocumentQueries;
  documentListRevision: number;
  onRecoveryChanged: () => void;
  onContainerContextMenu: (event: MouseEvent<HTMLElement>, id: string) => void;
  setSelectedId: (id: string | null) => void;
}

function useRecoveryFolders(params: RecoveryFoldersProps) {
  const [folders, setFolders] = useState<RecoveryFolder[]>([]);
  const [revision, setRevision] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const [confirm, setConfirm] = useState<RecoveryFolder | null>(null);
  const [busy, setBusy] = useState(false);
  const {
    containerNodes,
    currentOrganizationId,
    documentQueries,
    documentListRevision,
  } = params;
  const nodeIdsKey = containerNodes.map((node) => node.id).join("\u0000");
  useEffect(() => {
    setFolders([]);
    setConfirm(null);
    setError(null);
  }, [currentOrganizationId, documentQueries]);
  useEffect(() => {
    let current = true;
    void documentQueries
      .listRecoveryFolders({ currentOrganizationId })
      .then((next) => {
        if (current) {
          setFolders(next);
        }
      })
      .catch((cause: unknown) => {
        if (current)
          setError(
            cause instanceof Error
              ? cause.message
              : "Could not load retained folders.",
          );
      });

    return () => {
      current = false;
    };
  }, [
    nodeIdsKey,
    currentOrganizationId,
    documentQueries,
    documentListRevision,
    revision,
  ]);
  const localFolders = listLocalOrphanFolders(
    containerNodes,
    currentOrganizationId,
  );
  const discard = async () => {
    if (!confirm || busy) return;
    setBusy(true);
    try {
      const removed = await documentQueries.discardRecoveryFolder(confirm);
      setConfirm(null);
      if (!removed) {
        setRevision((value) => value + 1);
        setError(
          "This folder changed. Review the updated copy before discarding it.",
        );
      } else {
        params.onRecoveryChanged();
        setError(null);
        setFolders((rows) =>
          rows.filter((row) => row.containerId !== confirm.containerId),
        );
      }
    } catch (cause) {
      setError(
        cause instanceof Error
          ? cause.message
          : "Could not discard the local copy.",
      );
    } finally {
      setBusy(false);
    }
  };
  return {
    folders,
    localFolders,
    error,
    confirm,
    setConfirm,
    busy,
    discard,
    setRevision,
  };
}

export function ExplorerRecoveryFolders(params: RecoveryFoldersProps) {
  const {
    folders,
    localFolders,
    error,
    confirm,
    setConfirm,
    busy,
    discard,
    setRevision,
  } = useRecoveryFolders(params);
  return (
    <section aria-label="Retained folders">
      <MiniAppStatus>
        Folders kept on this device while their remote location is unavailable.
        Local folders can be opened or moved using their actions menu.
      </MiniAppStatus>
      <MiniAppButton onClick={() => setRevision((value) => value + 1)}>
        Refresh list
      </MiniAppButton>
      {error ? <MiniAppStatus tone="error">{error}</MiniAppStatus> : null}
      {localFolders.map((folder) => (
        <MiniAppActions key={folder.id}>
          <MiniAppButton onClick={() => params.setSelectedId(folder.id)}>
            {folder.name}
          </MiniAppButton>
          <span>
            {folder.metadataDocumentId ? "Pending folder move" : "Local folder"}
          </span>
          <MiniAppButton
            onClick={(event) => params.onContainerContextMenu(event, folder.id)}
            aria-label={`Actions for ${folder.name}`}
          >
            Actions
          </MiniAppButton>
        </MiniAppActions>
      ))}
      {folders.map((folder) => (
        <MiniAppActions key={folder.containerId}>
          <strong>{folder.name}</strong>
          <span>
            {folder.pendingUpdateCount} queued{" "}
            {folder.pendingUpdateCount === 1 ? "edit" : "edits"}
            {folder.hasStructuralIntent ? ", pending placement" : ""}
          </span>
          <MiniAppButton onClick={() => setConfirm(folder)}>
            Discard local copy
          </MiniAppButton>
        </MiniAppActions>
      ))}
      {confirm ? (
        <MiniAppModalBackdrop role="presentation">
          <MiniAppModalPanel
            role="dialog"
            aria-modal="true"
            aria-labelledby="folder-discard-title"
          >
            <MiniAppModalForm
              onSubmit={(event) => {
                event.preventDefault();
                void discard();
              }}
            >
              <h2 id="folder-discard-title">Discard local folder copy?</h2>
              <MiniAppStatus>
                This permanently removes saved metadata and queued edits for{" "}
                <strong>{confirm.name}</strong>, and cancels pending links to
                this folder. Documents and remote data are kept.
              </MiniAppStatus>
              <MiniAppActions>
                <MiniAppButton disabled={busy} onClick={() => setConfirm(null)}>
                  Cancel
                </MiniAppButton>
                <MiniAppButton disabled={busy} type="submit">
                  Discard local copy
                </MiniAppButton>
              </MiniAppActions>
            </MiniAppModalForm>
          </MiniAppModalPanel>
        </MiniAppModalBackdrop>
      ) : null}
    </section>
  );
}
