import type { ContainerNode, StoredDocumentKind } from "@tearleads/client-sdk";
import { useState } from "react";
import {
  MiniAppButton,
  MiniAppField,
  MiniAppHeader,
  MiniAppHeaderCopy,
  MiniAppInput,
  MiniAppPanel,
  MiniAppSection,
  MiniAppSectionHeading,
  MiniAppStatus,
} from "../../../../components/mini-app/MiniAppLayout";
import { CREATABLE_DOCUMENT_TYPE_DEFINITIONS } from "../../../../document-types/registry";
import { EXPLORER_LABELS } from "../../labels";

interface Props {
  onCreateDocument: (documentKind: StoredDocumentKind) => void;
  selectedNode: ContainerNode;
}

export function ExplorerNewStructuredDocumentPanel(params: Props) {
  const { onCreateDocument, selectedNode } = params;
  const [query, setQuery] = useState("");
  const normalizedQuery = query.trim().toLowerCase();
  const documentTypes = normalizedQuery
    ? CREATABLE_DOCUMENT_TYPE_DEFINITIONS.filter((definition) =>
        definition.createLabel.toLowerCase().includes(normalizedQuery),
      )
    : CREATABLE_DOCUMENT_TYPE_DEFINITIONS;

  return (
    <MiniAppPanel
      className="explorer-detail explorer-detail--new-structured-document"
      scroll
    >
      <MiniAppHeader>
        <MiniAppHeaderCopy>
          <strong>{EXPLORER_LABELS.newStructuredDocumentAction}</strong>
          <span>{selectedNode.name}</span>
        </MiniAppHeaderCopy>
      </MiniAppHeader>
      <MiniAppSection
        aria-label={EXPLORER_LABELS.newStructuredDocumentRouteLabel}
        className="explorer-document-type-section"
      >
        <MiniAppSectionHeading>
          {EXPLORER_LABELS.newStructuredDocumentDocumentTypeHeading}
        </MiniAppSectionHeading>
        <MiniAppField>
          <span>{EXPLORER_LABELS.newStructuredDocumentSearchLabel}</span>
          <MiniAppInput
            type="search"
            value={query}
            onChange={(event) => setQuery(event.currentTarget.value)}
          />
        </MiniAppField>
        <MiniAppStatus
          role="status"
          className={
            documentTypes.length > 0
              ? "mini-app-status-announcement"
              : undefined
          }
        >
          {documentTypes.length === 0
            ? EXPLORER_LABELS.newStructuredDocumentNoMatches
            : ""}
        </MiniAppStatus>
        <div className="explorer-document-type-grid">
          {documentTypes.map((definition) => {
            const DocumentTypeIcon = definition.createIcon;
            return (
              <MiniAppButton
                block
                className="explorer-document-type-button"
                key={definition.kind}
                onClick={() => onCreateDocument(definition.kind)}
              >
                <DocumentTypeIcon aria-hidden size={32} />
                <span className="explorer-document-type-label">
                  {definition.createLabel}
                </span>
              </MiniAppButton>
            );
          })}
        </div>
      </MiniAppSection>
    </MiniAppPanel>
  );
}
