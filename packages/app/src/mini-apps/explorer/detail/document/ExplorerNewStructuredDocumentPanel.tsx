import type { ContainerNode, StoredDocumentKind } from "@tearleads/client-sdk";
import {
  MiniAppButton,
  MiniAppHeader,
  MiniAppHeaderCopy,
  MiniAppPanel,
  MiniAppSection,
  MiniAppSectionHeading,
} from "../../../../components/mini-app/MiniAppLayout";
import { CREATABLE_DOCUMENT_TYPE_DEFINITIONS } from "../../../../document-types/registry";
import { EXPLORER_LABELS } from "../../labels";

interface Props {
  onCreateDocument: (documentKind: StoredDocumentKind) => void;
  selectedNode: ContainerNode;
}

export function ExplorerNewStructuredDocumentPanel(params: Props) {
  const { onCreateDocument, selectedNode } = params;

  return (
    <MiniAppPanel
      className="explorer-detail explorer-detail--new-structured-document"
      key={selectedNode.id}
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
        <div className="explorer-document-type-grid">
          {CREATABLE_DOCUMENT_TYPE_DEFINITIONS.map((definition) => {
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
