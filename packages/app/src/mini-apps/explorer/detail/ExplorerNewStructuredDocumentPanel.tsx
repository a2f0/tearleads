import type { ContainerNode, StoredDocumentKind } from "@tearleads/client-sdk";
import {
  MiniAppActions,
  MiniAppButton,
  MiniAppHeader,
  MiniAppHeaderCopy,
  MiniAppPanel,
  MiniAppSection,
  MiniAppSectionHeading,
} from "../../../components/shared/MiniAppLayout";
import { DOCUMENT_TYPE_DEFINITIONS } from "../../../document-types/registry";

interface Props {
  onBackToContainer: () => void;
  onCreateDocument: (documentKind: StoredDocumentKind) => void;
  selectedNode: ContainerNode;
}

export function ExplorerNewStructuredDocumentPanel(params: Props) {
  const { onBackToContainer, onCreateDocument, selectedNode } = params;

  return (
    <MiniAppPanel
      className="explorer-detail explorer-detail--new-structured-document"
      key={selectedNode.id}
      scroll
      variant="framed"
    >
      <MiniAppHeader>
        <MiniAppHeaderCopy>
          <strong>New Structured Document</strong>
          <span>{selectedNode.name}</span>
        </MiniAppHeaderCopy>
        <MiniAppActions>
          <MiniAppButton onClick={onBackToContainer}>
            Back to Container
          </MiniAppButton>
        </MiniAppActions>
      </MiniAppHeader>
      <MiniAppSection
        aria-label="New structured document"
        className="explorer-document-type-section"
      >
        <MiniAppSectionHeading>Document Type</MiniAppSectionHeading>
        <div className="explorer-document-type-grid">
          {DOCUMENT_TYPE_DEFINITIONS.map((definition) => (
            <MiniAppButton
              block
              className="explorer-document-type-button"
              key={definition.kind}
              onClick={() => onCreateDocument(definition.kind)}
            >
              {definition.createLabel}
            </MiniAppButton>
          ))}
        </div>
      </MiniAppSection>
    </MiniAppPanel>
  );
}
