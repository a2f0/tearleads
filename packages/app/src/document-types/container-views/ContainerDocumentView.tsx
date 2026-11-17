import "./ContainerDocumentView.css";
import type {
  ContainerDocumentQueries,
  ContainerNode,
  DocumentSummary,
  DomainScope,
} from "@tearleads/client-sdk";
import { type ReactNode, useCallback, useMemo, useState } from "react";
import {
  MiniAppButton,
  MiniAppStatus,
} from "../../components/mini-app/MiniAppLayout";
import { getDocumentTypeDefinition } from "../registry";
import { DefaultContainerView } from "./default/DefaultContainerView";
import { useContainerViewResource } from "./shared/useContainerViewResource";

interface ContainerDocumentViewProps {
  children: ReactNode;
  documentQueries: ContainerDocumentQueries;
  node: ContainerNode;
  onOpenDocument: (localId: string, containerId: string) => void;
  readOnly: boolean;
  revision: number;
  scope: DomainScope;
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

/** A kind's specialized container view, or the default notes view. */
function resolveContainerView(document: DocumentSummary) {
  const definition = getDocumentTypeDefinition(document.documentKind ?? "note");
  return definition.ContainerView
    ? {
        label: `${definition.createLabel} view`,
        View: definition.ContainerView,
      }
    : { label: "Notes view", View: DefaultContainerView };
}

function ContainerViewSession(props: ContainerDocumentViewProps) {
  const { node, documentQueries, revision } = props;
  const [showContents, setShowContents] = useState(false);
  const primary = usePrimaryDocument(props);
  const document =
    primary.status === "ready" || primary.status === "refreshing"
      ? primary.value
      : null;
  const view = document ? resolveContainerView(document) : null;
  return (
    <>
      {node.primaryDocumentId && primary.status === "ready" && !document ? (
        <MiniAppStatus>
          Primary document is unavailable on this device. Showing contents.
        </MiniAppStatus>
      ) : null}
      {view ? (
        <nav aria-label="Container view" className="container-view-actions">
          <MiniAppButton
            aria-pressed={!showContents}
            onClick={() => setShowContents(false)}
          >
            {view.label}
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
      {view && document && !showContents ? (
        <div className="container-document-view">
          <header>
            <h2>{document.title}</h2>
            <p>{node.name}</p>
          </header>
          <view.View
            key={document.id}
            containerId={node.id}
            localId={document.id}
            documentId={document.documentId}
            documentQueries={documentQueries}
            readOnly={props.readOnly}
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
