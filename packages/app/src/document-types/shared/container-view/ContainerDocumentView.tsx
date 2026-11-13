import "./ContainerDocumentView.css";
import type {
  ContainerDocumentQueries,
  ContainerNode,
  DomainScope,
} from "@tearleads/client-sdk";
import { type ReactNode, useCallback, useMemo, useState } from "react";
import {
  MiniAppButton,
  MiniAppStatus,
} from "../../../components/mini-app/MiniAppLayout";
import { getDocumentTypeDefinition } from "../../registry";
import { ContainerNotes } from "./ContainerNotes";
import { ContainerPrimaryControls } from "./ContainerPrimaryControls";
import { useContainerViewResource } from "./useContainerViewResource";
import { usePrimaryDocumentSave } from "./usePrimaryDocumentSave";

interface ContainerDocumentViewProps {
  children: ReactNode;
  documentQueries: ContainerDocumentQueries;
  logError: (message: string | Error, cause?: unknown) => void;
  node: ContainerNode;
  onOpenDocument: (localId: string, containerId: string) => void;
  readOnly: boolean;
  revision: number;
  scope: DomainScope;
  setPrimary: (
    containerId: string,
    documentId: string | null,
  ) => Promise<ContainerNode | null>;
}

function canManagePrimary(node: ContainerNode, readOnly: boolean) {
  return (
    !readOnly &&
    node.metadataReady !== false &&
    (node.effectiveAccessLevel === "admin" ||
      node.effectiveAccessLevel === "write")
  );
}

function usePrimaryDocument({
  node,
  documentQueries,
  revision,
  readOnly,
}: ContainerDocumentViewProps) {
  const load = useCallback(() => {
    void revision;
    return node.primaryDocumentId
      ? documentQueries.loadContainerDocumentSummary({
          containerId: node.id,
          documentId: node.primaryDocumentId,
        })
      : Promise.resolve(null);
  }, [node.id, node.primaryDocumentId, documentQueries, revision]);
  const identity = useMemo(
    () => ({}),
    [
      node.id,
      node.primaryDocumentId,
      node.effectiveAccessLevel,
      node.metadataReady,
      documentQueries,
      readOnly,
    ],
  );
  return useContainerViewResource(load, identity);
}

function ContainerViewSession(props: ContainerDocumentViewProps) {
  const { node, documentQueries, revision } = props;
  const [showContents, setShowContents] = useState(false);
  const [choosing, setChoosing] = useState(false);
  const canManage = canManagePrimary(node, props.readOnly);
  const saving = usePrimaryDocumentSave({
    containerId: node.id,
    canManage,
    setPrimary: props.setPrimary,
    logError: props.logError,
  });
  const choose = async (documentId: string | null) => {
    if (await saving.save(documentId)) {
      setChoosing(false);
      setShowContents(false);
    }
  };
  const primary = usePrimaryDocument(props);
  const document =
    primary.status === "ready" || primary.status === "refreshing"
      ? primary.value
      : null;
  const definition = document
    ? getDocumentTypeDefinition(document.documentKind ?? "note")
    : null;
  const View = definition?.ContainerView;
  return (
    <>
      <ContainerPrimaryControls
        node={node}
        documentQueries={documentQueries}
        revision={revision}
        canManage={canManage}
        saving={saving.state}
        choosing={choosing}
        setChoosing={setChoosing}
        choose={choose}
      />
      {node.primaryDocumentId && primary.status === "ready" && !document ? (
        <MiniAppStatus>
          Primary document is unavailable on this device. Showing contents.
        </MiniAppStatus>
      ) : null}
      {document && !View ? (
        <MiniAppStatus>
          No specialized view for this document type. Showing contents.
        </MiniAppStatus>
      ) : null}
      {View ? (
        <nav aria-label="Container view" className="container-view-actions">
          <MiniAppButton
            aria-pressed={!showContents}
            onClick={() => setShowContents(false)}
          >
            {definition.createLabel} view
          </MiniAppButton>
          <MiniAppButton
            aria-pressed={showContents}
            onClick={() => setShowContents(true)}
          >
            Contents
          </MiniAppButton>
        </nav>
      ) : null}
      {primary.status === "failed" ? (
        <MiniAppStatus tone="error">{primary.error}</MiniAppStatus>
      ) : null}
      {View && document && !showContents ? (
        <div className="container-document-view">
          <header>
            <h2>{document.title}</h2>
            <p>{node.name}</p>
          </header>
          <View
            key={document.id}
            containerId={node.id}
            localId={document.id}
            documentId={document.documentId}
            readOnly={props.readOnly}
          />
          <ContainerNotes
            containerId={node.id}
            documentQueries={documentQueries}
            revision={revision}
            onOpenDocument={props.onOpenDocument}
          />
        </div>
      ) : (
        props.children
      )}
    </>
  );
}

/** Remount all view-local requests, drafts and saves on container/account changes. */
export function ContainerDocumentView(props: ContainerDocumentViewProps) {
  const [session, setSession] = useState({
    scope: props.scope,
    containerId: props.node.id,
    key: 0,
  });
  if (session.scope !== props.scope || session.containerId !== props.node.id) {
    setSession({
      scope: props.scope,
      containerId: props.node.id,
      key: session.key + 1,
    });
  }
  return <ContainerViewSession key={session.key} {...props} />;
}
