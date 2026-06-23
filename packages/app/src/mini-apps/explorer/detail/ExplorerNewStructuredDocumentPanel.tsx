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
import { CREATABLE_DOCUMENT_TYPE_DEFINITIONS } from "../../../document-types/registry";
import { EXPLORER_LABELS } from "../labels";

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
          <strong>{EXPLORER_LABELS.newStructuredDocumentAction}</strong>
          <span>{selectedNode.name}</span>
        </MiniAppHeaderCopy>
        <MiniAppActions>
          <MiniAppButton onClick={onBackToContainer}>
            {EXPLORER_LABELS.backToContainerAction}
          </MiniAppButton>
        </MiniAppActions>
      </MiniAppHeader>
      <MiniAppSection
        aria-label={EXPLORER_LABELS.newStructuredDocumentRouteLabel}
        className="explorer-document-type-section"
      >
        <MiniAppSectionHeading>
          {EXPLORER_LABELS.newStructuredDocumentDocumentTypeHeading}
        </MiniAppSectionHeading>
        <div className="explorer-document-type-grid">
          {CREATABLE_DOCUMENT_TYPE_DEFINITIONS.map((definition) => (
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
